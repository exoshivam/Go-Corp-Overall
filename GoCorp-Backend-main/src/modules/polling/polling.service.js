import { RideRequest } from "../ride/ride.model.js";
import { Clustering } from "./clustering.model.js";
import { Batched } from "./batched.model.js";
import { getDistance } from "../../utils/geo.js";
import ApiError from "../../utils/ApiError.js";
import { getEmployeesInRideGroup, getTotalPeopleInRides } from "../ride/ride.service.js";
import * as turf from "@turf/turf";
import { getRoute } from "../../utils/osrm.js";
import mongoose from "mongoose";

const ROUTE_BUFFER_METERS = 500;
const TIME_WINDOW_MINUTES = 10;
const MAX_CLUSTER_SIZE = 4;
const BASE_FARE = 40; // Base fare in ₹
const PER_KM_RATE = 12; // Rate per km in ₹

/**
 * Calculate total distance from a LineString polyline (in km)
 */
export const calculatePolylineDistance = (polyline) => {
  try {
    if (!polyline || !polyline.coordinates || polyline.coordinates.length < 2) {
      return 0;
    }

    const lineString = turf.lineString(polyline.coordinates);
    const distanceInKm = turf.length(lineString, { units: "kilometers" });
    return distanceInKm;
  } catch (error) {
    console.error("Error calculating polyline distance:", error);
    return 0;
  }
};

/**
 * Calculate estimated fare based on distance
 * Formula: fare = baseFare + (distance * perKmRate)
 * Returns fare as integer
 */
export const calculateEstimatedFare = (distanceInKm) => {
  const dist = distanceInKm || 0;
  // Strictly enforce the BASE_FARE (40) as the absolute floor
  return Math.max(BASE_FARE, Math.round(BASE_FARE + (dist * PER_KM_RATE)));
};

/**
 * Calculate the shortest distance from a point to a polyline route (in meters)
 */
const getDistanceToRoute = (pointCoords, polyline) => {
  try {
    if (!polyline || !polyline.coordinates || polyline.coordinates.length < 2) return Infinity;
    const line = turf.lineString(polyline.coordinates);
    const pt = turf.point(pointCoords);
    const nearest = turf.nearestPointOnLine(line, pt);
    return nearest.properties.dist * 1000; // km to meters
  } catch (error) {
    console.error("Error in getDistanceToRoute:", error);
    return Infinity;
  }
};

/**
 * STEP 2: Find the 1st point where new ride's route joins/diverges from the cluster's route
 */
export const findFirstContactPoint = (newRoutePolyline, clusterPolyline, thresholdMeters = 200, fromEnd = false) => {
  try {
    if (!newRoutePolyline || !newRoutePolyline.coordinates || newRoutePolyline.coordinates.length < 2) return null;
    if (!clusterPolyline || !clusterPolyline.coordinates || clusterPolyline.coordinates.length < 2) return null;

    const clusterLine = turf.lineString(clusterPolyline.coordinates);
    const coordinates = fromEnd ? [...newRoutePolyline.coordinates].reverse() : newRoutePolyline.coordinates;

    // Iterate through points of the new route to find the first one near the cluster line
    for (const coords of coordinates) {
      const point = turf.point(coords);
      const nearestPoint = turf.nearestPointOnLine(clusterLine, point);
      const distance = nearestPoint.properties.dist * 1000; // km to meters

      if (distance <= thresholdMeters) {
        return coords; // This is our join/divergence point
      }
    }

    return null;
  } catch (error) {
    console.error("Error in findFirstContactPoint:", error);
    return null;
  }
};

/**
 * Check if two timestamps are within time window
 */
export const isWithinTimeWindow = (time1, time2, windowMinutes = TIME_WINDOW_MINUTES) => {
  const diff = Math.abs(new Date(time1).getTime() - new Date(time2).getTime());
  return diff <= windowMinutes * 60 * 1000;
};

/**
 * Check if two drop locations are similar (within 100 meters)
 */
export const isSimilarDropLocation = (drop1, drop2, threshold = 200) => {
  const distance = getDistance(drop1, drop2);
  return distance <= threshold;
};

/**
 * Check if two pickup locations are similar (within 200 meters)
 */
