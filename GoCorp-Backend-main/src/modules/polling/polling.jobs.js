import cron from "node-cron";
import { Clustering } from "./clustering.model.js";
import { RideRequest } from "../ride/ride.model.js";
import { moveToBatched } from "./polling.service.js";

//Force Batch
export const initForceBatchJob = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const tenMinutesFromNow = new Date(Date.now() + 10 * 60 * 1000);

      const incomingClusters = await Clustering.find({
        status: "IN_CLUSTERING",
        scheduled_at: { $lte: tenMinutesFromNow },
      });

      if (incomingClusters.length > 0) {
        console.log(
          `[Force Batch Job] Found ${incomingClusters.length} cluster(s) approaching scheduled time`
        );

        for (const cluster of incomingClusters) {
          try {
            const batched = await moveToBatched(
              cluster,
              true,
              `Force-batched: Scheduled time ${cluster.scheduled_at.toISOString()} within 10-minute window`
            );

            console.log(
              `[Force Batch Job] Successfully force-batched cluster ${cluster._id} to batch ${batched._id}`
            );

          } catch (error) {
            console.error(
              `[Force Batch Job] Error force-batching cluster ${cluster._id}:`,
              error.message
            );
          }
        }
      }
    } catch (error) {
      console.error("[Force Batch Job] Error:", error);
    }
  });

  console.log("[Force Batch Job] Initialized - runs every minute");
};

export const initCleanupJob = () => {
  // cron.schedule("*/5 * * * *", async () => {
  //   try {
  //     // Find clusters that have been in IN_CLUSTERING for more than 30 minutes
  //     const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
  //
  //     const orphanedClusters = await Clustering.find({
  //       status: "IN_CLUSTERING",
  //       createdAt: { $lte: thirtyMinutesAgo },
  //     });
  //
  //     if (orphanedClusters.length > 0) {
  //       console.log(
  //         `[Cleanup Job] Found ${orphanedClusters.length} orphaned cluster(s) older than 30 minutes`
  //       );
  //
  //       for (const cluster of orphanedClusters) {
  //         try {
  //           const rides = await RideRequest.find({
  //             _id: { $in: cluster.ride_ids },
  //             status: "IN_CLUSTERING",
  //           });
  //
  //           if (rides.length > 0) {
  //             const batched = await moveToBatched(
  //               cluster,
  //               true,
  //               "Force-batched: Cluster orphaned for >30 minutes"
  //             );
  //
  //             console.log(
  //               `[Cleanup Job] Force-batched orphaned cluster ${cluster._id} to batch ${batched._id}`
  //             );
  //           }
  //         } catch (error) {
  //           console.error(
  //             `[Cleanup Job] Error processing orphaned cluster ${cluster._id}:`,
  //             error.message
  //           );
  //         }
  //       }
  //     }
  //   } catch (error) {
  //     console.error("[Cleanup Job] Error:", error);
  //   }
  // });
  console.log("[Cleanup Job] Deactivated - Indefinite waiting enabled");
};
