const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/**
 * BatchDiscount Schema
 * Manages batch discount allocations for products across 8 discount categories
 */
const batchDiscountSchema = new Schema({
  // Batch identifier - auto-generated format: BATCH-YYYY-XXXX
  batchNumber: { 
    type: String, 
    required: true, 
    unique: true 
  },
  
  // Discount category (one of the 8 types)
  discountCategory: {
    type: String,
    enum: [
      'foremen',
      'foremen_commission', 
      'referral_3_days',
      'new_customer_referred',
      'new_customer',
      'shopping_30m',
      'shopping_100m_60d',
      'everyone'
    ],
    required: true
  },
  
  // Display name shown to customers in chatbot
  displayName: {
    type: String,
    default: function() {
      const displayNames = {
        'foremen': 'foremen',
        'foremen_commission': 'foremen+',
        'referral_3_days': 'You referred 3',
        'new_customer_referred': 'new_customer_ref',
        'new_customer': 'Hey new customer',
        'shopping_30m': 'VIP',
        'shopping_100m_60d': 'Valued customer',
        'everyone': 'Discount'
      };
      return displayNames[this.discountCategory] || this.discountCategory;
    }
  },
  
  // Products in this batch
  products: [{
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    productCode: String,
    productName: String,
    addedAt: { type: Date, default: Date.now }
  }],
  
  // Discount details
  discountPrice: { type: Number, required: true },        // Manual input: actual discount price
  discountPercentage: { type: Number, required: true },   // Auto-calculated percentage
  originalPrice: { type: Number, required: true },        // Original price at batch creation
  
  // Status and metadata
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  createdBy: String,
  
  // Category-specific settings
  categorySettings: {
    // For referral_3_days
    baseDays: { type: Number, default: 3 },
    extraDaysPerReferral: { type: Number, default: 1 },
    
    // For new_customer_referred
    minShoppingAmount: { type: Number, default: 100000 }, // 100k IDR
    
    // For new_customer
    newCustomerDays: { type: Number, default: 10 },
    
    // For shopping_30m
    minSinglePurchase: { type: Number, default: 30000000 }, // 30M IDR
    vipDuration: { type: Number, default: 10 },
    
    // For shopping_100m_60d
    minCumulativeSpending: { type: Number, default: 100000000 }, // 100M IDR
    spendingPeriodDays: { type: Number, default: 60 },
    valuedDuration: { type: Number, default: 10 }
  }
});

// Pre-save middleware to update timestamps
batchDiscountSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to generate next batch number
batchDiscountSchema.statics.generateBatchNumber = async function() {
  const year = new Date().getFullYear();
  const prefix = `BATCH-${year}-`;
  
  // Find the highest batch number for this year
  const lastBatch = await this.findOne({
    batchNumber: new RegExp(`^${prefix}`)
  }).sort({ batchNumber: -1 });
  
  let nextNum = 1;
  if (lastBatch) {
    const lastNum = parseInt(lastBatch.batchNumber.replace(prefix, ''));
    nextNum = lastNum + 1;
  }
  
  return `${prefix}${String(nextNum).padStart(4, '0')}`;
};

// Static method to get category display info
batchDiscountSchema.statics.getCategoryInfo = function(category) {
  const categories = {
    'foremen': {
      displayName: 'foremen',
      description: 'Available to all foremen',
      availability: '24/7',
      criteria: 'Must be a registered foreman'
    },
    'foremen_commission': {
      displayName: 'foremen+',
      description: 'Available to foremen with commission rights',
      availability: '24/7',
      criteria: 'Must be a foreman with commission rights'
    },
    'referral_3_days': {
      displayName: 'You referred 3',
      description: 'For customers who referred 3+ people',
      availability: '3 days + 1 day per extra referral',
      criteria: '3 valid AU referrals, no RU/IN numbers'
    },
    'new_customer_referred': {
      displayName: 'new_customer_ref',
      description: 'For new customers who were referred',
      availability: '3 days',
      criteria: 'Referred + 100k minimum shopping'
    },
    'new_customer': {
      displayName: 'Hey new customer',
      description: 'Welcome discount for new customers',
      availability: '10 days',
      criteria: 'Account less than 10 days old'
    },
    'shopping_30m': {
      displayName: 'VIP',
      description: 'For VIP customers with 30M+ single purchase',
      availability: '10 days or until next 30M purchase',
      criteria: 'Single purchase of 30M minimum'
    },
    'shopping_100m_60d': {
      displayName: 'Valued customer',
      description: 'For valued customers with 100M+ in 60 days',
      availability: '10 days or until next 100M threshold',
      criteria: '100M cumulative spending in 60 days'
    },
    'everyone': {
      displayName: 'Discount',
      description: 'Available to all customers',
      availability: '24/7',
      criteria: 'None - accessible by everyone'
    }
  };
  
  return categories[category] || null;
};

const BatchDiscount = mongoose.model("BatchDiscount", batchDiscountSchema);

module.exports = BatchDiscount;