export const isSimilarPickupLocation = (pickup1, pickup2, threshold = 200) => {
  const distance = getDistance(pickup1, pickup2);
  return distance <= threshold;
};


//decides if two rides can carpool
export const can_cluster = async (newRide, existingCluster) => {
  try {
    //Extract coordinates and times
    const newPickup = newRide.pickup_location.coordinates;
    const newDrop = newRide.drop_location.coordinates;
    const newTime = newRide.scheduled_at;

    // Get the first ride of the cluster to check direction and similarity
    const firstRideId = existingCluster.ride_ids[0];
    const firstRide = await RideRequest.findById(firstRideId);
    if (!firstRide) return false;

    const existingPickup = firstRide.pickup_location.coordinates;
    const existingDrop = firstRide.drop_location.coordinates;
    const existingTime = existingCluster.scheduled_at;
    
    // Determine direction
    const isToOffice = firstRide.destination_type === "OFFICE";

    // Check time window
    if (!isWithinTimeWindow(newTime, existingTime)) {
      return false;
    }

    //for rides going to office
    if (isToOffice) {
      // Check destination is same office
      const distToDrop = getDistance(newDrop, existingDrop);
      if (distToDrop > 1000) { // Only reject if they are in different offices entirely (>1km)
        return false;
      }

      // CONDITION 1: Similar pickup location
      if (isSimilarPickupLocation(newPickup, existingPickup)) {
        return true;
      }

      // CONDITION 2: Route Intersection
      if (newRide.route_polyline && existingCluster.pickup_polyline) {
        const contactPoint = findFirstContactPoint(newRide.route_polyline, existingCluster.pickup_polyline, 200, false);
        if (contactPoint) {
          const distToNewPickup = getDistance(newPickup, contactPoint);
          if (distToNewPickup <= ROUTE_BUFFER_METERS) {
            return true;
          }
        }
      }

      // CONDITION 3: New pickup near cluster route
      if (existingCluster.pickup_polyline) {
        const distToRoute = getDistanceToRoute(newPickup, existingCluster.pickup_polyline);
        if (distToRoute <= ROUTE_BUFFER_METERS) {
          return true;
        }
      }

      // CONDITION 4: Cluster pickup near new route
      if (newRide.route_polyline) {
        const distToNewRoute = getDistanceToRoute(existingPickup, newRide.route_polyline);
        if (distToNewRoute <= ROUTE_BUFFER_METERS) {
          return true;
        }
      }
    } else {
      // FROM OFFICE: Must share the same office pickup point
      if (!isSimilarPickupLocation(newPickup, existingPickup)) {
        return false;
      }

      // CONDITION 1: Similar drop location (Home)
      if (isSimilarDropLocation(newDrop, existingDrop)) {
        return true;
      }

      // CONDITION 2: Route Divergence
      if (newRide.route_polyline && existingCluster.pickup_polyline) {
        const contactPoint = findFirstContactPoint(newRide.route_polyline, existingCluster.pickup_polyline, 200, true);
        if (contactPoint) {
          const distToNewDrop = getDistance(newDrop, contactPoint);
          if (distToNewDrop <= ROUTE_BUFFER_METERS) {
            return true;
          }
        }
      }

      // CONDITION 3: Proximity Capture (Symmetric - Is New Drop near Existing Route?)
      if (existingCluster.pickup_polyline) {
        const distToRoute = getDistanceToRoute(newDrop, existingCluster.pickup_polyline);
        if (distToRoute <= ROUTE_BUFFER_METERS) {
          return true;
        }
      }

      // CONDITION 4: Proximity Capture (Symmetric - Is Existing Drop near New Route?)
      if (newRide.route_polyline) {
        const distToNewRoute = getDistanceToRoute(existingDrop, newRide.route_polyline);
        if (distToNewRoute <= ROUTE_BUFFER_METERS) {
          return true;
        }
      }
    }

    return false;
  } catch (error) {
    console.error("Error in can_cluster:", error);
    return false;
  }
};

/**
 * Shared Helper: Update a group's logical order and polyline route
 * Used by merge operations to ensure the carpool is always optimized
 */
