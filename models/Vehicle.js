const mongoose = require('mongoose');
const { Schema } = mongoose;

const vehicleSchema = new Schema(
  {
    // Link to template
    templateId: {
      type: Schema.Types.ObjectId,
      ref: 'VehicleTemplate',
    },
    
    name: {
      type: String,
      required: true,
      trim: true,
    },
    vehicleType: {
      type: String,
      enum: ['truck', 'scooter', 'other'],
      required: true,
    },
    truckTypeName: {
      type: String,
      trim: true,
    },
    scooterTypeName: {
      type: String,
      trim: true,
    },
    // Common fields for both truck and scooter
    weightMaxKg: {
      type: Number,
      required: true,
    },
    maxPackageLength: {
      type: Number,
      required: true,
    },
    loadLimitPercent: {
      type: Number,
      default: 80,
      min: 0,
      max: 100,
    },
    
    // Truck-specific fields
    dimensions: {
      heightCm: { type: Number },
      widthCm: { type: Number },
      lengthCm: { type: Number },
    },
    
    // Scooter-specific fields
    maxPackages: {
      type: Number,
    },
    
    // Vehicle details
    fuelType: {
      type: String,
      enum: ['Diesel', 'Petrol', 'Electric', 'Hybrid', 'CNG'],
    },
    transmission: {
      type: String,
      enum: ['Manual', 'Automatic'],
    },
    yearModel: {
      type: Number,
    },
    engineSizeCc: {
      type: Number,
    },
    odometerKm: {
      type: Number,
      default: 0,
    },
    serviceDueDate: {
      type: Date,
    },
    insuranceExpiryDate: {
      type: Date,
    },
    numberPlate: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    chassisNumber: {
      type: String,
      trim: true,
    },
    
    // Images
    images: {
      stnkPhoto: { type: String },
      bpkbPhoto: { type: String },
      stnkIconPhoto: { type: String },
      codecPhoto: { type: String },
    },
    
    // Status and availability
    status: {
      type: String,
      enum: ['active', 'maintenance', 'inactive', 'incomplete'],
      default: 'active',
    },
    
    // Audit fields
    createdBy: {
      type: String,
    },
    updatedBy: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
vehicleSchema.index({ vehicleType: 1, status: 1 });
vehicleSchema.index({ numberPlate: 1 });
vehicleSchema.index({ status: 1 });

// Virtual for display name
vehicleSchema.virtual('displayName').get(function () {
  return `${this.name} (${this.numberPlate})`;
});

// Virtual for total dimensions (volume in cubic cm)
vehicleSchema.virtual('totalDimensionsCubicCm').get(function () {
  if (this.dimensions && this.dimensions.heightCm && this.dimensions.widthCm && this.dimensions.lengthCm) {
    return this.dimensions.heightCm * this.dimensions.widthCm * this.dimensions.lengthCm;
  }
  return null;
});

// Ensure virtuals are included in JSON
vehicleSchema.set('toJSON', { virtuals: true });
vehicleSchema.set('toObject', { virtuals: true });

const Vehicle = mongoose.model('Vehicle', vehicleSchema);

module.exports = Vehicle;
