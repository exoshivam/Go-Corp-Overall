import { RideRequest } from "../ride/ride.model.js"; import mongoose from "mongoose";
import { Clustering } from "./clustering.model.js";
import { Batched } from "./batched.model.js";
import { User } from "../user/user.model.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import { routeRideRequest } from "./polling.service.js";
import { validationResult } from "express-validator";

export const submitRideForPolling = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(new ApiResponse(400, "Validation errors", errors.array()));
    }

    const { ride_id } = req.body;

    const ride = await RideRequest.findById(ride_id);
    if (!ride) {
      throw new ApiError(404, "Ride request not found");
    }

    if (ride.status !== "PENDING") {
      throw new ApiError(400, `Ride must be in PENDING status, currently ${ride.status}`);
    }

    const result = await routeRideRequest(ride);

    let response = {
      ride_id: ride._id,
      ...result,
    };

    if (result.batch_id) {
      const batch = await Batched.findById(result.batch_id);
      response.batch_details = {
        batch_id: batch._id,
        size: batch.batch_size,
        status: batch.status,
      };
    }

    if (result.cluster_id) {
      const cluster = await Clustering.findById(result.cluster_id);
      response.cluster_details = {
        cluster_id: cluster._id,
        size: cluster.current_size,
        status: cluster.status,
      };
    }

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          `Ride routed successfully via Case ${result.case}`,
          response
        )
      );
  } catch (error) {
    next(error);
  }
};

export const getRideClusteringStatus = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(new ApiResponse(400, "Validation errors", errors.array()));
    }

    const { ride_id } = req.params;

    const ride = await RideRequest.findById(ride_id);
    if (!ride) {
      throw new ApiError(404, "Ride not found");
    }

    let status = {
      ride_id: ride._id,
      ride_status: ride.status,
      employee_id: ride.employee_id,
      scheduled_at: ride.scheduled_at,
      pickup_location: ride.pickup_location.coordinates,
      drop_location: ride.drop_location.coordinates,
    };

    if (ride.status === "IN_CLUSTERING") {
      const cluster = await Clustering.findOne({ ride_ids: ride_id });
      if (cluster) {
        status.cluster_id = cluster._id;
        status.cluster_size = cluster.current_size;
        status.cluster_status = cluster.status;
        status.cluster_rides = cluster.ride_ids;
      }
    }

    if (ride.batch_id) {
      const batch = await Batched.findById(ride.batch_id);
      if (batch) {
        status.batch_id = batch._id;
        status.batch_size = batch.batch_size;
        status.batch_status = batch.status;
        status.batch_rides = batch.ride_ids;
        if (batch.driver_id) {
          status.assigned_driver_id = batch.driver_id;
          status.assigned_at = batch.assigned_at;
        }
      }
    }

    res
      .status(200)
      .json(new ApiResponse(200, "Ride clustering status retrieved", status));
  } catch (error) {
    next(error);
  }
};

export const getClustersByOfficeAndTime = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(new ApiResponse(400, "Validation errors", errors.array()));
    }

    const { office_id, scheduled_at } = req.query;

    const dateObj = new Date(scheduled_at);
    const dayStart = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const clusters = await Clustering.find({
      office_id: office_id,
      scheduled_at: { $gte: dayStart, $lt: dayEnd },
    })
      .populate("ride_ids", "_id employee_id pickup_location drop_location")
      .sort({ createdAt: -1 });

    const total = clusters.length;
    const activeCount = clusters.filter((c) => c.status === "IN_CLUSTERING").length;
    const readyCount = clusters.filter((c) => c.status === "READY_FOR_BATCH").length;

    res.status(200).json(
      new ApiResponse(200, "Clusters retrieved", {
        total,
        active: activeCount,
        ready_for_batch: readyCount,
        clusters: clusters.map((c) => ({
          cluster_id: c._id,
          size: c.current_size,
          status: c.status,
          ride_count: c.ride_ids.length,
          scheduled_at: c.scheduled_at,
          created_at: c.createdAt,
        })),
      })
    );
  } catch (error) {
    next(error);
  }
};

