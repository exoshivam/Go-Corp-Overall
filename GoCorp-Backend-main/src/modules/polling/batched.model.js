import mongoose from "mongoose";

const batchedSchema = new mongoose.Schema(
  {
    office_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Office",
      required: true,
    },

    scheduled_at: {
      type: Date,
      required: true,
    },

    ride_ids: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "RideRequest",
      required: true,
      validate: {
        validator: function (v) {
          return v.length >= 1 && v.length <= 4;
        },
        message: "Batch must contain 1-4 rides",
      },
    },

    batch_size: {
      type: Number,
      required: true,
      min: 1,
      max: 4,
    },

    pickup_polyline: {
      type: {
        type: String,
        enum: ["LineString"],
      },
      coordinates: [[Number]],
    },

    // Pickup centroid
    pickup_centroid: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: [Number],
    },

    drop_location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: [Number],
    },

    status: {
      type: String,
      enum: [
        "CREATED",
        "READY_FOR_ASSIGNMENT",
        "ASSIGNED_TO_DRIVER",
        "DRIVER_ACCEPTED",
        "IN_TRANSIT",
        "COMPLETED",
        "CANCELLED",
      ],
      default: "CREATED",
    },

    driver_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Driver",
    },

    assigned_at: Date,

    driver_accepted: {
      type: Boolean,
      default: false,
    },

    accepted_at: Date,

    estimated_fare: {
      type: Number,
      default: 0,
    },

    estimated_distance: {
      type: Number,
      default: 0,
    },

    batched_at: {
      type: Date,
      default: Date.now,
    },

    metadata: {
      force_batched: { type: Boolean, default: false },
      force_batch_reason: String,
      clustering_id: mongoose.Schema.Types.ObjectId,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
batchedSchema.index({ office_id: 1, scheduled_at: 1, status: 1 });
batchedSchema.index({ scheduled_at: 1, status: 1 });
batchedSchema.index({ driver_id: 1, status: 1 });
batchedSchema.index({ "metadata.clustering_id": 1 }, { 
  unique: true, 
  partialFilterExpression: { "metadata.clustering_id": { $exists: true, $ne: null } } 
});
batchedSchema.index({ status: 1 });

export const Batched = mongoose.model("Batched", batchedSchema);