export const updateGroupRouteAndOrder = async (rideIds, groupDoc, type = 'cluster') => {
  const allRides = await RideRequest.find({ _id: { $in: rideIds } });
  if (allRides.length === 0) return groupDoc;

  const firstRide = allRides[0];
  const isToOffice = firstRide.destination_type === "OFFICE";
  
  // We use firstRide's drop/pickup as the office reference depending on direction
  const officeCoords = isToOffice ? firstRide.drop_location.coordinates : firstRide.pickup_location.coordinates;
  
  let orderedRideIds, waypoints;

  if (isToOffice) {
    // TO OFFICE: Sort by pickup distance from office (Furthest first)
    const sortedRides = allRides.map(r => ({
      ride: r,
      distance: getDistance(r.pickup_location.coordinates, officeCoords)
    })).sort((a, b) => b.distance - a.distance);

    orderedRideIds = sortedRides.map(sr => sr.ride._id);
    waypoints = sortedRides.map(sr => sr.ride.pickup_location.coordinates);
    waypoints.push(officeCoords); // End at office
  } else {
    // FROM OFFICE: Sort by drop distance from office (Closest first)
    const sortedRides = allRides.map(r => ({
      ride: r,
      distance: getDistance(r.drop_location.coordinates, officeCoords)
    })).sort((a, b) => a.distance - b.distance);

    orderedRideIds = sortedRides.map(sr => sr.ride._id);
    waypoints = [officeCoords]; // Start at office
    waypoints.push(...sortedRides.map(sr => sr.ride.drop_location.coordinates));
  }

  const newPolyline = await getRoute(waypoints);
  const polylineObj = { type: "LineString", coordinates: newPolyline };
  const distanceInKm = calculatePolylineDistance(polylineObj);
  const estimatedFare = calculateEstimatedFare(distanceInKm);

  const Model = type === 'cluster' ? Clustering : Batched;
  const totalPeople = await getTotalPeopleInRides(rideIds);

  const updateData = {
    ride_ids: orderedRideIds,
    pickup_polyline: polylineObj,
    current_size: totalPeople,
    batch_size: totalPeople,
    estimated_distance: distanceInKm,
    estimated_fare: estimatedFare
  };
  return await Model.findByIdAndUpdate(groupDoc._id, { $set: updateData }, { new: true });
};

/**
 * DISSOLUTION: Break a Batch or Cluster entirely and return survivors to pool
 * Triggered by any cancellation
 */
export const dissolveGroupAndReturnToPool = async (groupId, groupType, excludedRideIds = []) => {
  try {
    const Model = groupType === 'batch' ? Batched : Clustering;
    const group = await Model.findById(groupId);
    if (!group) return;

    // Get survivors (those not in excludedRideIds and currently in the group)
    const survivorIds = group.ride_ids.filter(id => !excludedRideIds.includes(id.toString()));

    // 1. Delete the old group (Batch or Cluster)
    if (groupType === 'batch') {
      await Batched.findByIdAndDelete(groupId);
    } else {
      await Clustering.findByIdAndDelete(groupId);
    }

    if (survivorIds.length === 0) return;

    // 2. Create a NEW Clustering document for survivors to stay together initially
    // We use the first survivor's data for the centroid reference
    const firstSurvivor = await RideRequest.findById(survivorIds[0]);
    if (!firstSurvivor) return;

    const newCluster = await Clustering.create({
      office_id: group.office_id,
      scheduled_at: group.scheduled_at,
      ride_ids: survivorIds,
      current_size: await getTotalPeopleInRides(survivorIds),
      pickup_centroid: group.pickup_centroid || firstSurvivor.pickup_location,
      drop_location: group.drop_location || firstSurvivor.drop_location,
      pickup_polyline: group.pickup_polyline, // Reuse existing optimized route for now
      status: "IN_CLUSTERING",
      metadata: {
        force_batched: false,
        status_msg: "Group dissolved due to cancellation. Finding new matches..."
      }
    });

    // 3. Update all survivor RideRequests
    await RideRequest.updateMany(
      { _id: { $in: survivorIds } },
      { 
        status: "IN_CLUSTERING", 
        cluster_id: newCluster._id, 
        batch_id: null 
      }
    );

    // 4. Final Route/Fare Optimization for the new cluster (now smaller)
    await updateGroupRouteAndOrder(survivorIds, newCluster, 'cluster');
    
    console.log(`[Dissolution] Group ${groupId} dissolved. ${survivorIds.length} survivors returned to pool in Cluster ${newCluster._id}`);
  } catch (error) {
    console.error("Error in dissolveGroupAndReturnToPool:", error);
  }
};

