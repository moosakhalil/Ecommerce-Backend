const mongoose = require("mongoose");

const vendorOrderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
      default: function () {
        return "order-" + Date.now().toString().slice(-6);
      },
    },

    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
    },

    vendorName: String,
    vendorPhone: String,

    customer: {
      name: {
        type: String,
        required: true,
      },
      phone: {
        type: String,
        required: true,
      },
      email: String,
    },

    material: {
      type: {
        type: String,
        enum: ["Sand", "Stone", "Brick"],
        required: true,
      },
      quantity: {
        value: {
          type: Number,
          required: true,
        },
        unit: {
          type: String,
          enum: ["tons", "bags", "cubic_meters", "pieces"],
          required: true,
        },
      },
      specifications: {
        quality: String,
        size: String,
        color: String,
        other: String,
      },
    },

    pricing: {
      unitPrice: {
        type: Number,
        required: true,
      },
      totalAmount: {
        type: Number,
        required: true,
      },
      commission: {
        percentage: Number,
        amount: Number,
      },
      discount: {
        percentage: Number,
        amount: Number,
      },
    },

    delivery: {
      area: {
        type: String,
        required: true,
      },
      fullAddress: String,
      preferredDate: Date,
      preferredTime: String,
      urgency: {
        type: String,
        enum: ["normal", "urgent", "flexible"],
        default: "normal",
      },
    },

    status: {
      type: String,
      enum: [
        "pending",
        "assigned",
        "confirmed",
        "in_progress",
        "ready",
        "delivered",
        "cancelled",
        "returned",
      ],
      default: "pending",
    },

    paymentStatus: {
      type: String,
      enum: ["pending", "advance", "cod", "paid"],
      default: "pending",
    },

    paymentMethod: {
      type: String,
      enum: ["COD", "ADVANCE", "BANK_TRANSFER", "CASH"],
      default: "COD",
    },

    timeline: [
      {
        status: String,
        timestamp: {
          type: Date,
          default: Date.now,
        },
        updatedBy: {
          type: String,
          enum: ["customer", "vendor", "admin", "system"],
        },
        notes: String,
      },
    ],

    vendorResponse: {
      responseTime: Number, // in minutes
      accepted: Boolean,
      rejectionReason: String,
      counterOffer: {
        price: Number,
        deliveryTime: String,
        notes: String,
      },
    },

    qualityCheck: {
      required: {
        type: Boolean,
        default: false,
      },
      completed: {
        type: Boolean,
        default: false,
      },
      rating: Number,
      comments: String,
      images: [String],
    },

    tracking: {
      dispatchTime: Date,
      estimatedArrival: Date,
      actualDelivery: Date,
      driverInfo: {
        name: String,
        phone: String,
        vehicleNumber: String,
      },
    },

    feedback: {
      customerRating: {
        type: Number,
        min: 1,
        max: 5,
      },
      vendorRating: {
        type: Number,
        min: 1,
        max: 5,
      },
      customerComments: String,
      vendorComments: String,
    },

    documents: [
      {
        documentType: {
          type: String,
          enum: [
            "invoice",
            "receipt",
            "quality_certificate",
            "delivery_proof",
            "other",
          ],
        },
        fileName: String,
        filePath: String,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
        uploadedBy: String,
      },
    ],

    isPreorder: {
      type: Boolean,
      default: false,
    },

    preorderDetails: {
      originalOrderDate: Date,
      requestedDeliveryDate: Date,
      preorderDiscount: Number,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
vendorOrderSchema.index({ orderId: 1 });
vendorOrderSchema.index({ vendorId: 1 });
vendorOrderSchema.index({ status: 1 });
vendorOrderSchema.index({ "customer.phone": 1 });
vendorOrderSchema.index({ "material.type": 1 });
vendorOrderSchema.index({ createdAt: -1 });
vendorOrderSchema.index({ "delivery.area": 1 });

// Pre-save middleware
vendorOrderSchema.pre("save", function (next) {
  this.lastUpdated = new Date();

  // Calculate total amount if not set
  if (
    !this.pricing.totalAmount &&
    this.pricing.unitPrice &&
    this.material.quantity.value
  ) {
    this.pricing.totalAmount =
      this.pricing.unitPrice * this.material.quantity.value;
  }

  // Calculate commission amount
  if (this.pricing.commission.percentage) {
    this.pricing.commission.amount =
      (this.pricing.totalAmount * this.pricing.commission.percentage) / 100;
  }

  next();
});

// Methods
vendorOrderSchema.methods.updateStatus = function (
  newStatus,
  updatedBy = "system",
  notes = ""
) {
  this.status = newStatus;
  this.timeline.push({
    status: newStatus,
    timestamp: new Date(),
    updatedBy: updatedBy,
    notes: notes,
  });

  return this.save();
};

vendorOrderSchema.methods.recordVendorResponse = function (responseData) {
  this.vendorResponse = {
    ...this.vendorResponse,
    ...responseData,
    responseTime: Math.ceil((Date.now() - this.createdAt) / (1000 * 60)), // minutes
  };

  if (responseData.accepted) {
    this.status = "confirmed";
  } else {
    this.status = "cancelled";
  }

  this.timeline.push({
    status: this.status,
    timestamp: new Date(),
    updatedBy: "vendor",
    notes: responseData.accepted
      ? "Order accepted by vendor"
      : `Order rejected: ${responseData.rejectionReason}`,
  });

  return this.save();
};

// Static methods
vendorOrderSchema.statics.getOrderStats = function () {
  return this.aggregate([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalValue: { $sum: "$pricing.totalAmount" },
      },
    },
  ]);
};

vendorOrderSchema.statics.getVendorPerformance = function (vendorId) {
  return this.aggregate([
    { $match: { vendorId: mongoose.Types.ObjectId(vendorId) } },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        completedOrders: {
          $sum: { $cond: [{ $eq: ["$status", "delivered"] }, 1, 0] },
        },
        averageResponseTime: { $avg: "$vendorResponse.responseTime" },
        averageRating: { $avg: "$feedback.vendorRating" },
        totalRevenue: { $sum: "$pricing.totalAmount" },
      },
    },
  ]);
};

vendorOrderSchema.statics.getMaterialDemand = function (days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return this.aggregate([
    { $match: { createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: "$material.type",
        totalOrders: { $sum: 1 },
        totalQuantity: { $sum: "$material.quantity.value" },
        totalValue: { $sum: "$pricing.totalAmount" },
      },
    },
    { $sort: { totalOrders: -1 } },
  ]);
};

module.exports = mongoose.model("VendorOrder", vendorOrderSchema);
