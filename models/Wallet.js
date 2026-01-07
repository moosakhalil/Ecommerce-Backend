const mongoose = require('mongoose');

// Transaction Schema for wallet history
const walletTransactionSchema = new mongoose.Schema({
  transactionId: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: ['credit', 'debit'],
    required: true
  },
  category: {
    type: String,
    enum: ['credit', 'refund', 'commission', 'cashback', 'adjustment', 'order_payment', 'insurance_claim', 'foreman_earnings', 'last_point_discount'],
    default: 'credit'
  },
  amount: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  relatedOrderId: {
    type: String,
    default: null
  },
  relatedClaimId: {
    type: String,
    default: null
  },
  performedBy: {
    type: String,
    default: 'System'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Main Wallet Schema
const walletSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    unique: true
  },
  customerName: {
    type: String,
    required: true
  },
  customerPhone: {
    type: String,
    default: ''
  },
  customerEmail: {
    type: String,
    default: ''
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCredits: {
    type: Number,
    default: 0
  },
  totalDebits: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  transactions: [walletTransactionSchema],
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

// Generate transaction ID
walletSchema.statics.generateTransactionId = function(type = 'TXN') {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${type}-${dateStr}-${random}`;
};

// Add credit to wallet
walletSchema.methods.addCredit = async function(amount, description, category = 'credit', relatedOrderId = null, performedBy = 'System') {
  const transactionId = this.constructor.generateTransactionId('CR');
  
  const transaction = {
    transactionId,
    type: 'credit',
    category,
    amount: Math.abs(amount),
    description,
    relatedOrderId,
    performedBy,
    createdAt: new Date()
  };

  this.transactions.push(transaction);
  this.balance += Math.abs(amount);
  this.totalCredits += Math.abs(amount);
  this.updatedAt = new Date();
  
  await this.save();
  return transaction;
};

// Deduct from wallet
walletSchema.methods.deductBalance = async function(amount, description, category = 'order_payment', relatedOrderId = null, performedBy = 'System') {
  if (this.balance < amount) {
    throw new Error('Insufficient wallet balance');
  }

  const transactionId = this.constructor.generateTransactionId('DB');
  
  const transaction = {
    transactionId,
    type: 'debit',
    category,
    amount: Math.abs(amount),
    description,
    relatedOrderId,
    performedBy,
    createdAt: new Date()
  };

  this.transactions.push(transaction);
  this.balance -= Math.abs(amount);
  this.totalDebits += Math.abs(amount);
  this.updatedAt = new Date();
  
  await this.save();
  return transaction;
};

// Get transaction history
walletSchema.methods.getTransactionHistory = function(limit = 50) {
  return this.transactions
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
};

// Pre-save middleware
walletSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for faster queries
walletSchema.index({ customerId: 1 });
walletSchema.index({ customerPhone: 1 });
walletSchema.index({ 'transactions.createdAt': -1 });

module.exports = mongoose.model('Wallet', walletSchema);
