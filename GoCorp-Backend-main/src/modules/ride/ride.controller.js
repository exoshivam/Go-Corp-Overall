import mongoose from "mongoose";
import { RideRequest } from "./ride.model.js";
import { User } from "../user/user.model.js";
import { Office } from "../office/office.model.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import {
  isWithinOfficeHours,
  isDuplicateBooking,
  isPastTime,
  isOneEndOffice,
  validateInvitedEmployees,
  getInvitedPeopleForRide,
  findRidesInvitingEmployee,
  getEmployeesInRideGroup
} from "./ride.service.js";
import { routeRideRequest, dissolveGroupAndReturnToPool } from "../polling/polling.service.js";
import { RideBatch } from "./batch.model.js";
import { Batched } from "../polling/batched.model.js";
import { Clustering } from "../polling/clustering.model.js";
import { validationResult } from "express-validator"

export const bookRide = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      employee_id,
      office_id,
      schedule_type,
      scheduled_at,
      pickup_address,
      pickup_location,
      drop_address,
      drop_location,
      solo_preference,
      destination_type,
      invited_employee_ids = []
    } = req.body;

    //criticall required feilds
    if (!employee_id || !office_id || !scheduled_at) {
      throw new ApiError(400, "Missing required fields");
    }

    //Validate invited employees
    const inviteValidation = validateInvitedEmployees(invited_employee_ids);
    if (!inviteValidation.valid) {
      throw new ApiError(400, inviteValidation.message);
    }

    //fetch office
    const office = await Office.findById(office_id);
    if (!office) throw new ApiError(404, "Office not found");

    //check if scheduled time is in the past
    if (isPastTime(scheduled_at)) {
      throw new ApiError(400, "Rides cannot be scheduled in the past");
    }

    //check office hours
    if (!isWithinOfficeHours(scheduled_at, office)) {
      throw new ApiError(400, "Ride request is outside office hours");
    }

    //check duplicate booking
    if (await isDuplicateBooking(employee_id, scheduled_at)) {
      throw new ApiError(400, "Duplicate ride request for the same time");
    }

    //check one end is office
    if (
      !isOneEndOffice(pickup_location, drop_location, office.office_location)
    ) {
      throw new ApiError(
        400,
        "Either pickup or drop location must be the office",
      );
    }

    const ride = await RideRequest.create({
      employee_id,
      office_id,
      destination_type,
      schedule_type,
      scheduled_at,
      pickup_address,
      pickup_location: {
        type: 'Point',
        coordinates: Array.isArray(pickup_location) ? pickup_location : pickup_location.coordinates
      },
      drop_address,
      drop_location: {
        type: 'Point',
        coordinates: Array.isArray(drop_location) ? drop_location : drop_location.coordinates
      },
      solo_preference,
      invited_employee_ids,
      otp: Math.floor(1000 + Math.random() * 9000).toString(),
    });

    if (ride) {
      console.log("New Ride Created");

      //submit ride to polling
      const pollingResult = await routeRideRequest(ride);

      // Increase user's total ride +1
      await User.findByIdAndUpdate(employee_id, { $inc: { total_rides: 1 } });

      //Refetch the ride to get the MODIFIED status from the polling system
      const updatedRide = await RideRequest.findById(ride._id)
        .populate('employee_id', 'name email profile_image')
        .populate('office_id', 'name office_location shift_start shift_end')
        .populate('invited_employee_ids', 'name email profile_image');

      res
        .status(201)
        .json(new ApiResponse(201, "Ride booked and submitted to polling successfully", {
          ride: updatedRide || ride,
          polling: pollingResult
        }));
    } else {
      throw new ApiError(500, "Failed to book ride");
    }
  } catch (e) {
    next(e);
  }
};

/**
 * Get the current active ride for the user
 */