export const getBatchesByOfficeAndTime = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(new ApiResponse(400, "Validation errors", errors.array()));
    }

    const { office_id, scheduled_at, status } = req.query;

    const dateObj = new Date(scheduled_at);
    const dayStart = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    let query = {
      office_id: office_id,
      scheduled_at: { $gte: dayStart, $lt: dayEnd },
    };

    if (status) {
      query.status = status;
    }

    const batches = await Batched.find(query)
      .populate("ride_ids", "_id employee_id pickup_location drop_location")
      .populate("driver_id", "_id name email vehicle")
      .sort({ createdAt: -1 });

    res.status(200).json(
      new ApiResponse(200, "Batches retrieved", {
        total: batches.length,
        batches: batches.map((b) => ({
          batch_id: b._id,
          size: b.batch_size,
          status: b.status,
          ride_ids: b.ride_ids.map((r) => r._id),
          driver_assigned: b.driver_id ? true : false,
          assigned_at: b.assigned_at,
          batched_at: b.batched_at,
          force_batched: b.metadata.force_batched,
          estimated_fare: b.estimated_fare,
          estimated_distance: b.estimated_distance,
        })),
      })
    );
  } catch (error) {
    next(error);
  }
};

export const getClusterDetails = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(new ApiResponse(400, "Validation errors", errors.array()));
    }

    const { cluster_id } = req.params;

    const cluster = await Clustering.findById(cluster_id)
      .populate("ride_ids", "_id employee_id pickup_location drop_location scheduled_at")
      .populate("office_id", "_id name");

    if (!cluster) {
      throw new ApiError(404, "Cluster not found");
    }

    res.status(200).json(
      new ApiResponse(200, "Cluster details retrieved", {
        cluster_id: cluster._id,
        office: cluster.office_id,
        scheduled_at: cluster.scheduled_at,
        size: cluster.current_size,
        status: cluster.status,
        rides: cluster.ride_ids,
        ready_for_batch_at: cluster.ready_for_batch_at,
        batch_id: cluster.batch_id,
        metadata: cluster.metadata,
      })
    );
  } catch (error) {
    next(error);
  }
};

export const getBatchDetails = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(new ApiResponse(400, "Validation errors", errors.array()));
    }

    const { batch_id } = req.params;

    const batch = await Batched.findById(batch_id)
      .populate("ride_ids", "_id employee_id pickup_location drop_location")
      .populate("driver_id", "_id name email contact vehicle")
      .populate("office_id", "_id name");

    if (!batch) {
      throw new ApiError(404, "Batch not found");
    }

    res.status(200).json(
      new ApiResponse(200, "Batch details retrieved", {
        batch_id: batch._id,
        office: batch.office_id,
        scheduled_at: batch.scheduled_at,
        size: batch.batch_size,
        status: batch.status,
        rides: batch.ride_ids,
        driver: batch.driver_id || null,
        assigned_at: batch.assigned_at,
        batched_at: batch.batched_at,
        metadata: batch.metadata,
      })
    );
  } catch (error) {
    next(error);
  }
};