/**
 * SECONDARY MERGE: Attempt to swallow other eligible clusters into this one
 * This prevents carpool fragmentation by consolidating groups in real-time
 */
export const attemptSecondaryMerge = async (primaryGroup, primaryType = 'cluster') => {
  try {
    //check if already full
    const currentSize = primaryType === 'cluster' ? primaryGroup.current_size : (primaryGroup.batch_size || primaryGroup.ride_ids.length);
    if (currentSize >= MAX_CLUSTER_SIZE) return primaryGroup;

    // Find candidates in the same time window
    const scheduledTime = primaryGroup.scheduled_at;
    const startTime = new Date(scheduledTime.getTime() - TIME_WINDOW_MINUTES * 60 * 1000);
    const endTime = new Date(scheduledTime.getTime() + TIME_WINDOW_MINUTES * 60 * 1000);

    const [clusters, batches] = await Promise.all([
      Clustering.find({
        _id: { $ne: primaryGroup._id },
        office_id: primaryGroup.office_id,
        scheduled_at: { $gte: startTime, $lte: endTime },
        status: { $in: ["IN_CLUSTERING", "READY_FOR_BATCH"] },
      }),
      Batched.find({
        _id: { $ne: primaryGroup._id },
        office_id: primaryGroup.office_id,
        scheduled_at: { $gte: startTime, $lte: endTime },
        status: { $in: ["CREATED", "READY_FOR_ASSIGNMENT"] },
        batch_size: { $lt: MAX_CLUSTER_SIZE }
      })
    ]);

    const candidates = [
      ...clusters.map(c => ({ original: c, type: 'cluster', size: c.current_size })),
      ...batches.map(b => ({ original: b, type: 'batch', size: b.batch_size }))
    ];

    //test each candidate
    for (const candidate of candidates) {
      if (currentSize + candidate.size <= MAX_CLUSTER_SIZE) {
        //Create virtual representation for matching test
        const virtualRide = {
          _id: candidate.original._id,
          pickup_location: candidate.original.pickup_centroid || candidate.original.pickup_location,
          drop_location: candidate.original.drop_location,
          scheduled_at: candidate.original.scheduled_at,
          route_polyline: candidate.original.pickup_polyline,
          destination_type: (await RideRequest.findById(candidate.original.ride_ids[0]))?.destination_type
        };

        //test if candidate matches primary group
        if (await can_cluster(virtualRide, primaryGroup)) {
          //Absorb: move all candidate ride to primary
          const combinedRideIds = [...primaryGroup.ride_ids, ...candidate.original.ride_ids];
          
          //Update candidate's rides with primary's links
          const newStatus = primaryType === 'cluster' ? "IN_CLUSTERING" : "CLUSTERED";
          const linkUpdate = primaryType === 'cluster' 
            ? { cluster_id: primaryGroup._id, batch_id: null } 
            : { batch_id: primaryGroup._id, cluster_id: null };

          await RideRequest.updateMany(
            { _id: { $in: candidate.original.ride_ids } },
            { status: newStatus, ...linkUpdate }
          );

          //Delete candidate group (absorbed)
          if (candidate.type === 'cluster') {
            await Clustering.findByIdAndDelete(candidate.original._id);
          } else {
            await Batched.findByIdAndDelete(candidate.original._id);
          }

          // Reoptimize primary group
          return await updateGroupRouteAndOrder(combinedRideIds, primaryGroup, primaryType);
        }
      }
    }

    return primaryGroup;
  } catch (error) {
    console.error("Error in attemptSecondaryMerge:", error);
    return primaryGroup;
  }
};

/**
 * Find best matching cluster for a new ride
 * Optimization: For size-2 rides, check size-2 clusters first, then size-1
 */
