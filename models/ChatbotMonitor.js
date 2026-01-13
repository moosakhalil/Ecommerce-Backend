const mongoose = require("mongoose");

const ChatbotMonitorSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  countryCode: {
    type: String,
    required: true,
    enum: ["+92", "+62", "+46"], // Pakistan, Indonesia, Sweden
  },
  country: {
    type: String,
    required: true,
    enum: ["Pakistan", "Indonesia", "Sweden"],
  },
  label: {
    type: String,
    default: "",
    trim: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  lastMessageAt: {
    type: Date,
    default: null,
  },
  messageCount: {
    type: Number,
    default: 0,
  },
});

// Static method to get all active monitor numbers
ChatbotMonitorSchema.statics.getActiveMonitors = async function () {
  return await this.find({ isActive: true });
};

// Static method to check if monitoring is globally enabled
ChatbotMonitorSchema.statics.isMonitoringEnabled = async function () {
  const activeCount = await this.countDocuments({ isActive: true });
  return activeCount > 0;
};

// Instance method to increment message count
ChatbotMonitorSchema.methods.recordMessage = async function () {
  this.messageCount += 1;
  this.lastMessageAt = new Date();
  return await this.save();
};

// Country code to country name mapping
ChatbotMonitorSchema.statics.COUNTRY_CODES = {
  "+92": "Pakistan",
  "+62": "Indonesia",
  "+46": "Sweden",
};

module.exports = mongoose.model("ChatbotMonitor", ChatbotMonitorSchema);