export const acceptBatch = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(new ApiResponse(400, "Validation errors", errors.array()));
    }

    const { batch_id } = req.body;
    const driver_id = req.driver._id;

    const batch = await Batched.findById(batch_id);
    if (!batch) {
      throw new ApiError(404, "Batch not found");
    }

    const updatedBatch = await Batched.findOneAndUpdate(
      { 
        _id: batch_id, 
        status: { $in: ["CREATED", "READY_FOR_ASSIGNMENT"] },
        driver_accepted: false 
      },
      {
        $set: {
          driver_id,
          driver_accepted: true,
          accepted_at: new Date(),
          assigned_at: batch.assigned_at || new Date(),
          status: "DRIVER_ACCEPTED",
        }
      },
      { new: true }
    )
      .populate("ride_ids", "_id employee_id invited_employee_ids pickup_location drop_location status solo_distance")
      .populate("driver_id", "_id name email contact vehicle profile_pic status")
      .populate("office_id", "_id name office_location");

    if (!updatedBatch) {
      const alreadyAccepted = await Batched.findOne({ _id: batch_id, driver_id, status: "DRIVER_ACCEPTED" });
      if (alreadyAccepted) {
         return res.status(200).json(new ApiResponse(200, "Batch already accepted by you", alreadyAccepted));
      }
      throw new ApiError(400, "Batch already accepted by another driver or is unavailable");
    }

    if (updatedBatch && updatedBatch.ride_ids.length > 0) {
      const calculateDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLon = ((lon2 - lon1) * Math.PI) / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
      };

      let totalWeightedDistance = 0;
      const rideMetaMap = updatedBatch.ride_ids.map(r => {
        const [pLng, pLat] = r.pickup_location.coordinates;
        const [dLng, dLat] = r.drop_location.coordinates;
        const distance = calculateDistance(pLat, pLng, dLat, dLng);
        
        const occupantCount = 1 + (r.invited_employee_ids?.length || 0);
        const weightedDistance = distance * occupantCount;
        
        totalWeightedDistance += weightedDistance;
        return { id: r._id, weightedDistance, occupantCount };
      });

      for (const rideMeta of rideMetaMap) {
        let allocatedFare = 0;
        
        const rideRef = updatedBatch.ride_ids.find(r => r._id.toString() === rideMeta.id.toString());
        const soloDist = rideRef?.solo_distance || (rideMeta.weightedDistance / rideMeta.occupantCount) || 2.0;
        const calculatedMinFare = Math.round(40 + (soloDist * 12));

        if (totalWeightedDistance > 0 && updatedBatch.estimated_fare > 0) {
          const proportion = rideMeta.weightedDistance / totalWeightedDistance;
          allocatedFare = Math.round(updatedBatch.estimated_fare * proportion);
          
          allocatedFare = Math.max(allocatedFare, Math.round(calculatedMinFare * 0.7)); 
        } else {
          allocatedFare = calculatedMinFare;
        }

        await RideRequest.findByIdAndUpdate(rideMeta.id, {
          $set: { 
            status: "ACCEPTED",
            allocated_fare: allocatedFare
          }
        });
      }

      console.log(`[Batch-Sync] Synchronized ${updatedBatch.ride_ids.length} rides to ACCEPTED and allocated fares for batch ${batch_id}`);
    }

    console.log(`[Batch Acceptance] Driver ${driver_id} accepted batch ${batch_id}`);

    res.status(200).json(
      new ApiResponse(200, "Batch accepted successfully", {
        batch_id: updatedBatch._id,
        driver_id: updatedBatch.driver_id._id,
        driver_details: {
          name: updatedBatch.driver_id.name,
          vehicle: updatedBatch.driver_id.vehicle,
          profile_pic: updatedBatch.driver_id.profile_pic
        },
        driver_accepted: updatedBatch.driver_accepted,
        accepted_at: updatedBatch.accepted_at,
        status: updatedBatch.status,
        batch_size: updatedBatch.batch_size,
        estimated_fare: updatedBatch.estimated_fare,
        estimated_distance: updatedBatch.estimated_distance,
      })
    );
  } catch (error) {
    next(error);
  }
};