export const findBestCluster = async (newRide, officeId, scheduledAt) => {
  try {
    // Calculate time window: ±10 minutes
    const scheduledTime = new Date(scheduledAt);
    const timeWindowMinutes = 10;
    const startTime = new Date(scheduledTime.getTime() - timeWindowMinutes * 60 * 1000);
    const endTime = new Date(scheduledTime.getTime() + timeWindowMinutes * 60 * 1000);

    // Find existing clusters and batches for this office within time window
    const [clusters, batches] = await Promise.all([
      Clustering.find({
        office_id: officeId,
        scheduled_at: { $gte: startTime, $lte: endTime },
        status: { $in: ["IN_CLUSTERING", "READY_FOR_BATCH"] },
      }),
      Batched.find({
        office_id: officeId,
        scheduled_at: { $gte: startTime, $lte: endTime },
        status: { $in: ["CREATED", "READY_FOR_ASSIGNMENT"] },
        batch_size: { $lt: MAX_CLUSTER_SIZE } // Only if there is space
      })
    ]);

    // Combine into Common Format
    const availableGroups = [
      ...clusters.map(c => ({ original: c, type: 'cluster', size: c.current_size })),
      ...batches.map(b => ({ original: b, type: 'batch', size: b.batch_size }))
    ];

    if (availableGroups.length === 0) {
      return null;
    }

    const newRideSize = newRide.invited_employee_ids.length + 1;

    //Priority sorting based on new ride size
    /**
     * Eg.- if new ride size = 1:
     *   Priority 1: Groups with 3 (1+3=4, full)
     *   Priority 2: Groups with 2 (1+2=3)
     *   Priority 3: Groups with 1 (1+1=2)
     */
    let sortedGroups = [];
    if (newRideSize === 1) {
      sortedGroups = [
        ...availableGroups.filter((g) => g.size === 3),
        ...availableGroups.filter((g) => g.size === 2),
        ...availableGroups.filter((g) => g.size === 1),
      ];
    } else if (newRideSize === 2) {
      sortedGroups = [
        ...availableGroups.filter((g) => g.size === 2),
        ...availableGroups.filter((g) => g.size === 1),
      ];
    } else if (newRideSize === 3) {
      sortedGroups = availableGroups.filter((g) => g.size === 1);
    } else {
      return null;
    }

    //Test Each Group for Location Match
    for (const group of sortedGroups) {
      //Checks location compatibility
      const canCluster = await can_cluster(newRide, group.original);
      if (canCluster) {
        return group; //Returns the FIRST matching group (highest priority)
      }
    }

    return null;
  } catch (error) {
    console.error("Error in findBestCluster:", error);
    return null;
  }
};

/**
 * CASE 1: Single person, solo_preference = true
 * Skip clustering, send directly to Batched
 */
export const handleCase1_SoloPreference = async (ride) => {
  try {
    // Create route polyline
    const polyline = {
      type: "LineString",
      coordinates: await getRoute([ride.pickup_location.coordinates, ride.drop_location.coordinates]),
    };

    // Calculate distance and fare
    const distanceInKm = calculatePolylineDistance(polyline);
    const estimatedFare = calculateEstimatedFare(distanceInKm);

    // Create a batched record directly
    const batched = await Batched.create({
      office_id: ride.office_id,
      scheduled_at: ride.scheduled_at,
      ride_ids: [ride._id],
      batch_size: 1,
      pickup_centroid: ride.pickup_location,
      drop_location: ride.drop_location,
      pickup_polyline: polyline,
      estimated_distance: distanceInKm,
      estimated_fare: estimatedFare,
      status: "CREATED",
      metadata: {
        force_batched: false,
        reason: "Solo preference",
      },
    });

    // Update ride status
    await RideRequest.findByIdAndUpdate(ride._id, {
      status: "BOOKED_SOLO",
      batch_id: batched._id,
    });

    return { case: 1, batched_id: batched._id, cluster_id: null };
  } catch (error) {
    console.error("Error in handleCase1:", error);
    throw error;
  }
};

/**
 * Create a new cluster for a single booking (size 1-3)
 */
