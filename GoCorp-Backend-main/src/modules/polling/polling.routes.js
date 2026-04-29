import express from "express";
import { body, param, query } from "express-validator";
import { authUser, authDriver } from "../../middleware/auth.middleware.js";
import {
  submitRideForPolling,
  getRideClusteringStatus,
  getClustersByOfficeAndTime,
  getBatchesByOfficeAndTime,
  getClusterDetails,
  getBatchDetails,
  getPollingStats,
  acceptBatch,
  completeBatch,
} from "./polling.controller.js";

const router = express.Router();

router.post(
  "/submit-ride",
  [body("ride_id").notEmpty().withMessage("ride_id is required")],
  submitRideForPolling
);

router.get(
  "/ride-status/:ride_id",
  [param("ride_id").matches(/^[0-9a-fA-F]{24}$/).withMessage("Invalid ride ID format")],
  getRideClusteringStatus
);

router.get(
  "/clusters",
  [
    query("office_id")
      .notEmpty()
      .withMessage("office_id is required")
      .matches(/^[0-9a-fA-F]{24}$/)
      .withMessage("Invalid office ID format"),
    query("scheduled_at").notEmpty().withMessage("scheduled_at is required").isISO8601(),
  ],
  getClustersByOfficeAndTime
);

router.get(
  "/batches",
  [
    query("office_id")
      .notEmpty()
      .withMessage("office_id is required")
      .matches(/^[0-9a-fA-F]{24}$/)
      .withMessage("Invalid office ID format"),
    query("scheduled_at").notEmpty().withMessage("scheduled_at is required").isISO8601(),
    query("status").optional().isIn([
      "CREATED",
      "READY_FOR_ASSIGNMENT",
      "ASSIGNED_TO_DRIVER",
      "DRIVER_ACCEPTED",
      "IN_TRANSIT",
      "COMPLETED",
      "CANCELLED",
    ]),
  ],
  getBatchesByOfficeAndTime
);

router.get(
  "/cluster/:cluster_id",
  [param("cluster_id").matches(/^[0-9a-fA-F]{24}$/).withMessage("Invalid cluster ID format")],
  getClusterDetails
);

router.get(
  "/batch/:batch_id",
  [param("batch_id").matches(/^[0-9a-fA-F]{24}$/).withMessage("Invalid batch ID format")],
  getBatchDetails
);

router.post(
  "/batch/accept",
  authDriver,
  [body("batch_id").matches(/^[0-9a-fA-F]{24}$/).withMessage("Invalid batch ID format")],
  acceptBatch
);

router.get(
  "/stats",
  [
    query("office_id")
      .notEmpty()
      .withMessage("office_id is required")
      .matches(/^[0-9a-fA-F]{24}$/)
      .withMessage("Invalid office ID format"),
    query("date").notEmpty().withMessage("date is required").isISO8601(),
  ],
  getPollingStats
);

router.post(
  "/batch/complete",
  authDriver,
  [body("batch_id").matches(/^[0-9a-fA-F]{24}$/).withMessage("Invalid batch ID format")],
  completeBatch
);

export default router;