export const getPollingStats = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(new ApiResponse(400, "Validation errors", errors.array()));
    }

    const { office_id, date } = req.query;
    console.log(`[Stats API] Request for office_id: ${office_id}, date: ${date}`);

    if (!office_id || !mongoose.Types.ObjectId.isValid(office_id)) {
      console.error(`[Stats API] Invalid office_id: ${office_id}`);
      throw new ApiError(400, "Invalid or missing Office ID");
    }

    const dateObj = date ? new Date(date) : new Date();
    if (isNaN(dateObj.getTime())) {
      console.error(`[Stats API] Invalid date provided: ${date}`);
      throw new ApiError(400, "Invalid date format");
    }

    const dayStart = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    if (!office_id || !mongoose.Types.ObjectId.isValid(office_id)) {
      throw new ApiError(400, "Invalid or missing Office ID");
    }

    const clusteringStats = await Clustering.aggregate([
      {
        $match: {
          office_id: new mongoose.Types.ObjectId(office_id),
          scheduled_at: { $gte: dayStart, $lt: dayEnd },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          total_people: { $sum: "$current_size" },
        },
      },
    ]);

    const batchedStats = await Batched.aggregate([
      {
        $match: {
          office_id: new mongoose.Types.ObjectId(office_id),
          scheduled_at: { $gte: dayStart, $lt: dayEnd },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          total_people: { $sum: "$batch_size" },
        },
      },
    ]);

    const rideStats = await RideRequest.aggregate([
      {
        $match: {
          office_id: new mongoose.Types.ObjectId(office_id),
          scheduled_at: { $gte: dayStart, $lt: dayEnd },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const monthStart = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
    const monthEnd = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0, 23, 59, 59);

    const monthlyFinance = await Batched.aggregate([
      {
        $match: {
          office_id: new mongoose.Types.ObjectId(office_id),
          scheduled_at: { $gte: monthStart, $lt: monthEnd },
          status: { $ne: "CANCELLED" }
        }
      },
      {
        $group: {
          _id: null,
          totalSpend: { $sum: "$estimated_fare" },
          totalRides: { $sum: "$batch_size" },
          totalDistance: { $sum: "$estimated_distance" }
        }
      }
    ]);

    const finance = monthlyFinance[0] || { totalSpend: 0, totalRides: 0, totalDistance: 0 };

    const theoreticalSoloCost = (finance.totalRides * 40) + (finance.totalDistance * 1.2 * 12);
    const savings = theoreticalSoloCost > finance.totalSpend
      ? ((theoreticalSoloCost - finance.totalSpend) / theoreticalSoloCost) * 100
      : 0;

    res.status(200).json(
      new ApiResponse(200, "Polling statistics retrieved", {
        date: date,
        office_id: office_id,
        clustering: clusteringStats,
        batched: batchedStats,
        rides: rideStats,
        finance: {
          monthlySpend: Math.round(finance.totalSpend),
          savingsIndex: Math.round(savings),
          theoreticalSoloCost: Math.round(theoreticalSoloCost)
        }
      })
    );
  } catch (error) {
    next(error);
  }
};

export const completeBatch = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(new ApiResponse(400, "Validation errors", errors.array()));
    }

    const { batch_id } = req.body;
    const driver_id = req.driver._id;

    const batch = await Batched.findById(batch_id);
    if (!batch) {
      throw new ApiError(404, "Batch not found");
    }

    if (batch.driver_id.toString() !== driver_id.toString()) {
      throw new ApiError(403, "You are not authorized to complete this batch");
    }

    const updatedBatch = await Batched.findOneAndUpdate(
      { 
        _id: batch_id, 
        driver_id: driver_id,
        status: { $ne: "COMPLETED" } 
      },
      {
        $set: { status: "COMPLETED" }
      },
      { new: true }
    ).populate({
      path: "ride_ids",
      select: "_id employee_id invited_employee_ids allocated_fare solo_estimated_fare solo_distance"
    });

    if (!updatedBatch) {
       const isDone = await Batched.findOne({ _id: batch_id, status: "COMPLETED" });
       if (isDone) {
          return res.status(200).json(new ApiResponse(200, "Batch already marked as completed", isDone));
       }
       throw new ApiError(400, "Failed to complete batch: already completed or unauthorized");
    }

    if (updatedBatch && updatedBatch.ride_ids.length > 0) {
      const rideIds = updatedBatch.ride_ids.map(r => r._id);
      
      await RideRequest.updateMany(
        { _id: { $in: rideIds } },
        { $set: { status: "COMPLETED" } }
      );

      for (const ride of updatedBatch.ride_ids) {
        const guests = Array.isArray(ride.invited_employee_ids) ? ride.invited_employee_ids : [];
        const participantIds = [ride.employee_id, ...guests];
        const occupantCount = participantIds.length;

        let allocatedFare = ride.allocated_fare || 0;
        let soloFarePotential = ride.solo_estimated_fare || (allocatedFare * 1.5) || 120;

        if (allocatedFare === 0) {
            const baseFare = 40;
            const dist = ride.solo_distance || 5.0;
            allocatedFare = Math.round(baseFare + (dist * 12));
            if (soloFarePotential === 120) soloFarePotential = Math.round(allocatedFare * 1.8);
        }

        const sharePerPerson = Math.max(1, Math.round(allocatedFare / occupantCount));
        const soloSharePerPerson = Math.max(1, Math.round(soloFarePotential / occupantCount));

        const uniqueParticipants = [...new Set(participantIds.map(id => id.toString()))];
        
        for (const userId of uniqueParticipants) {
          try {
            await User.findByIdAndUpdate(userId, {
              $inc: {
                total_carpool_spent: sharePerPerson,
                total_solo_spent_potential: soloSharePerPerson
              }
            });
          } catch (updateErr) {
            console.error(`[Stats-Error] Failed to update user ${userId}:`, updateErr);
          }
        }

        console.log(`[Batch-Complete] Updated stats for ${uniqueParticipants.length} people (Carpool Share: ${sharePerPerson})`);
      }
    }

    console.log(`[Batch Completion] Driver ${driver_id} completed batch ${batch_id}`);

    res.status(200).json(
      new ApiResponse(200, "Batch completed successfully", {
        batch_id: updatedBatch._id,
        status: updatedBatch.status,
        ride_count: updatedBatch.ride_ids.length,
      })
    );
  } catch (error) {
    next(error);
  }
};
