const mongoose = require('mongoose');
const { Schema } = mongoose;

const vehicleTemplateSchema = new Schema(
  {
    // Vehicle type
    vehicleType: {
      type: String,
      enum: ['truck', 'scooter', 'other'],
      required: true,
    },
    
    // Type-specific naming (serves as template identifier)
    truckTypeName: {
      type: String,
      trim: true,
    },
    scooterTypeName: {
      type: String,
      trim: true,
    },
    
    // Common specifications
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
    
    // Truck-specific specifications
    dimensions: {
      heightCm: { type: Number },
      widthCm: { type: Number },
      lengthCm: { type: Number },
    },
    
    // Scooter-specific specifications
    maxPackages: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
vehicleTemplateSchema.index({ vehicleType: 1 });
vehicleTemplateSchema.index({ truckTypeName: 1 });
vehicleTemplateSchema.index({ scooterTypeName: 1 });

// Virtual for template name
vehicleTemplateSchema.virtual('templateName').get(function() {
  return this.vehicleType === 'truck' ? this.truckTypeName : this.scooterTypeName;
});

// Ensure virtuals are included in JSON
vehicleTemplateSchema.set('toJSON', { virtuals: true });
vehicleTemplateSchema.set('toObject', { virtuals: true });

const VehicleTemplate = mongoose.model('VehicleTemplate', vehicleTemplateSchema);

module.exports = VehicleTemplate;