export const getCurrentRide = async (req, res, next) => {
  try {
    const user_id = req.user._id;

    // MODIFIED: Search for rides where user is requester OR invited guest
    const ride = await RideRequest.findOne({
      $or: [
        { employee_id: user_id },
        { invited_employee_ids: user_id }
      ],
      status: { $nin: ["REJECTED", "CANCELLED", "COMPLETED"] } // Added COMPLETED safety
    })
      .sort({ createdAt: -1 })
      .populate('employee_id', 'name email contact profile_image')
      .populate('office_id', 'name office_location shift_start shift_end');

    if (!ride) {
      return res.status(200).json(new ApiResponse(200, "No active ride found", null));
    }

    // NEW: Role detection
    const isOwner = ride.employee_id._id.toString() === user_id.toString();

    // NEW: Include polling/clustering info for frontend visualization
    let responseData = { 
      ...ride.toJSON(),
      is_owner: isOwner 
    };

    // Check if ride is part of an active cluster/batch
    if (!["CANCELLED", "REJECTED"].includes(ride.status)) {
      const batchId = ride.batch_id;
      const clusterId = ride.cluster_id;

      let batch = batchId ? await Batched.findById(batchId).populate('driver_id', 'name contact vehicle driver_location profile_pic status') : null;
      let cluster = clusterId ? await Clustering.findById(clusterId) : null;

      // ATOMIC REPAIR: If we have a cluster but it points to a batch, follow it
      if (!batch && cluster?.batch_id) {
        batch = await Batched.findById(cluster.batch_id).populate('driver_id', 'name contact vehicle driver_location profile_pic status');
        
        // Hard-link repair: Fix the ride document if batch_id is missing
        if (batch) {
          await RideRequest.findByIdAndUpdate(ride._id, { batch_id: batch._id, cluster_id: null });
          console.log(`[Sync-Repair] Hard-linked ride ${ride._id} to batch ${batch._id}`);
        }
      }

      if (batch) {
        responseData.batch = {
          batch_id: batch._id,
          batch_size: batch.batch_size,
          status: batch.status,
          pickup_polyline: batch.pickup_polyline,
          driver_id: batch.driver_id, // This is now a populated object
          estimated_fare: batch.estimated_fare
        };
        
        // Status Sync: If batch is accepted, ensure ride reflects it
        if (batch.status === 'DRIVER_ACCEPTED' || batch.driver_accepted) {
          if (!["STARTED", "ARRIVED", "DROPPED_OFF", "COMPLETED"].includes(ride.status)) {
            responseData.status = "ACCEPTED";
          }
        } else if (ride.status !== 'CLUSTERED' && ride.status !== 'COMPLETED') {
          responseData.status = 'CLUSTERED';
        }
      } else if (cluster) {
        responseData.clustering = {
          cluster_id: cluster._id,
          current_size: cluster.current_size,
          status: cluster.status,
          pickup_polyline: cluster.pickup_polyline,
        };
        if (ride.status === 'PENDING') {
          responseData.status = 'IN_CLUSTERING';
        }
      }

      // Load all participants from the group
      const targetRides = batch?.ride_ids || cluster?.ride_ids || [];
      if (targetRides.length > 0) {
        const groupRides = await RideRequest.find({ _id: { $in: targetRides } })
          .populate('employee_id', 'name email contact profile_image')
          .populate('invited_employee_ids', 'name email contact profile_image');

        // Sort groupRides to match targetRides order
        const ridesMap = new Map(groupRides.map(r => [r._id.toString(), r]));
        const sortedRides = targetRides.map(id => ridesMap.get(id.toString())).filter(Boolean);

        const participantsList = [];
        sortedRides.forEach((gr, bIdx) => {
          if (gr.employee_id) {
            participantsList.push({
              ...gr.employee_id.toObject(),
              is_requester: true,
              ride_id: gr._id,
              booking_index: bIdx,
              pickup_location: gr.pickup_location,
              drop_location: gr.drop_location,
              contact: gr.employee_id.contact
            });
          }
          gr.invited_employee_ids.forEach(inv => {
            participantsList.push({
              ...inv.toObject(),
              is_requester: false,
              ride_id: gr._id,
              booking_index: bIdx,
              pickup_location: gr.pickup_location,
              drop_location: gr.drop_location,
              contact: inv.contact
            });
          });
        });

        responseData.group_participants = participantsList;
      }
    }

    res.status(200).json(new ApiResponse(200, "Current ride retrieved", responseData));
  } catch (error) {
    next(error || new ApiError(500, "Error fetching current ride"));
  }
};

