const mongoose = require("mongoose");

const complaintSchema = new mongoose.Schema(
  {
    complaintId: {
      type: String,
      required: true,
      unique: true,
      default: function () {
        return "COMP" + Date.now().toString().slice(-8);
      },
    },

    // Order and Customer Information
    orderId: {
      type: String,
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    customerName: String,
    customerPhone: String,

    // Driver Information
    driverInfo: {
      driverId: {
        type: String,
        required: true,
      },
      driverName: {
        type: String,
        required: true,
      },
      driverPhone: String,
      vehicleId: String,
      vehicleName: String,
    },

    // Problem Details
    problemTypes: [
      {
        type: String,
        enum: [
          "item_broken_damaged",
          "wrong_size",
          "wrong_item_delivered",
          "not_as_described",
          "missing_item_amount",
          "poor_quality",
          "other",
        ],
        required: true,
      },
    ],

    // Photo/Video Evidence
    mediaAttachments: [
      {
        mediaId: String,
        mediaType: {
          type: String,
          enum: ["image", "video"],
          required: true,
        },
        filename: String,
        mimetype: String,
        fileSize: Number,
        base64Data: {
          type: String,
          required: true,
        },
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Customer Preferences
    customerWantsToDo: [
      {
        type: String,
        enum: [
          "customer_wants_cancel_order",
          "customer_wants_replacement",
          "customer_wants_full_refund",
          "customer_wants_partial_refund_keep_product",
        ],
      },
    ],

    // Item Return Status
    itemReturn: {
      type: String,
      enum: [
        "customer_sending_order_item_back_with_truck",
        "immediate_replacement",
        "full_refund_processed_today",
        "partial_refund_keep_defective_items",
        "store_credit_instead_of_refund",
        "expedited_shipping_for_replacement",
        "discount_on_next_order",
        "cancel_order_and_full_refund",
        "exchange_for_different_size_color",
        "other",
      ],
    },

    // Solution Customer is Asking For
    solutionCustomerAskingFor: [
      {
        type: String,
        enum: [
          "immediate_replacement",
          "full_refund_processed_today",
          "partial_refund_keep_defective_items",
          "store_credit_instead_of_refund",
          "expedited_shipping_for_replacement",
          "discount_on_next_order",
          "cancel_order_and_full_refund",
          "exchange_for_different_size_color",
          "other",
        ],
      },
    ],

    // Additional Details
    additionalNotes: {
      type: String,
      maxlength: 1000,
    },

    // Status and Workflow
    status: {
      type: String,
      enum: ["submitted", "under_review", "in_progress", "resolved", "closed"],
      default: "submitted",
    },

    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },

    // Resolution Details
    resolution: {
      resolvedBy: {
        staffId: String,
        staffName: String,
      },
      resolutionDate: Date,
      resolutionDetails: String,
      refundAmount: Number,
      replacementOrderId: String,
      customerSatisfaction: {
        type: Number,
        min: 1,
        max: 5,
      },
    },

    // Manager Notes
    managerNotes: [
      {
        note: String,
        addedBy: {
          staffId: String,
          staffName: String,
        },
        addedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Timestamps
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },

    // Location Information
    deliveryLocation: {
      area: String,
      fullAddress: String,
    },

    // Order Value for Priority Calculation
    orderValue: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    indexes: [
      { orderId: 1 },
      { customerId: 1 },
      { "driverInfo.driverId": 1 },
      { status: 1 },
      { submittedAt: -1 },
      { priority: 1 },
    ],
  }
);

// Middleware to update lastUpdated
complaintSchema.pre("save", function (next) {
  this.lastUpdated = new Date();

  // Auto-calculate priority based on order value
  if (this.orderValue >= 200) {
    this.priority = "high";
  } else if (this.orderValue >= 100) {
    this.priority = "medium";
  } else {
    this.priority = "low";
  }

  next();
});

// Static method to get complaints dashboard stats
complaintSchema.statics.getDashboardStats = async function () {
  const stats = await this.aggregate([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
      },
    },
  ]);

  const dashboardStats = {
    total: 0,
    submitted: 0,
    under_review: 0,
    in_progress: 0,
    resolved: 0,
    closed: 0,
  };

  stats.forEach((stat) => {
    dashboardStats[stat._id] = stat.count;
    dashboardStats.total += stat.count;
  });

  return dashboardStats;
};

// Static method to get complaints for management dashboard
complaintSchema.statics.getComplaintsForManagement = async function (
  filters = {}
) {
  const query = {};

  if (filters.status && filters.status !== "all") {
    query.status = filters.status;
  }

  if (filters.priority) {
    query.priority = filters.priority;
  }

  if (filters.dateFrom) {
    query.submittedAt = { $gte: new Date(filters.dateFrom) };
  }

  if (filters.dateTo) {
    query.submittedAt = {
      ...query.submittedAt,
      $lte: new Date(filters.dateTo),
    };
  }

  return this.find(query)
    .populate("customerId", "name phoneNumber")
    .sort({ submittedAt: -1 })
    .lean();
};

// Method to update complaint status
complaintSchema.methods.updateStatus = function (
  newStatus,
  staffInfo,
  notes = ""
) {
  this.status = newStatus;
  this.lastUpdated = new Date();

  if (notes) {
    this.managerNotes.push({
      note: notes,
      addedBy: staffInfo,
      addedAt: new Date(),
    });
  }

  if (newStatus === "resolved" || newStatus === "closed") {
    if (!this.resolution.resolvedBy) {
      this.resolution.resolvedBy = staffInfo;
      this.resolution.resolutionDate = new Date();
    }
  }

  return this.save();
};

// Method to add manager note
complaintSchema.methods.addManagerNote = function (note, staffInfo) {
  this.managerNotes.push({
    note: note,
    addedBy: staffInfo,
    addedAt: new Date(),
  });
  this.lastUpdated = new Date();

  return this.save();
};

module.exports = mongoose.model("Complaint", complaintSchema);
