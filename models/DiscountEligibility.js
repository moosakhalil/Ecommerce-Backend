const mongoose = require("mongoose");
const Schema = mongoose.Schema;

/**
 * DiscountEligibility Schema
 * Tracks customer eligibility for various discount categories
 */
const discountEligibilitySchema = new Schema({
  // Customer identification
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
  phoneNumber: { type: String, required: true, unique: true },
  customerName: String,
  
  // Foreman status
  isForeman: { type: Boolean, default: false },
  foremanSince: Date,
  
  // Commission status (for foremen_commission category)
  hasCommission: { type: Boolean, default: false },
  commissionRate: Number,
  commissionSince: Date,
  
  // Referral tracking (for referral_3_days category)
  referralCount: { type: Number, default: 0 },
  referrals: [{
    referredPhone: String,
    referredName: String,
    referredAt: Date,
    isValid: { type: Boolean, default: false },
    hasPurchased: { type: Boolean, default: false },
    country: String
  }],
  lastReferralDate: Date,
  validReferralsIn3Days: { type: Number, default: 0 },
  
  // Referred customer tracking (for new_customer_referred category)
  isReferred: { type: Boolean, default: false },
  referredBy: String,
  referredByPhone: String,
  referredAt: Date,
  
  // Account age tracking (for new_customer category)
  accountCreatedAt: { type: Date, default: Date.now },
  firstPurchaseDate: Date,
  
  // Spending tracking (for shopping_30m and shopping_100m_60d categories)
  totalSpending: { type: Number, default: 0 },
  totalSpending60Days: { type: Number, default: 0 },
  largestSinglePurchase: { type: Number, default: 0 },
  purchaseHistory: [{
    orderId: String,
    amount: Number,
    purchaseDate: Date
  }],
  
  // Current eligibility status for each category
  eligibleCategories: [{
    category: {
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
      ]
    },
    eligibleSince: Date,
    expiresAt: Date,
    isActive: { type: Boolean, default: true }
  }],
  
  // Discount usage tracking
  discountsUsed: [{
    category: String,
    batchNumber: String,
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    usedAt: Date,
    orderId: String,
    originalPrice: Number,
    discountPrice: Number,
    savedAmount: Number
  }],
  
  // Timestamps
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Pre-save middleware
discountEligibilitySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

/**
 * Method to check and update eligibility for all categories
 */
discountEligibilitySchema.methods.updateEligibility = function() {
  const now = new Date();
  const eligibleCategories = [];
  
  // Everyone category - always eligible
  eligibleCategories.push({
    category: 'everyone',
    eligibleSince: this.accountCreatedAt,
    isActive: true
  });
  
  // Foremen category
  if (this.isForeman) {
    eligibleCategories.push({
      category: 'foremen',
      eligibleSince: this.foremanSince || now,
      isActive: true
    });
  }
  
  // Foremen + Commission category
  if (this.isForeman && this.hasCommission) {
    eligibleCategories.push({
      category: 'foremen_commission',
      eligibleSince: this.commissionSince || now,
      isActive: true
    });
  }
  
  // Referral 3 days category
  if (this.validReferralsIn3Days >= 3) {
    const extraDays = Math.max(0, this.validReferralsIn3Days - 3);
    const baseDays = 3;
    const totalDays = baseDays + extraDays;
    const expiresAt = new Date(this.lastReferralDate);
    expiresAt.setDate(expiresAt.getDate() + totalDays);
    
    if (now <= expiresAt) {
      eligibleCategories.push({
        category: 'referral_3_days',
        eligibleSince: this.lastReferralDate,
        expiresAt: expiresAt,
        isActive: true
      });
    }
  }
  
  // New customer referred category
  if (this.isReferred && this.totalSpending >= 100000) {
    const expiresAt = new Date(this.referredAt);
    expiresAt.setDate(expiresAt.getDate() + 3);
    
    if (now <= expiresAt) {
      eligibleCategories.push({
        category: 'new_customer_referred',
        eligibleSince: this.referredAt,
        expiresAt: expiresAt,
        isActive: true
      });
    }
  }
  
  // New customer category
  const accountAge = Math.floor((now - this.accountCreatedAt) / (1000 * 60 * 60 * 24));
  if (accountAge <= 10 && this.firstPurchaseDate) {
    const expiresAt = new Date(this.accountCreatedAt);
    expiresAt.setDate(expiresAt.getDate() + 10);
    
    eligibleCategories.push({
      category: 'new_customer',
      eligibleSince: this.accountCreatedAt,
      expiresAt: expiresAt,
      isActive: true
    });
  }
  
  // VIP 30M category
  if (this.largestSinglePurchase >= 30000000) {
    const lastBigPurchase = this.purchaseHistory
      .filter(p => p.amount >= 30000000)
      .sort((a, b) => b.purchaseDate - a.purchaseDate)[0];
    
    if (lastBigPurchase) {
      const expiresAt = new Date(lastBigPurchase.purchaseDate);
      expiresAt.setDate(expiresAt.getDate() + 10);
      
      if (now <= expiresAt) {
        eligibleCategories.push({
          category: 'shopping_30m',
          eligibleSince: lastBigPurchase.purchaseDate,
          expiresAt: expiresAt,
          isActive: true
        });
      }
    }
  }
  
  // Valued customer 100M in 60 days category
  if (this.totalSpending60Days >= 100000000) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 10);
    
    eligibleCategories.push({
      category: 'shopping_100m_60d',
      eligibleSince: now,
      expiresAt: expiresAt,
      isActive: true
    });
  }
  
  this.eligibleCategories = eligibleCategories;
  return eligibleCategories;
};

/**
 * Method to calculate 60-day spending
 */
discountEligibilitySchema.methods.calculate60DaySpending = function() {
  const now = new Date();
  const sixtyDaysAgo = new Date(now - 60 * 24 * 60 * 60 * 1000);
  
  this.totalSpending60Days = this.purchaseHistory
    .filter(p => p.purchaseDate >= sixtyDaysAgo)
    .reduce((sum, p) => sum + p.amount, 0);
  
  return this.totalSpending60Days;
};

/**
 * Static method to validate referral phone number
 */
discountEligibilitySchema.statics.isValidReferralCountry = function(phoneNumber) {
  // Block Russian numbers (+7)
  if (phoneNumber.startsWith('+7') || phoneNumber.startsWith('7')) {
    return { valid: false, reason: 'Russian numbers not allowed' };
  }
  
  // Block Indian numbers (+91)
  if (phoneNumber.startsWith('+91') || phoneNumber.startsWith('91')) {
    return { valid: false, reason: 'Indian numbers not allowed' };
  }
  
  // Allow Australian numbers (+61)
  if (phoneNumber.startsWith('+61') || phoneNumber.startsWith('61')) {
    return { valid: true, country: 'Australia' };
  }
  
  // Block all other countries for referral bonus
  return { valid: false, reason: 'Only Australian numbers allowed for referral' };
};

const DiscountEligibility = mongoose.model("DiscountEligibility", discountEligibilitySchema);

module.exports = DiscountEligibility;
