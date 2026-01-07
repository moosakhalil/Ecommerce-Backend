const mongoose = require('mongoose');

const taxBracketSchema = new mongoose.Schema({
  bracketCode: { 
    type: String, 
    required: true, 
    unique: true,
    uppercase: true,
    trim: true
  },
  bracketName: { 
    type: String, 
    required: true,
    trim: true
  },
  taxPercentage: { 
    type: Number, 
    required: true, 
    min: 0, 
    max: 100,
    default: 0
  },
  description: {
    type: String,
    default: ''
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  isSystemDefault: {
    type: Boolean,
    default: false
  },
  applicableCategories: [{
    type: String
  }],
  createdBy: { 
    type: String, 
    default: "Admin" 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  }
}, { 
  timestamps: true 
});

// Pre-save middleware to update timestamps
taxBracketSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Static method to seed default tax bracket
taxBracketSchema.statics.seedDefaultBracket = async function() {
  try {
    const defaultBracket = await this.findOne({ bracketCode: 'UNKNOWN_TAX' });
    if (!defaultBracket) {
      await this.create({
        bracketCode: 'UNKNOWN_TAX',
        bracketName: 'Unknown Tax Bracket',
        taxPercentage: 0,
        description: 'Default tax bracket for products with undetermined tax status',
        isActive: true,
        isSystemDefault: true,
        applicableCategories: [],
        createdBy: 'System'
      });
      console.log('✅ Default tax bracket (UNKNOWN_TAX) created');
    }
  } catch (error) {
    console.error('Error seeding default tax bracket:', error);
  }
};

module.exports = mongoose.model('TaxBracket', taxBracketSchema);
