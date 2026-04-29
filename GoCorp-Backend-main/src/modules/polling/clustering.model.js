import mongoose from "mongoose";

const clusteringSchema = new mongoose.Schema(
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
      default: [],
      validate: {
        validator: function (v) {
          // Max 4 rides/people in a cluster
          return v.length <= 4;
        },
        message: "Maximum 4 people can be in a cluster",
      },
    },

    current_size: {
      type: Number,
      default: 0,
    },

    pickup_polyline: {
      type: {
        type: String,
        enum: ["LineString"],
      },
      coordinates: [[Number]],
    },

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
      enum: ["IN_CLUSTERING", "READY_FOR_BATCH", "BATCHING_IN_PROGRESS", "BATCHED"],
      default: "IN_CLUSTERING",
    },

    ready_for_batch_at: Date,

    batch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "RideBatch",
    },

    metadata: {
      force_batched: { type: Boolean, default: false },
      force_batch_reason: String,
      merge_events: [
        {
          merged_cluster_id: mongoose.Schema.Types.ObjectId,
          merged_at: Date,
          new_size: Number,
        },
      ],
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
clusteringSchema.index({ office_id: 1, scheduled_at: 1, status: 1 });
clusteringSchema.index({ scheduled_at: 1, status: 1 });
clusteringSchema.index({ pickup_location: "2dsphere" });
clusteringSchema.index({ status: 1, ready_for_batch_at: 1 });

export const Clustering = mongoose.model("Clustering", clusteringSchema);
