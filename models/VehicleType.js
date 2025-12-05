const mongoose = require("mongoose");

const vehicleTypeSchema = new mongoose.Schema({
  vehicleType: {
    type: String,
    required: true,
    unique: true,
    enum: ["Truck", "Pickup", "Scooter Truck (Tuk Tuk)", "Scooter"]
  },
  specifications: {
    maxWeight: { type: Number, required: true },
    dimensions: {
      maxHeight: { type: Number, required: true },
      maxLength: { type: Number, required: true },
      maxWidth: { type: Number, required: true }
    },
    capacityLimitPercent: { type: Number, default: 80 }
  },
  maxPackages: { type: Number, default: null },
  isActive: { type: Boolean, default: true },
  priority: { type: Number, required: true },
}, { timestamps: true });

// Index for faster queries
vehicleTypeSchema.index({ vehicleType: 1 });
vehicleTypeSchema.index({ priority: 1 });
vehicleTypeSchema.index({ isActive: 1 });

const VehicleType = mongoose.model("VehicleType", vehicleTypeSchema);

module.exports = VehicleType;