export const handleNewCluster = async (ride, officeId, scheduledAt) => {
  try {
    const employees = await getEmployeesInRideGroup(ride._id);

    // Create a new cluster
    const clustering = await Clustering.create({
      office_id: officeId,
      scheduled_at: scheduledAt,
      ride_ids: [ride._id],
      current_size: employees.length,
      pickup_centroid: ride.pickup_location,
      drop_location: ride.drop_location,
      pickup_polyline: {
        type: "LineString",
        coordinates: await getRoute([ride.pickup_location.coordinates, ride.drop_location.coordinates]),
      },
      status: "IN_CLUSTERING",
    });

    // Update ride status with Hard Link
    await RideRequest.findByIdAndUpdate(ride._id, {
      status: "IN_CLUSTERING",
      cluster_id: clustering._id
    });

    return { case: 2, cluster_id: clustering._id, batched_id: null, action: "new_cluster" };
  } catch (error) {
    console.error("Error in handleNewCluster:", error);
    throw error;
  }
};

//CASE 3: Matching engine - searches for compatible ride to cluster
export const handleUnifiedGrouping = async (ride, officeId, scheduledAt) => {
  try {
    //Calculate ride size (including requester)
    const rideSize = ride.invited_employee_ids.length + 1;
    //Search for Best Matching Cluster
    const bestGroup = await findBestCluster(ride, officeId, scheduledAt);

    //handle matching group if found
    if (bestGroup) {
      //CASE A: Matched with Existing CLUSTER
      if (bestGroup.type === 'cluster') {
        let mergedCluster = await mergeClusters(ride, bestGroup.original);

        // TRIGGER SECONDARY MERGE (Tries to absorb other smallclusters)
        mergedCluster = await attemptSecondaryMerge(mergedCluster, 'cluster');

        // If reached size 4, promote to batch
        if (mergedCluster.current_size === MAX_CLUSTER_SIZE) {
          const batched = await moveToBatched(mergedCluster, false, "Merged to max size");
          return { case: 3, cluster_id: null, batched_id: batched._id, action: "merged_and_batched" };
        }

        return { case: 3, cluster_id: mergedCluster._id, batched_id: null, action: "merged" };
      } else {
        // Merge directly into existing batch
        let updatedBatch = await mergeIntoBatch(ride, bestGroup.original);
        
        // trigger secondary merge
        updatedBatch = await attemptSecondaryMerge(updatedBatch, 'batch');

        return { case: 3, cluster_id: null, batched_id: updatedBatch._id, action: "joined_batch" };
      }
    } else {
      // No group found? Create new cluster
      return await handleNewCluster(ride, officeId, scheduledAt);
    }
  } catch (error) {
    console.error("Error in handleUnifiedGrouping:", error);
    throw error;
  }
};


/**
 * CASE 6: Person with 3 invited (group size = 4)
 * Skip clustering, send directly to Batched
 */
export const handleCase6_GroupSize4 = async (ride) => {
  try {
    const employees = await getEmployeesInRideGroup(ride._id);

    // Create route polyline
    const polyline = {
      type: "LineString",
      coordinates: await getRoute([ride.pickup_location.coordinates, ride.drop_location.coordinates]),
    };

    // Calculate distance and fare
    const distanceInKm = calculatePolylineDistance(polyline);
    const estimatedFare = calculateEstimatedFare(distanceInKm);

    const batched = await Batched.create({
      office_id: ride.office_id,
      scheduled_at: ride.scheduled_at,
      ride_ids: [ride._id],
      batch_size: employees.length,
      pickup_centroid: ride.pickup_location,
      drop_location: ride.drop_location,
      pickup_polyline: polyline,
      estimated_distance: distanceInKm,
      estimated_fare: estimatedFare,
      status: "CREATED",
      metadata: {
        force_batched: false,
        reason: "Group size 4",
      },
    });

    await RideRequest.findByIdAndUpdate(ride._id, {
      status: "CLUSTERED",
      batch_id: batched._id,
    });

    return { case: 6, batched_id: batched._id, cluster_id: null };
  } catch (error) {
    console.error("Error in handleCase6:", error);
    throw error;
  }
};

/**
 * Merge a new ride into an existing cluster
 */
