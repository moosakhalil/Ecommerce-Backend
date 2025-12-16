const mongoose = require('mongoose');

// Counter for auto-generating competitor IDs - using separate collection
const competitorCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
}, { collection: 'competitorcounters' });

const CompetitorCounter = mongoose.models.CompetitorCounter || mongoose.model('CompetitorCounter', competitorCounterSchema);

const competitorSchema = new mongoose.Schema({
  competitorId: {
    type: String,
    unique: true,
    required: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  googleMapsLocation: {
    type: String,
    default: ''
  },
  photoLocation: {
    type: String,
    default: ''
  },
  photoShopFar: {
    type: String,
    default: ''
  },
  photoShopClose: {
    type: String,
    default: ''
  },
  photoStreetLeft: {
    type: String,
    default: ''
  },
  photoStreetRight: {
    type: String,
    default: ''
  },
  phoneNumber: {
    type: String,
    default: ''
  },
  shopSize: {
    type: String,
    enum: ['small', 'large'],
    default: 'small'
  },
  // Geographic location dropdowns (will be linked later)
  geo1: {
    type: String,
    default: ''
  },
  geo2: {
    type: String,
    default: ''
  },
  geo3: {
    type: String,
    default: ''
  },
  // Products this competitor sells with their prices
  products: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    price: {
      type: Number,
      required: true
    },
    date: {
      type: Date,
      default: Date.now
    },
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Static method to generate next competitor ID
competitorSchema.statics.generateCompetitorId = async function() {
  try {
    const counter = await CompetitorCounter.findByIdAndUpdate(
      { _id: 'competitorId' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );
    return `COMP-${String(counter.seq).padStart(4, '0')}`;
  } catch (error) {
    // Fallback: generate based on timestamp if counter fails
    const timestamp = Date.now().toString(36).toUpperCase();
    return `COMP-${timestamp}`;
  }
};

// Index for efficient searching
competitorSchema.index({ name: 'text' });
competitorSchema.index({ competitorId: 1 });

module.exports = mongoose.model('Competitor', competitorSchema);
