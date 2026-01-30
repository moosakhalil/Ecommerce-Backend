const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/**
 * DiscountWindowConfig Schema
 * Stores configurable parameters for each of the 8 discount windows
 * Used by Page 74 (Discount Policies) for admin configuration
 */
const discountWindowConfigSchema = new Schema({
  // Window identifier matching the 8 discount categories
  windowId: {
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
    required: true,
    unique: true
  },
  
  // Active/Inactive toggle for each window
  isActive: { 
    type: Boolean, 
    default: true 
  },
  
  // Display name for the window
  displayName: {
    type: String,
    default: function() {
      const names = {
        'foremen': 'Foremen',
        'foremen_commission': 'Foremen + Commission',
        'referral_3_days': 'Referred Customers',
        'new_customer_referred': 'New Customer Referred',
        'new_customer': 'New Customer',
        'shopping_30m': 'Shopping 30M Bill',
        'shopping_100m_60d': 'Shopping 100M Last 60d',
        'everyone': 'Everyone'
      };
      return names[this.windowId] || this.windowId;
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // Window 3: Referral Settings (referral_3_days)
  // ═══════════════════════════════════════════════════════════════
  // Days of access granted per referral (1-10)
  // Example: If set to 2, then 5 referrals = 10 days access
  daysPerReferral: { 
    type: Number, 
    default: 1, 
    min: 1, 
    max: 10 
  },

  // ═══════════════════════════════════════════════════════════════
  // Window 4: New Customer Referred Settings (new_customer_referred)
  // ═══════════════════════════════════════════════════════════════
  
  // Sub-section 4a: Unsuccessful Referrals
  // When referred but didn't become customer
  unsuccessfulReferralOfferDays: { 
    type: Number, 
    default: 7, 
    min: 1, 
    max: 100 
  },
  unsuccessfulReferralCooldown: { 
    type: Number, 
    default: 30, 
    min: 1, 
    max: 100 
  },
  
  // Sub-section 4b: Thank You for Becoming Customer
  // When referred and bought a product
  thankYouCustomerOfferDays: { 
    type: Number, 
    default: 7, 
    min: 1, 
    max: 100 
  },
  
  // Sub-section 4c: Inactive Buying Customers
  // When referred, bought, but inactive for a period
  inactiveBuyerOfferDays: { 
    type: Number, 
    default: 7, 
    min: 1, 
    max: 100 
  },
  inactiveBuyerThresholdDays: { 
    type: Number, 
    default: 45, 
    min: 1, 
    max: 100 
  },
  // Inactive means last time they seen the msg
  inactiveLastSeenDays: { 
    type: Number, 
    default: 45, 
    min: 45, 
    max: 100 
  },
  // Last time they replied/active
  inactiveLastRepliedDays: { 
    type: Number, 
    default: 45, 
    min: 45, 
    max: 100 
  },
  // Last time they bought product
  inactiveLastPurchaseDays: { 
    type: Number, 
    default: 45, 
    min: 45, 
    max: 200 
  },

  // ═══════════════════════════════════════════════════════════════
  // Window 5: New Customer Settings (new_customer)
  // ═══════════════════════════════════════════════════════════════
  
  // New customer: account not older than X days
  newCustomerMaxAgeDays: { 
    type: Number, 
    default: 10, 
    min: 1, 
    max: 100 
  },
  
  // New Returning Customer: existing number not bought for X days
  returningCustomerInactiveDays: { 
    type: Number, 
    default: 200, 
    min: 200, 
    max: 400 
  },

  // ═══════════════════════════════════════════════════════════════
  // Window 6: Shopping 30M Settings (shopping_30m)
  // ═══════════════════════════════════════════════════════════════
  
  // Bill size in Rupiah (fixed at 30M, not changeable)
  shopping30mBillSize: { 
    type: Number, 
    default: 30000000 
  },
  
  // How many days they see offers
  shopping30mOfferDays: { 
    type: Number, 
    default: 10, 
    min: 1, 
    max: 100 
  },

  // ═══════════════════════════════════════════════════════════════
  // Window 7: Shopping 100M Settings (shopping_100m_60d)
  // ═══════════════════════════════════════════════════════════════
  
  // Bill size in Rupiah (fixed at 100M, not changeable)
  shopping100mBillSize: { 
    type: Number, 
    default: 100000000 
  },
  
  // Time period (fixed at 60 days, not changeable)
  shopping100mPeriodDays: { 
    type: Number, 
    default: 60 
  },

  // ═══════════════════════════════════════════════════════════════
  // Metadata
  // ═══════════════════════════════════════════════════════════════
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedBy: String
});

// Pre-save middleware to update timestamps
discountWindowConfigSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Static method to get default config for a window
discountWindowConfigSchema.statics.getDefaultConfig = function(windowId) {
  const defaults = {
    foremen: { isActive: true },
    foremen_commission: { isActive: true },
    referral_3_days: { isActive: true, daysPerReferral: 1 },
    new_customer_referred: { 
      isActive: true,
      unsuccessfulReferralOfferDays: 7,
      unsuccessfulReferralCooldown: 30,
      thankYouCustomerOfferDays: 7,
      inactiveBuyerOfferDays: 7,
      inactiveBuyerThresholdDays: 45,
      inactiveLastSeenDays: 45,
      inactiveLastRepliedDays: 45,
      inactiveLastPurchaseDays: 45
    },
    new_customer: { 
      isActive: true,
      newCustomerMaxAgeDays: 10,
      returningCustomerInactiveDays: 200
    },
    shopping_30m: { 
      isActive: true,
      shopping30mBillSize: 30000000,
      shopping30mOfferDays: 10
    },
    shopping_100m_60d: { 
      isActive: true,
      shopping100mBillSize: 100000000,
      shopping100mPeriodDays: 60
    },
    everyone: { isActive: true }
  };
  
  return defaults[windowId] || { isActive: true };
};

// Static method to initialize all default configs
discountWindowConfigSchema.statics.initializeDefaults = async function() {
  const windowIds = [
    'foremen',
    'foremen_commission', 
    'referral_3_days',
    'new_customer_referred',
    'new_customer',
    'shopping_30m',
    'shopping_100m_60d',
    'everyone'
  ];
  
  const results = [];
  
  for (const windowId of windowIds) {
    // Check if config already exists
    const existing = await this.findOne({ windowId });
    if (!existing) {
      const defaultConfig = this.getDefaultConfig(windowId);
      const config = new this({
        windowId,
        ...defaultConfig
      });
      await config.save();
      results.push({ windowId, status: 'created' });
    } else {
      results.push({ windowId, status: 'exists' });
    }
  }
  
  return results;
};

// Instance method to get window-specific settings
discountWindowConfigSchema.methods.getSettings = function() {
  switch(this.windowId) {
    case 'referral_3_days':
      return {
        daysPerReferral: this.daysPerReferral
      };
    case 'new_customer_referred':
      return {
        unsuccessfulReferralOfferDays: this.unsuccessfulReferralOfferDays,
        unsuccessfulReferralCooldown: this.unsuccessfulReferralCooldown,
        thankYouCustomerOfferDays: this.thankYouCustomerOfferDays,
        inactiveBuyerOfferDays: this.inactiveBuyerOfferDays,
        inactiveBuyerThresholdDays: this.inactiveBuyerThresholdDays,
        inactiveLastSeenDays: this.inactiveLastSeenDays,
        inactiveLastRepliedDays: this.inactiveLastRepliedDays,
        inactiveLastPurchaseDays: this.inactiveLastPurchaseDays
      };
    case 'new_customer':
      return {
        newCustomerMaxAgeDays: this.newCustomerMaxAgeDays,
        returningCustomerInactiveDays: this.returningCustomerInactiveDays
      };
    case 'shopping_30m':
      return {
        billSize: this.shopping30mBillSize,
        offerDays: this.shopping30mOfferDays
      };
    case 'shopping_100m_60d':
      return {
        billSize: this.shopping100mBillSize,
        periodDays: this.shopping100mPeriodDays
      };
    default:
      return {};
  }
};

const DiscountWindowConfig = mongoose.model("DiscountWindowConfig", discountWindowConfigSchema);

module.exports = DiscountWindowConfig;