export const mergeClusters = async (newRide, existingCluster) => {
  try {
    //Calculate new rides people count
    const newRideId = new mongoose.Types.ObjectId(newRide._id);
    const newEmployees = await getEmployeesInRideGroup(newRide._id);
    const joinerSize = newEmployees.length;

    // ATOMIC JOIN: Only join if we haven't already and there is space
    //Prevents race conditions (multiple servers merging simultaneously)
    const refreshedCluster = await Clustering.findOneAndUpdate(
      { 
        _id: existingCluster._id, 
        ride_ids: { $ne: newRideId },
        current_size: { $lte: MAX_CLUSTER_SIZE - joinerSize }
      },
      { 
        $addToSet: { ride_ids: newRideId },
        $inc: { current_size: joinerSize }
      },
      { new: true }
    );

    if (!refreshedCluster) {
      // Check if we didn't join because we were already there (idempotency)
      const alreadyJoined = await Clustering.findOne({ _id: existingCluster._id, ride_ids: newRideId });
      if (alreadyJoined) return await updateGroupRouteAndOrder(alreadyJoined.ride_ids, alreadyJoined, 'cluster');
      
      throw new ApiError(400, "Cannot merge: cluster lost or would exceed max size");
    }

    // GHOST CLEANUP: If the new ride was accidentally in another cluster, remove it from all others
    await Clustering.deleteMany({
      _id: { $ne: refreshedCluster._id },
      ride_ids: newRideId
    });

    const allRideIds = refreshedCluster.ride_ids;

    //Updates all rides in the merged cluster
    await RideRequest.updateMany(
      { _id: { $in: allRideIds } },
      { 
        status: "IN_CLUSTERING", 
        cluster_id: refreshedCluster._id,
        batch_id: null 
      }
    );

    //Reoptimize Route
    return await updateGroupRouteAndOrder(allRideIds, refreshedCluster, 'cluster');
  } catch (error) {
    console.error("Error in mergeClusters:", error);
    throw error;
  }
};

export const mergeIntoBatch = async (newRide, existingBatch) => {
  try {
    const newRideId = new mongoose.Types.ObjectId(newRide._id);
    const newEmployees = await getEmployeesInRideGroup(newRide._id);
    const joinerSize = newEmployees.length;

    // ATOMIC JOIN: Only join if we haven't already and there is space
    const refreshedBatch = await Batched.findOneAndUpdate(
      { 
        _id: existingBatch._id, 
        ride_ids: { $ne: newRideId },
        batch_size: { $lte: MAX_CLUSTER_SIZE - joinerSize }
      },
      { 
        $addToSet: { ride_ids: newRideId },
        $inc: { batch_size: joinerSize }
      },
      { new: true }
    );

    if (!refreshedBatch) {
      const alreadyJoined = await Batched.findOne({ _id: existingBatch._id, ride_ids: newRideId });
      if (alreadyJoined) return await updateGroupRouteAndOrder(alreadyJoined.ride_ids, alreadyJoined, 'batch');
      
      throw new ApiError(400, "Cannot merge: batch lost or would exceed max size");
    }

    const allRideIds = refreshedBatch.ride_ids;

    console.log(`[Merge-Audit] Atomic join to Batch ${refreshedBatch._id}. New size: ${refreshedBatch.batch_size}`);

    await RideRequest.updateMany(
      { _id: { $in: allRideIds } },
      {
        status: "CLUSTERED",
        batch_id: refreshedBatch._id,
        cluster_id: null
      }
    );

    // Update group route and order using shared helper
    return await updateGroupRouteAndOrder(allRideIds, refreshedBatch, 'batch');
  } catch (error) {
    console.error("Error in mergeIntoBatch:", error);
    throw error;
  }
};

