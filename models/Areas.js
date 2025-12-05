const mongoose = require("mongoose");

const areaSchema = new mongoose.Schema({
  state: {
    type: String,
    required: true,
    trim: true,
  },
  area: {
    type: String,
    required: true,
    trim: true,
  },
  displayName: {
    type: String,
    required: true,
    trim: true,
  },
  truckPrice: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  scooterPrice: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
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

areaSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

areaSchema.index({ state: 1, area: 1 });
areaSchema.index({ isActive: 1 });

const Area = mongoose.model("Area", areaSchema);

module.exports = Area;
