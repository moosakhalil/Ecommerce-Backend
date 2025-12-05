const mongoose = require("mongoose");

const vendorPreOrderSchema = new mongoose.Schema(
  {
    vendorId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
      required: true,
    },
    email: {
      type: String,
    },
    location: {
      city: String,
      area: String,
      fullAddress: String,
    },
    assignedAreas: [
      {
        areaId: String, // Add this
        emirate: String, // Keep for backward compatibility
        city: String, // Keep for backward compatibility
        area: String, // Keep for backward compatibility
        deliveryRadius: Number, // Keep existing
        deliveryCharge: {
          // Add this
          type: Number,
          default: 0,
        },
        estimatedDeliveryTime: {
          // Add this
          type: String,
          default: "Same day",
        },
        isActive: {
          type: Boolean,
          default: true,
        },
      },
    ],
    availableProducts: [
      {
        productId: String,
        productName: String,
        isActive: Boolean,
        pricing: {
          supplierPrice: Number,
          commission: Number,
          salePrice: Number,
        },
        availability: {
          inStock: Boolean,
          estimatedDeliveryDays: Number,
          minimumOrderQuantity: Number,
        },
        specifications: {
          quality: String,
          origin: String,
          customNotes: String,
        },
      },
    ],
    status: {
      type: String,
      enum: ["Available", "Offline", "Busy"],
      default: "Available",
    },
    preorderSettings: {
      enabled: Boolean,
      preorderTime: Number,
      preorderDiscount: Number,
      minPreOrderTime: Number, // Changed to days instead of hours
    },
    bankDetails: {
      accountHolder: String,
      accountNumber: String,
      bankName: String,
    },
    workingHours: {
      monday: { start: String, end: String, isOpen: Boolean },
      tuesday: { start: String, end: String, isOpen: Boolean },
      wednesday: { start: String, end: String, isOpen: Boolean },
      thursday: { start: String, end: String, isOpen: Boolean },
      friday: { start: String, end: String, isOpen: Boolean },
      saturday: { start: String, end: String, isOpen: Boolean },
      sunday: { start: String, end: String, isOpen: Boolean },
    },
    responseMetrics: {
      averageResponseTime: Number,
      rating: Number,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("VendorPreOrder", vendorPreOrderSchema);
