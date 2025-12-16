const mongoose = require('mongoose');

// Island Schema (Top Level)
const islandSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    trim: true
  }
}, {
  timestamps: true
});

// Larger State Schema (belongs to Island)
const largerStateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  islandId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Island',
    required: true
  }
}, {
  timestamps: true
});

// Regency Schema (belongs to Larger State)
const regencySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  largerStateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LargerState',
    required: true
  }
}, {
  timestamps: true
});

// Area Schema (belongs to Regency)
const areaSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  displayName: {
    type: String,
    trim: true,
    default: ''
  },
  regencyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Regency',
    required: true
  }
}, {
  timestamps: true
});

// Add indexes for efficient queries
largerStateSchema.index({ islandId: 1 });
regencySchema.index({ largerStateId: 1 });
areaSchema.index({ regencyId: 1 });

// Compound unique indexes to prevent duplicates within parent
largerStateSchema.index({ name: 1, islandId: 1 }, { unique: true });
regencySchema.index({ name: 1, largerStateId: 1 }, { unique: true });
areaSchema.index({ name: 1, regencyId: 1 }, { unique: true });

// Use AreaB to avoid conflict with existing Area model
const Island = mongoose.model('Island', islandSchema);
const LargerState = mongoose.model('LargerState', largerStateSchema);
const Regency = mongoose.model('Regency', regencySchema);
const AreaB = mongoose.model('AreaB', areaSchema);

module.exports = { Island, LargerState, Regency, AreaB };
