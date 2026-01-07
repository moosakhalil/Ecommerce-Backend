const mongoose = require("mongoose");

// Reason Code Schema - for dropdown options
const reasonCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    enum: ['discount', 'fee', 'adjustment', 'refund', 'promotion', 'other'],
    default: 'other'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

// Fee Entry Schema - individual fee entries
const feeEntrySchema = new mongoose.Schema({
  feeType: {
    type: String,
    required: true,
    enum: [
      'item_discount',
      'multiple_item_discount',
      'shipping_cost',
      'handling_fee',
      'service_fee',
      'insurance_fee',
      'gift_wrap_fee',
      'express_fee',
      'cod_fee_B2C',
      'coupon_discount',
      'loyalty_points_discount',
      'store_credit_used',
      'gift_card_used',
      'membership_discount',
      'referral_discount',
      'display_discount',
      'post_purchase_referral_discount'
    ]
  },
  amount: {
    type: Number,
    required: true,
    default: 0
  },
  reasonCode: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ReasonCode'
  },
  reasonText: {
    type: String,
    trim: true
  },
  note: {
    type: String,
    trim: true
  },
  appliedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  appliedAt: {
    type: Date,
    default: Date.now
  }
});

// Fee Control Schema - main document linking to order/bill
const feeControlSchema = new mongoose.Schema({
  // Reference to order or pre-order bill
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  billNumber: {
    type: String,
    trim: true
  },
  
  // Price information
  priceAfterTax: {
    type: Number,
    default: 0
  },
  taxAmount: {
    type: Number,
    default: 0
  },
  taxDeadline: {
    type: Date
  },
  
  // All fee entries
  fees: [feeEntrySchema],
  
  // Wallet related (static for now)
  walletBalanceUsed: {
    amount: { type: Number, default: 0 },
    requiresApproval: { type: Boolean, default: true },
    approved: { type: Boolean, default: false },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date }
  },
  
  // Foreman Commission
  foremanCommission: {
    rate: { type: Number, default: 1 }, // 1%
    amount: { type: Number, default: 0 },
    foremanId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    foremanName: { type: String }
  },
  
  // Delivery fee
  deliveryFee: {
    type: Number,
    default: 0
  },
  
  // Calculated totals
  totalDiscounts: {
    type: Number,
    default: 0
  },
  totalFees: {
    type: Number,
    default: 0
  },
  netTotalFinalPayment: {
    type: Number,
    default: 0
  },
  
  // Status
  status: {
    type: String,
    enum: ['draft', 'pending', 'confirmed', 'paid', 'cancelled'],
    default: 'draft'
  },
  
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

// Calculate totals before saving
feeControlSchema.pre('save', function(next) {
  let totalDiscounts = 0;
  let totalFees = 0;
  
  const discountTypes = [
    'item_discount', 'multiple_item_discount', 'coupon_discount',
    'loyalty_points_discount', 'store_credit_used', 'gift_card_used',
    'membership_discount', 'referral_discount', 'display_discount',
    'post_purchase_referral_discount'
  ];
  
  const feeTypes = [
    'shipping_cost', 'handling_fee', 'service_fee', 'insurance_fee',
    'gift_wrap_fee', 'express_fee', 'cod_fee_B2C'
  ];
  
  this.fees.forEach(fee => {
    if (discountTypes.includes(fee.feeType)) {
      totalDiscounts += fee.amount;
    } else if (feeTypes.includes(fee.feeType)) {
      totalFees += fee.amount;
    }
  });
  
  this.totalDiscounts = totalDiscounts;
  this.totalFees = totalFees;
  
  // Calculate net total
  this.netTotalFinalPayment = this.priceAfterTax + totalFees - totalDiscounts 
    - this.walletBalanceUsed.amount + this.deliveryFee;
  
  next();
});

const ReasonCode = mongoose.model("ReasonCode", reasonCodeSchema);
const FeeControl = mongoose.model("FeeControl", feeControlSchema);

module.exports = { ReasonCode, FeeControl };