//move cluster to batched
export const moveToBatched = async (cluster, forceBatched = false, reason = null) => {
  try {
    //Check if already batched (idempotency)
    const existingBatch = await Batched.findOne({ "metadata.clustering_id": cluster._id });
    if (existingBatch) {
      return existingBatch;
    }

    // atomic claim: prevent race condition
    // This ensures only one server instance promotes this cluster
    const claimedCluster = await Clustering.findOneAndUpdate(
      { _id: cluster._id, status: { $in: ["IN_CLUSTERING", "READY_FOR_BATCH"] } },
      { $set: { status: "BATCHING_IN_PROGRESS" } },
      { new: true }
    );

    if (!claimedCluster) {
      // Another server already claimed it
      const retryBatch = await Batched.findOne({ "metadata.clustering_id": cluster._id });
      if (retryBatch) return retryBatch;
      throw new ApiError(400, "Cluster already processed or in progress");
    }

    // Ensure all ride_ids are unique Object ids
    const uniqueRideIds = [...new Set(claimedCluster.ride_ids.map(id => id.toString()))].map(id => new mongoose.Types.ObjectId(id));

    // Calculate distance and fare from polyline
    const distanceInKm = calculatePolylineDistance(claimedCluster.pickup_polyline);
    const estimatedFare = calculateEstimatedFare(distanceInKm);

    const totalPeople = await getTotalPeopleInRides(uniqueRideIds);

    // Create batch record
    const batched = await Batched.create({
      office_id: claimedCluster.office_id,
      scheduled_at: claimedCluster.scheduled_at,
      ride_ids: uniqueRideIds,
      batch_size: totalPeople,
      pickup_polyline: claimedCluster.pickup_polyline,
      pickup_centroid: claimedCluster.pickup_centroid,
      drop_location: claimedCluster.drop_location,
      estimated_distance: distanceInKm,
      estimated_fare: estimatedFare,
      status: "CREATED",
      metadata: {
        force_batched: forceBatched,
        force_batch_reason: reason,
        clustering_id: claimedCluster._id,
      },
    });

    //MRoute Optimization (latetest optimization)
    const finalizedBatch = await updateGroupRouteAndOrder(uniqueRideIds, batched, 'batch');

    // Update cluster and rides
    await Clustering.findByIdAndUpdate(claimedCluster._id, {
      status: "BATCHED",
      batch_id: batched._id,
    });

    // Update all rides in the batch
    await RideRequest.updateMany(
      { _id: { $in: uniqueRideIds } },
      {
        status: "CLUSTERED",
        batch_id: batched._id,
        cluster_id: null
      }
    );

    return batched;
  } catch (error) {
    // ROLLBACK ATOMIC CLAIM: If creation failed, move back to IN_CLUSTERING so it can be retried
    if (error.code !== 11000) { 
      await Clustering.findByIdAndUpdate(cluster._id, { status: "IN_CLUSTERING" });
    }
    console.error("Error in moveToBatched:", error);
    throw error;
  }
};

//Route a new ride request through the polling system
export const routeRideRequest = async (ride) => {
  try {
    //total people in ride(including requester)
    const rideSize = ride.invited_employee_ids.length + 1;
    //which office ride belongs
    const officeId = ride.office_id;
    const scheduledAt = ride.scheduled_at;

    //Create actual road route between pickup and drop
    if (!ride.solo_estimated_fare || !ride.route_polyline || !ride.route_polyline.coordinates || ride.route_polyline.coordinates.length === 0) {
      let coords = ride.route_polyline?.coordinates;
      if (!coords || coords.length === 0) {
        coords = await getRoute([ride.pickup_location.coordinates, ride.drop_location.coordinates]);
      }
      
      const soloPolyline = {
        type: "LineString",
        coordinates: coords
      };

      //calculate total km of the route
      const soloDistance = calculatePolylineDistance(soloPolyline);
      const soloFare = calculateEstimatedFare(soloDistance);
      
      await RideRequest.findByIdAndUpdate(ride._id, { 
        route_polyline: soloPolyline,
        solo_estimated_fare: soloFare,
        solo_distance: soloDistance
      });
    }

    // Case 1: Solo preference - skip clustering.
    if (rideSize === 1 && ride.solo_preference) {
      return await handleCase1_SoloPreference(ride);
    }

    //Try to find other rides to carpool with
    if (rideSize < 4) {
      return await handleUnifiedGrouping(ride, officeId, scheduledAt);
    }

    // Case 6: Group size 4, auto-create batch immediately
    if (rideSize === 4) {
      return await handleCase6_GroupSize4(ride);
    }

    throw new ApiError(400, `Invalid ride size: ${rideSize}`);
  } catch (error) {
    console.error("Error in routeRideRequest:", error);
    throw error;
  }
};
