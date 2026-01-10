const mongoose = require("mongoose");

// Trigger Configuration Schema
const triggerConfigurationSchema = new mongoose.Schema(
  {
    triggerName: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    triggerType: {
      type: String,
      required: true,
      enum: [
        "referral_threshold",
        "purchase_conversion",
        "inactive_customer",
        "dormant_customer",
        "abandoned_cart",
        "first_order_completion",
        "repeat_customer_milestone",
        "high_value_customer",
        "referral_success",
        "video_upload_reminder",
        "seasonal_promotion",
        "payment_pending",
        "delivery_scheduled",
        "post_delivery_feedback",
      ],
    },
    description: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isNew: {
      type: Boolean,
      default: false,
      description: "Marks triggers added as recommendations (displayed in red)",
    },
    configuration: {
      // For referral_threshold
      thresholdCount: {
        type: Number,
        default: 5,
      },
      // For time-based triggers (inactive, dormant)
      daysPeriod: {
        type: Number,
        default: 30,
      },
      // For milestone triggers
      milestoneValues: [Number],
      // For high-value triggers
      spendThreshold: {
        type: Number,
        default: 500,
      },
      // Message template
      messageTemplate: {
        type: String,
        required: true,
      },
      // Cooldown period (days) - prevent sending same trigger too frequently
      cooldownDays: {
        type: Number,
        default: 30,
      },
      // Execution schedule
      executionSchedule: {
        type: String,
        enum: ["realtime", "hourly", "daily", "weekly", "custom"],
        default: "hourly",
      },
      // Custom cron expression for advanced scheduling
      cronExpression: String,
      // Target audience filters
      targetAudience: {
        customerTypes: [String], // ["all", "referred", "non_referred", "vip"]
        excludeOptedOut: {
          type: Boolean,
          default: true,
        },
      },
    },
    executionStats: {
      totalExecutions: {
        type: Number,
        default: 0,
      },
      successCount: {
        type: Number,
        default: 0,
      },
      failureCount: {
        type: Number,
        default: 0,
      },
      lastExecutedAt: Date,
      averageResponseRate: {
        type: Number,
        default: 0,
      },
      conversionRate: {
        type: Number,
        default: 0,
      },
    },
    createdBy: {
      staffId: String,
      staffName: String,
    },
    updatedBy: {
      staffId: String,
      staffName: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
triggerConfigurationSchema.index({ triggerType: 1, isActive: 1 });
triggerConfigurationSchema.index({ createdAt: -1 });

// Virtual for success rate
triggerConfigurationSchema.virtual("successRate").get(function () {
  if (this.executionStats.totalExecutions === 0) return 0;
  return (
    (this.executionStats.successCount / this.executionStats.totalExecutions) *
    100
  ).toFixed(2);
});

// Ensure virtuals are included in JSON
triggerConfigurationSchema.set("toJSON", { virtuals: true });
triggerConfigurationSchema.set("toObject", { virtuals: true });

const TriggerConfiguration = mongoose.model(
  "TriggerConfiguration",
  triggerConfigurationSchema
);

module.exports = TriggerConfiguration;
