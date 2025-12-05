const mongoose = require("mongoose");

const deliveryPeriodSchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    enum: ["day", "night"],
    default: "day",
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  timeFrame: {
    // For hour-based deliveries (emergency, express)
    hours: {
      type: Number,
      min: 0,
      default: null,
    },
    // For day-based deliveries (normal)
    fromDays: {
      type: Number,
      min: 0,
      default: null,
    },
    toDays: {
      type: Number,
      min: 0,
      default: null,
    },
    // Time period during the day
    startTime: {
      type: String,
      default: "09:00",
      validate: {
        validator: function (v) {
          return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: "Time must be in HH:MM format",
      },
    },
    endTime: {
      type: String,
      default: "21:00",
      validate: {
        validator: function (v) {
          return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: "Time must be in HH:MM format",
      },
    },
  },
  // Separate pricing for truck and scooter
  truckPricing: {
    price: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    isFree: {
      type: Boolean,
      default: false,
    },
  },
  scooterPricing: {
    price: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    isFree: {
      type: Boolean,
      default: false,
    },
  },
  // Future features (not developed yet)
  invoicePercentage: {
    type: Number,
    min: 0,
    max: 100,
    default: 5,
  },
  deliveryDiscount: {
    type: Number,
    min: 0,
    max: 100,
    default: 30,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Update the updatedAt field before saving
deliveryPeriodSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Compound index for unique period per category
deliveryPeriodSchema.index({ name: 1, category: 1 }, { unique: true });
deliveryPeriodSchema.index({ category: 1 });
deliveryPeriodSchema.index({ isActive: 1 });

const DeliveryPeriod = mongoose.model("DeliveryPeriod", deliveryPeriodSchema);

module.exports = DeliveryPeriod;