export const getClusters = async (req, res) => {
  try {
    const { office_id, direction, scheduled_at } = req.query;
    const office = await Office.findById(office_id);

    const batches = await RideBatch.find({
      office_id,
      direction,
      scheduled_at: new Date(scheduled_at),
    });

    const rides = await RideRequest.find({
      office_id,
      direction,
      scheduled_at: new Date(scheduled_at),
      status: "CLUSTERED",
    });

    res.json({
      batches,
      rides,
      office,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getInvitedPeople = async (req, res, next) => {
  try {
    const { employee_id } = req.params;

    if (!employee_id) {
      throw new ApiError(400, "Employee ID is required");
    }

    // Validate employee_id format
    if (!employee_id.match(/^[0-9a-fA-F]{24}$/)) {
      throw new ApiError(400, "Invalid employee ID format");
    }

    const result = await getInvitedPeopleForRide(employee_id);

    res.status(200).json(
      new ApiResponse(200, "Invited people retrieved successfully", result)
    );
  } catch (error) {
    next(error || new ApiError(500, "Error retrieving invited people"));
  }
};

// For clustering service: Get rides where this employee was invited
export const getRidesWithEmployeeInvite = async (req, res, next) => {
  try {
    const { employee_id, scheduled_at } = req.query;

    if (!employee_id || !scheduled_at) {
      throw new ApiError(400, "Employee ID and scheduled time are required");
    }

    const rides = await findRidesInvitingEmployee(employee_id, scheduled_at);

    res.status(200).json(
      new ApiResponse(200, "Rides with invites retrieved", {
        count: rides.length,
        rides
      })
    );
  } catch (error) {
    next(error || new ApiError(500, "Error retrieving rides with invites"));
  }
};

// For clustering service: Get all employees in a ride (requester + invited)
export const getRideEmployeeGroup = async (req, res, next) => {
  try {
    const { ride_id } = req.params;

    if (!ride_id) {
      throw new ApiError(400, "Ride ID is required");
    }

    const employees = await getEmployeesInRideGroup(ride_id);

    res.status(200).json(
      new ApiResponse(200, "Ride employee group retrieved", {
        total: employees.length,
        employee_ids: employees
      })
    );
  } catch (error) {
    next(error || new ApiError(500, "Error retrieving ride employee group"));
  }
};

export const cancelRide = async (req, res, next) => {
  try {
    const { ride_id } = req.params;
    const { cancel_reason } = req.body;
    const userId = req.user._id.toString();

    const ride = await RideRequest.findById(ride_id);
    if (!ride) throw new ApiError(404, "Ride not found");

    const isOwner = ride.employee_id.toString() === userId;
    const isGuest = ride.invited_employee_ids.some(id => id.toString() === userId);

    if (!isOwner && !isGuest) {
      throw new ApiError(403, "You are not authorized to cancel this ride");
    }

    // Safety Guard: Cannot cancel if a Pilot has already accepted
    if (ride.batch_id) {
      const batch = await Batched.findById(ride.batch_id);
      if (batch && ["DRIVER_ACCEPTED", "IN_TRANSIT", "COMPLETED"].includes(batch.status)) {
        throw new ApiError(400, "Cannot cancel once a Pilot has accepted the ride.");
      }
    }

    // Identify if the group needs dissolution
    const groupId = ride.batch_id || ride.cluster_id;
    const groupType = ride.batch_id ? 'batch' : 'cluster';

    if (isOwner) {
      // Branch A: Owner cancels -> Whole RideRequest dies
      ride.status = "CANCELLED";
      ride.cancelled_at = new Date();
      ride.cancel_reason = cancel_reason || "Cancelled by owner";
      await ride.save();

      // Dissolve group if it exists (excluding this cancelled ride)
      if (groupId) {
        await dissolveGroupAndReturnToPool(groupId, groupType, [ride._id.toString()]);
      }
    } else {
      // Branch B: Guest cancels -> Only remove guest from the booking
      await RideRequest.findByIdAndUpdate(ride._id, {
        $pull: { invited_employee_ids: req.user._id }
      });

      // Dissolve group if it exists (the RideRequest itself survives but changed composition)
      if (groupId) {
        // We dissolve even if it's "just" a guest leaving, as the route/fare needs refresh
        // and user wants all batched cancellations to go back to clustering pool.
        await dissolveGroupAndReturnToPool(groupId, groupType, []); 
      }
    }

    res.status(200).json(new ApiResponse(200, "Cancellation processed successfully", { 
      type: isOwner ? "FULL_CANCEL" : "GUEST_REMOVAL" 
    }));
  } catch (error) {
    next(error || new ApiError(500, "Error cancelling ride"));
  }
};

export const getRideById = async (req, res, next) => {
  try {
    const { ride_id } = req.params;

    if (!ride_id.match(/^[0-9a-fA-F]{24}$/)) {
      throw new ApiError(400, "Invalid ride ID format");
    }

    const ride = await RideRequest.findById(ride_id)
      .populate('employee_id', 'name email profile_image')
      .populate('office_id', 'name office_location shift_start shift_end')
      .populate('invited_employee_ids', 'name email profile_image');

    if (!ride) throw new ApiError(404, "Ride not found");

    const userId = req.user._id.toString();
    const isOwner = ride.employee_id._id.toString() === userId;
    const isGuest = ride.invited_employee_ids.some(id => id._id.toString() === userId);

    if (!isOwner && !isGuest) {
      throw new ApiError(403, "You are not authorized to view this ride");
    }

    // NEW: Include polling/clustering info for frontend visualization
    let responseData = { 
      ...ride.toJSON(),
      is_owner: isOwner
    };

    // Check if ride is part of an active cluster/batch
    if (!["CANCELLED", "REJECTED"].includes(ride.status)) {
      const batchId = ride.batch_id;
      const clusterId = ride.cluster_id;

      let batch = batchId ? await Batched.findById(batchId).populate('driver_id', 'name contact vehicle driver_location profile_pic status') : null;
      let cluster = clusterId ? await Clustering.findById(clusterId) : null;

      // ATOMIC REPAIR: Check both ways to find the batch
      if (!batch && cluster?.batch_id) {
        batch = await Batched.findById(cluster.batch_id).populate('driver_id', 'name contact vehicle driver_location profile_pic status');
        
        // Fix the ride document if batch_id is missing
        if (batch) {
          await RideRequest.findByIdAndUpdate(ride._id, { batch_id: batch._id, cluster_id: null });
          console.log(`[Sync-Repair] Hard-linked ride ${ride._id} to batch ${batch._id}`);
        }
      }

      if (batch) {
        // AUTO-REPAIR: If solo_distance is missing but we have a polyline, calculate it now
        if (!ride.solo_distance && ride.route_polyline?.coordinates?.length > 0) {
          const { calculatePolylineDistance } = await import('../polling/polling.service.js');
          ride.solo_distance = calculatePolylineDistance(ride.route_polyline);
          await RideRequest.findByIdAndUpdate(ride._id, { solo_distance: ride.solo_distance });
          console.log(`[Sync-Repair] Recovered solo_distance: ${ride.solo_distance} for ride ${ride._id}`);
        }

        responseData.batch = {
          batch_id: batch._id,
          batch_size: batch.batch_size,
          status: batch.status,
          pickup_polyline: batch.pickup_polyline,
          driver_id: batch.driver_id,
          estimated_distance: batch.estimated_distance, // Total Group Distance
          estimated_fare: batch.estimated_fare, // Total batch fare
          allocated_fare: ride.allocated_fare,   // Individually calculated share
          solo_estimated_fare: ride.solo_estimated_fare, // What they would pay solo
          solo_distance: ride.solo_distance // Their direct travel distance
        };
        
        if (batch.status === 'DRIVER_ACCEPTED' || batch.driver_accepted) {
          if (!["STARTED", "ARRIVED", "DROPPED_OFF", "COMPLETED"].includes(ride.status)) {
            responseData.status = "ACCEPTED";
          }
        } else if (ride.status !== 'CLUSTERED' && ride.status !== 'COMPLETED') {
          responseData.status = 'CLUSTERED';
        }
      } else if (cluster) {
        responseData.clustering = {
          cluster_id: cluster._id,
          current_size: cluster.current_size,
          status: cluster.status,
          pickup_polyline: cluster.pickup_polyline,
        };
        if (ride.status === 'PENDING') {
          responseData.status = 'IN_CLUSTERING';
        }
      }

      // 3. UNIFIED MANIFEST: Load all participants from the group
      const targetRides = batch?.ride_ids || cluster?.ride_ids || [];
      if (targetRides.length > 0) {
        const groupRides = await RideRequest.find({ _id: { $in: targetRides } })
          .populate('employee_id', 'name email profile_image')
          .populate('invited_employee_ids', 'name email profile_image');

        // Sort groupRides to match targetRides order
        const ridesMap = new Map(groupRides.map(r => [r._id.toString(), r]));
        const sortedRides = targetRides.map(id => ridesMap.get(id.toString())).filter(Boolean);

        const participantsList = [];
        sortedRides.forEach(gr => {
          if (gr.employee_id) {
            participantsList.push({
              ...gr.employee_id.toObject(),
              is_requester: true,
              ride_id: gr._id,
              pickup_location: gr.pickup_location,
              drop_location: gr.drop_location
            });
          }
          gr.invited_employee_ids.forEach(inv => {
            participantsList.push({
              ...inv.toObject(),
              is_requester: false,
              ride_id: gr._id,
              pickup_location: gr.pickup_location,
              drop_location: gr.drop_location
            });
          });
        });

        responseData.group_participants = participantsList;
      }

    }

    res.status(200).json(new ApiResponse(200, "Ride retrieved successfully", responseData));
  } catch (error) {
    next(error || new ApiError(500, "Error retrieving ride"));
  }
};

export const getPendingRides = async (req, res, next) => {
  try {
    const { latitude, longitude } = req.query;

    // Validate location coordinates
    if (!latitude || !longitude) {
      throw new ApiError(400, "Driver location (latitude, longitude) is required");
    }

    const driverLat = parseFloat(latitude);
    const driverLng = parseFloat(longitude);

    // Validate parsed coordinates
    if (isNaN(driverLat) || isNaN(driverLng)) {
      throw new ApiError(400, "Invalid latitude or longitude values");
    }

    // Validate coordinate ranges
    if (driverLat < -90 || driverLat > 90 || driverLng < -180 || driverLng > 180) {
      throw new ApiError(400, "Invalid coordinate ranges");
    }

    const now = new Date();
    const fifteenMinutesLater = new Date(now.getTime() + 15 * 60000);
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60000);
    const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60000); // 2 hours for more flexibility

    console.log(`\n🔍 === SEARCHING FOR RIDES ===`);
    console.log(`🔍 Driver Location: [${driverLat}, ${driverLng}]`);
    console.log(`🔍 Current Time: ${now.toISOString()}`);
    console.log(`🔍 Time Window: ${fifteenMinutesAgo.toISOString()} to ${twoHoursLater.toISOString()}`);

    // First, check total rides in database
    const totalRides = await RideRequest.countDocuments({});
    console.log(`📊 Total rides in database: ${totalRides}`);

    // Check pending rides
    const pendingRides = await RideRequest.countDocuments({ status: "PENDING" });
    console.log(`📊 PENDING rides in database: ${pendingRides}`);

    // Check all ride statuses  
    const allStatuses = await RideRequest.distinct("status");
    console.log(`📊 Available statuses in database:`, allStatuses);

    // Get all PENDING rides (regardless of time) for debugging
    const allPendingRidesDebug = await RideRequest.find({ status: "PENDING" }).lean();
    console.log(`📊 All PENDING rides (any time): ${allPendingRidesDebug.length}`);
    if (allPendingRidesDebug.length > 0) {
      allPendingRidesDebug.forEach(ride => {
        const timeDiff = ride.scheduled_at ? ride.scheduled_at.getTime() - now.getTime() : null;
        console.log(`  - Ride ${ride._id}: scheduled_at="${ride.scheduled_at}", timeDiff=${timeDiff}ms (${(timeDiff / 60000).toFixed(1)} min)`);
      });
    }

    // Get all pending rides matching time criteria
    const allPendingRides = await RideRequest.find({
      status: "PENDING",
      $or: [
        // Instant rides (scheduled_at is in the past)
        {
          scheduled_at: { $lt: now },
        },
        // Scheduled rides (show from 15 minutes before to 2 hours ahead)
        {
          scheduled_at: {
            $gte: fifteenMinutesAgo,
            $lte: twoHoursLater,
          },
        },
      ],
    })
      .populate("employee_id", "name email contact")
      .populate("office_id", "office_name office_location")
      .lean();

    console.log(`📍 Found ${allPendingRides.length} pending rides matching time criteria`);

    if (allPendingRides.length > 0) {
      allPendingRides.forEach(ride => {
        console.log(`  - Ride ${ride._id}: scheduled_at=${ride.scheduled_at.toISOString()}, pickup=[${ride.pickup_location.coordinates}]`);
      });
    }

    // Helper function to calculate distance between two coordinates (Haversine formula)
    const calculateDistance = (lat1, lon1, lat2, lon2) => {
      const R = 6371; // Earth's radius in kilometers
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distanceKm = R * c;
      return distanceKm;
    };

    // Filter rides within 3 km
    const nearbyRides = allPendingRides.filter((ride) => {
      if (!ride.pickup_location || !ride.pickup_location.coordinates || ride.pickup_location.coordinates.length < 2) {
        console.warn(`⚠️ Ride ${ride._id} has invalid pickup_location:`, ride.pickup_location);
        return false;
      }

      // Coordinates in database should be [longitude, latitude]
      const [pickupLng, pickupLat] = ride.pickup_location.coordinates;

      const distanceKm = calculateDistance(driverLat, driverLng, pickupLat, pickupLng);

      console.log(`📌 Ride ${ride._id}: Distance = ${distanceKm.toFixed(2)} km, Pickup: [${pickupLat}, ${pickupLng}]`);

      // Return true if distance is less than 3 km
      return distanceKm <= 1000;
    });

    console.log(`✅ Found ${nearbyRides.length} rides within 3 km`);

    if (nearbyRides.length === 0) {
      return res.status(200).json(new ApiResponse(200, "No pending rides available nearby", null));
    }

    // Return the first ride (sorted by scheduled_at)
    const closestRide = nearbyRides.sort((a, b) => {
      const aTime = a.scheduled_at ? new Date(a.scheduled_at).getTime() : now.getTime();
      const bTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : now.getTime();
      return aTime - bTime;
    })[0];

    console.log(`🎯 Sending ride ${closestRide._id} to driver`);

    res.status(200).json(new ApiResponse(200, "Pending rides retrieved successfully", closestRide));
  } catch (e) {
    console.error("❌ Error in getPendingRides:", e);
    next(e);
  }
};

export const getPendingBatches = async (req, res, next) => {
  try {
    const { latitude, longitude } = req.query;

    if (!latitude || !longitude) {
      throw new ApiError(400, "Driver location (latitude, longitude) is required");
    }

    const driverLat = parseFloat(latitude);
    const driverLng = parseFloat(longitude);

    if (isNaN(driverLat) || isNaN(driverLng)) {
      throw new ApiError(400, "Invalid latitude or longitude values");
    }

    const now = new Date();
    const batches = await Batched.find({
      status: { $in: ["READY_FOR_ASSIGNMENT", "CREATED"] },
      driver_id: { $exists: false }
    }).populate("office_id", "office_name office_location");

    const calculateDistance = (lat1, lon1, lat2, lon2) => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    console.log(`🔍 Checking ${batches.length} pending batches for driver at [${driverLat}, ${driverLng}]`);

    const nearbyBatches = batches.filter((batch) => {
      if (!batch.pickup_centroid || !batch.pickup_centroid.coordinates || batch.pickup_centroid.coordinates.length < 2) {
        console.log(`⚠️ Batch ${batch._id} has incomplete pickup_centroid`);
        return false;
      }
      const [pickupLng, pickupLat] = batch.pickup_centroid.coordinates;
      const distanceKm = calculateDistance(driverLat, driverLng, pickupLat, pickupLng);

      console.log(`📍 Batch ${batch._id} distance: ${distanceKm.toFixed(2)}km (Status: ${batch.status})`);

      return distanceKm <= 1000;
    });

    if (nearbyBatches.length === 0) {
      return res.status(200).json(new ApiResponse(200, "No pending batches available nearby", null));
    }

    // Get the closest batch and refetch with full population for the frontend
    const closestBatchRaw = nearbyBatches.sort((a, b) => {
      const aTime = a.scheduled_at ? new Date(a.scheduled_at).getTime() : now.getTime();
      const bTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : now.getTime();
      return aTime - bTime;
    })[0];

    // Refetch with deep population for the frontend
    const closestBatch = await Batched.findById(closestBatchRaw._id)
      .populate("office_id", "office_name office_location")
      .populate({
        path: "ride_ids",
        populate: {
          path: "employee_id",
          select: "name email contact first_name last_name"
        }
      });

    // Transform ride_ids to rides for frontend compatibility
    const responseData = closestBatch.toObject();
    responseData.rides = responseData.ride_ids;
    delete responseData.ride_ids;

    console.log(`🎯 Sending batch ${closestBatch._id} with ${responseData.rides?.length} rides to driver`);
    console.log(`🗺️ Polyline check: route_polyline=${!!responseData.route_polyline}, pickup_polyline=${!!responseData.pickup_polyline}`);
    console.log(`💰 Batch fare: estimated_fare=${responseData.estimated_fare}`);

    res.status(200).json(new ApiResponse(200, "Pending batches retrieved successfully", responseData));
  } catch (e) {
    console.error("❌ Error in getPendingBatches:", e);
    next(e);
  }
};

export const verifyOtp = async (req, res, next) => {
  try {
    const { ride_id, otp } = req.body;

    if (!ride_id || !otp) {
      throw new ApiError(400, "Ride ID and OTP are required");
    }

    const ride = await RideRequest.findById(ride_id);

    if (!ride) {
      throw new ApiError(404, "Ride not found");
    }

    if (ride.otp !== otp) {
      throw new ApiError(400, "Invalid OTP");
    }

    // Update ride status to STARTED
    ride.status = "STARTED";
    await ride.save();

    console.log(`✅ Ride ${ride_id} started successfully via OTP`);

    res.status(200).json(new ApiResponse(200, "OTP verified and ride started successfully", ride));
  } catch (error) {
    next(error || new ApiError(500, "Error verifying OTP"));
  }
};

/**
 * Admin: Get latest ride for a specific user
 */
export const getLatestRideForAdmin = async (req, res, next) => {
  try {
    const { user_id } = req.params;

    if (!user_id.match(/^[0-9a-fA-F]{24}$/)) {
      throw new ApiError(400, "Invalid user ID format");
    }

    const ride = await RideRequest.findOne({
      employee_id: user_id,
      status: { $ne: "REJECTED" } // We want the latest real ride
    })
      .sort({ createdAt: -1 })
      .populate('employee_id', 'name email contact profile_image')
      .populate('office_id', 'name office_location shift_start shift_end');

    if (!ride) {
      return res.status(200).json(new ApiResponse(200, "No ride history found", null));
    }

    // NEW: Include polling/clustering info for frontend visualization
    let responseData = { ...ride.toJSON() };

    // Check if ride is part of an active cluster/batch
    if (!["CANCELLED", "COMPLETED", "DROPPED_OFF", "REJECTED"].includes(ride.status)) {
      const { Clustering } = await import('../polling/clustering.model.js');
      const { Batched } = await import('../polling/batched.model.js');

      const batchId = ride.batch_id;
      const clusterId = ride.cluster_id;

      let batch = batchId ? await Batched.findById(batchId).populate('driver_id', 'name contact vehicle driver_location profile_pic status') : null;
      let cluster = clusterId ? await Clustering.findById(clusterId) : null;

      if (!batch && cluster?.batch_id) {
        batch = await Batched.findById(cluster.batch_id).populate('driver_id', 'name contact vehicle driver_location profile_pic status');
      }

      if (batch) {
        responseData.batch = {
          batch_id: batch._id,
          batch_size: batch.batch_size,
          status: batch.status,
          pickup_polyline: batch.pickup_polyline,
          driver_id: batch.driver_id,
          estimated_fare: batch.estimated_fare
        };
        if (ride.status !== 'CLUSTERED' && ride.status !== 'COMPLETED') {
          responseData.status = 'CLUSTERED';
        }
      } else if (cluster) {
        responseData.clustering = {
          cluster_id: cluster._id,
          current_size: cluster.current_size,
          status: cluster.status,
          pickup_polyline: cluster.pickup_polyline,
        };
        if (ride.status === 'PENDING') {
          responseData.status = 'IN_CLUSTERING';
        }
      }

      // Load all participants from the group
      const targetRides = batch?.ride_ids || cluster?.ride_ids || [];
      if (targetRides.length > 0) {
        const groupRides = await RideRequest.find({ _id: { $in: targetRides } })
          .populate('employee_id', 'name email contact profile_image')
          .populate('invited_employee_ids', 'name email contact profile_image');

        // Sort groupRides to match targetRides order
        const ridesMap = new Map(groupRides.map(r => [r._id.toString(), r]));
        const sortedRides = targetRides.map(id => ridesMap.get(id.toString())).filter(Boolean);

        const participantsList = [];
        sortedRides.forEach((gr, bIdx) => {
          if (gr.employee_id) {
            participantsList.push({
              ...gr.employee_id.toObject(),
              is_requester: true,
              ride_id: gr._id,
              booking_index: bIdx,
              pickup_location: gr.pickup_location,
              drop_location: gr.drop_location,
              contact: gr.employee_id.contact
            });
          }
          gr.invited_employee_ids.forEach(inv => {
            participantsList.push({
              ...inv.toObject(),
              is_requester: false,
              ride_id: gr._id,
              booking_index: bIdx,
              pickup_location: gr.pickup_location,
              drop_location: gr.drop_location,
              contact: inv.contact
            });
          });
        });

        responseData.group_participants = participantsList;
      }

    }

    res.status(200).json(new ApiResponse(200, "User ride summary retrieved", responseData));
  } catch (error) {
    next(error || new ApiError(500, "Error retrieving user summary"));
  }
};

export const getAllOfficeRides = async (req, res, next) => {
  try {
    const { office_id } = req.params;
    
    if (!office_id.match(/^[0-9a-fA-F]{24}$/)) {
      throw new ApiError(400, "Invalid office ID format");
    }

    const rides = await RideRequest.find({ office_id })
      .populate('employee_id', 'name email contact profile_image')
      .sort({ createdAt: -1 });

    res.status(200).json(new ApiResponse(200, "Rides history retrieved successfully", rides));
  } catch (error) {
    next(error || new ApiError(500, "Error retrieving rides history"));
  }
};

export const getReportStats = async (req, res, next) => {
  try {
    const { office_id } = req.params;

    if (!office_id.match(/^[0-9a-fA-F]{24}$/)) {
      throw new ApiError(400, "Invalid office ID format");
    }

    // 1. Calculate Total Savings from User lifetime stats
    const savingsData = await User.aggregate([
      { $match: { office_id: new mongoose.Types.ObjectId(office_id) } },
      {
        $group: {
          _id: null,
          totalCarpool: { $sum: "$total_carpool_spent" },
          totalSolo: { $sum: "$total_solo_spent_potential" }
        }
      }
    ]);

    const { totalCarpool = 0, totalSolo = 0 } = savingsData[0] || {};
    const totalSavings = totalSolo - totalCarpool;

    // 2. Rank users by COMPLETED ride count
    const frequentUsers = await RideRequest.aggregate([
      { 
        $match: { 
          office_id: new mongoose.Types.ObjectId(office_id),
          status: "COMPLETED" 
        } 
      },
      {
        $group: {
          _id: "$employee_id",
          rides: { $sum: 1 }
        }
      },
      { $sort: { rides: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userDetails"
        }
      },
      { $unwind: "$userDetails" },
      {
        $project: {
          _id: 1,
          rides: 1,
          name: "$userDetails.name",
          email: "$userDetails.email",
          profile_pic: "$userDetails.profile_pic"
        }
      }
    ]);

    // 3. Monthly Spend Comparison (Last 6 Months, fixed window)
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const formattedComparison = [];
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    for (let i = 5; i >= 0; i--) {
      let targetMonth = currentMonth - i;
      let targetYear = currentYear;
      
      if (targetMonth < 0) {
        targetMonth += 12;
        targetYear -= 1;
      }

      formattedComparison.push({
        month: targetMonth + 1,
        year: targetYear,
        label: monthNames[targetMonth],
        value: 0
      });
    }

    const sixMonthsAgo = new Date(formattedComparison[0].year, formattedComparison[0].month - 1, 1);

    const monthlyComparison = await RideRequest.aggregate([
      {
        $match: {
          office_id: new mongoose.Types.ObjectId(office_id),
          status: "COMPLETED",
          scheduled_at: { $gte: sixMonthsAgo }
        }
      },
      {
        $group: {
          _id: {
            month: { $month: "$scheduled_at" },
            year: { $year: "$scheduled_at" }
          },
          totalSpend: { $sum: "$allocated_fare" }
        }
      }
    ]);

    formattedComparison.forEach(item => {
      const match = monthlyComparison.find(db => db._id.month === item.month && db._id.year === item.year);
      if (match) item.value = Math.round(match.totalSpend);
    });

    res.status(200).json(new ApiResponse(200, "Report stats retrieved", {
      savings: {
        totalSolo,
        totalCarpool,
        totalSavings
      },
      frequentUsers,
      monthlyComparison: formattedComparison
    }));

  } catch (error) {
    next(error || new ApiError(500, "Error fetching report stats"));
  }
};