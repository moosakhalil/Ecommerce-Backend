const mongoose = require("mongoose");
const { Schema } = mongoose;

// Specification sub-schema
const specificationSchema = new Schema(
  {
    height: { type: Number },
    length: { type: Number },
    width: { type: Number },
    depth: { type: Number },
    weight: { type: Number }, // weight in kg or unit
    colours: { type: String },
    id: { type: Number },
  },
  { _id: false }
);

// ✅ FIXED: Discount Configuration Schema with sparse index
const discountConfigSchema = new Schema(
  {
    discountId: { type: String, unique: true, sparse: true }, // ✅ Added sparse: true
    discountTitle: { type: String, required: true },
    discountType: {
      type: String,
      enum: [
        "clearance",
        "new product",
        "general discount",
        "discount specific amount",
        "above amount (discount)",
        "above amount (for free delivery)",
      ],
      required: true,
    },
    forWho: {
      type: String,
      enum: [
        "public",
        "public referral",
        "forman",
        "forman referral",
        "forman earnings mlm",
      ],
      required: true,
    },
    isActive: { type: Boolean, default: true },

    // Pricing Details
    originalPrice: { type: Number, required: true },
    oldPrice: { type: Number },
    newPrice: { type: Number, required: true },
    discountAmount: { type: Number }, // Calculated field
    discountPercentage: { type: Number }, // Calculated field

    // Schedule
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    amount: { type: Number }, // Alternative to end date

    // Description and notes
    description: { type: String, maxlength: 500 },

    // Tracking
    createdBy: { type: String, default: "Admin" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },

    // Usage tracking
    usageCount: { type: Number, default: 0 },
    maxUsage: { type: Number }, // Optional usage limit
  },
  { _id: false }
);

// Main Product schema
const productSchema = new Schema(
  {
    productId: { type: String, unique: true },
    productType: {
      type: String,
      enum: ["Parent", "Child", "Normal"],
      required: true,
    },
    productName: { type: String, required: true },
    subtitle: String,
    brand: String,
    description: String,
    notes: String,

    // Child-only
    parentProduct: String,
    varianceName: String,
    subtitleDescription: String,

    // Identifiers
    globalTradeItemNumber: String,
    k3lNumber: String,
    sniNumber: String,

    // Specs
    specifications: [specificationSchema],

    // Inventory
    minimumOrder: { type: Number, default: 1 },
    highestValue: String,
    normalShelvesCount: Number,
    highShelvesCount: Number,

    useAmountStockmintoReorder: { type: Boolean, default: false },
    useSafetyDays: { type: Boolean, default: false },
    noReorder: { type: Boolean, default: false },
    AmountStockmintoReorder: Number,

    // Enhanced stock correction tracking fields
    stockCorrectionHistory: [
      {
        type: {
          type: String,
          enum: ["increase", "decrease", "correction"],
          required: true,
        },
        amount: {
          type: Number,
          required: true,
        },
        previousStock: {
          type: Number,
          required: true,
        },
        newStock: {
          type: Number,
          required: true,
        },
        reason: {
          type: String,
          enum: [
            "New inventory received",
            "Supplier delivery",
            "Return from customer",
            "Manufacturing completion",
            "Transfer from other location",
            "Inventory adjustment",
            "Found missing items",
            "Quality control passed",
            "Damaged goods",
            "Expired products",
            "Theft/Shrinkage",
            "Quality control rejection",
            "Inventory counting error",
            "Breakage during handling",
            "Weather/Environmental damage",
            "Customer returns",
            "Manufacturing defect",
            "Transfer to other location",
            "Other",
          ],
          required: true,
        },
        customReason: {
          type: String,
          maxlength: 200,
        },
        date: {
          type: Date,
          default: Date.now,
        },
        correctedBy: {
          type: String,
          default: "Admin",
        },
        notes: String,
      },
    ],

    safetyDaysStock: Number,

    // ✅ SIMPLIFIED: Remove main stockOrderStatus field - we'll use orderStock array status
    // stockOrderStatus field removed - status now lives in individual orders

    deliveryDays: Number,
    deliveryTime: String,
    reOrderSetting: String,
    inventoryInDays: String,
    deliveryPeriod: String,
    orderTimeBackupInventory: String,

    // ✅ UPDATED: Order Stock Management Fields with individual status
    orderStock: [
      {
        orderQuantity: {
          type: Number,
          required: true,
          min: 1,
        },
        approvedSupplier: {
          type: String,
          required: true,
        },
        selectedSupplierId: {
          type: Schema.Types.ObjectId,
          ref: "Supplier",
        },
        supplierEmail: String,
        supplierPhone: String,
        supplierAddress: String,
        currentStock: {
          type: Number,
          required: true,
        },
        reorderThreshold: {
          type: Number,
          required: true,
        },
        estimatedCost: {
          type: Number,
          default: 0,
        },
        notes: String,
        requestedBy: {
          type: String,
          default: "Admin",
        },
        requestedAt: {
          type: Date,
          default: Date.now,
        },

        // ✅ NEW: Individual order status (moved from main product level)
        status: {
          type: String,
          enum: [
            "pending",
            "order_placed",
            "order_confirmed",
            "delivered",
            "cancelled",
          ],
          default: "order_placed",
          required: true,
        },

        // Order tracking
        orderPlacedAt: Date,
        orderConfirmedAt: Date,
        estimatedDeliveryDate: Date,
        actualDeliveryDate: Date,
        orderNumber: String, // PO number or reference

        // Additional tracking
        priority: {
          type: String,
          enum: ["low", "medium", "high", "urgent"],
          default: "medium",
        },
        approvedBy: String,
        approvedAt: Date,
        cancelledAt: Date,
        cancelReason: String,
      },
    ],

    // ✅ UPDATED: Quick access fields for current pending orders
    hasPendingOrders: {
      type: Boolean,
      default: false,
    },
    totalPendingOrderQuantity: {
      type: Number,
      default: 0,
    },
    lastOrderDate: Date,

    // Supplier info
    selectedSupplierId: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
    },
    alternateSupplier: String,
    supplierName: String,
    supplierContact: String,
    supplierAddress: String,
    supplierEmail: String,
    supplierWebsite: String,
    supplierInformation: String,

    anyDiscount: {
      type: Number,
      default: null,
    },
    NormalPrice: {
      type: Number,
      default: null,
    },
    Stock: {
      type: Number,
      default: null,
    },
    // ✅ NEW: Discount Configuration
    discountConfig: discountConfigSchema,

    // ✅ NEW: Quick discount access fields
    hasActiveDiscount: { type: Boolean, default: false },
    currentDiscountPrice: { type: Number },
    discountValidUntil: { type: Date },

    // ✅ NEW: Vehicle Assignment Fields
    packageSize: {
      type: String,
      enum: ["Small", "Large"],
      required: false
    },
    suggestedVehicleType: {
      type: String,
      enum: ["Truck", "Pickup", "Scooter Truck (Tuk Tuk)", "Scooter"],
      required: false
    },
    vehicleTypeOverride: {
      type: String,
      enum: ["Truck", "Pickup", "Scooter Truck (Tuk Tuk)", "Scooter"],
      required: false
    },
    finalVehicleType: {
      type: String,
      enum: ["Truck", "Pickup", "Scooter Truck (Tuk Tuk)", "Scooter"],
      required: false
    },
    vehicleAssignmentHistory: [{
      assignedBy: String,
      vehicleType: String,
      reason: String,
      timestamp: { type: Date, default: Date.now }
    }],

    // Flags & visibility
    visibility: {
      type: String,
      enum: ["Public", "Private"],
      default: "Public",
    },
    onceShare: { type: Boolean, default: false },
    noChildHideParent: { type: Boolean, default: false },

    // Enhanced lost stock tracking fields
    lostStock: {
      type: Number,
      default: 0,
      min: 0,
      description: "Total units lost due to damage, theft, expiry, etc.",
    },

    lostStockHistory: [
      {
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
        reason: {
          type: String,
          enum: [
            "Damaged goods",
            "Expired products",
            "Theft/Shrinkage",
            "Quality control rejection",
            "Inventory counting error",
            "Breakage during handling",
            "Weather/Environmental damage",
            "Returned/Refunded items",
            "Customer returns",
            "Manufacturing defect",
            "Manual increase",
            "Manual decrease",
            "Other",
          ],
          default: "Other",
        },
        customReason: {
          type: String,
          maxlength: 200,
        },
        date: {
          type: Date,
          default: Date.now,
        },
        correctedBy: {
          type: String,
          default: "Admin",
        },
        originalStock: Number,
        correctedStock: Number,
        lostStockChange: Number, // +/- change in lost stock
        notes: String,
      },
    ],

    // Add audit field for stock corrections
    lastStockUpdate: {
      type: Date,
      default: Date.now,
    },

    // Categorization
    categories: String,
    subCategories: String,
    
    // Additional categories for child products
    additionalCategories: [{
      category: { type: String, required: true },
      subcategory: { type: String, required: true }
    }],
    
    tags: [String],

    // Images
    masterImage: {
      data: Buffer,
      contentType: String,
    },
    moreImages: [
      {
        data: Buffer,
        contentType: String,
      },
    ],
  },
  { timestamps: true }
);

// ✅ NEW: Method to calculate discount details
productSchema.methods.calculateDiscountDetails = function () {
  if (!this.discountConfig || !this.discountConfig.isActive) {
    return null;
  }

  const { originalPrice, newPrice } = this.discountConfig;
  const discountAmount = originalPrice - newPrice;
  const discountPercentage = ((discountAmount / originalPrice) * 100).toFixed(
    2
  );

  return {
    discountAmount,
    discountPercentage,
    savings: discountAmount,
  };
};

// ✅ NEW: Method to check if discount is currently valid
productSchema.methods.isDiscountValid = function () {
  if (!this.discountConfig || !this.discountConfig.isActive) {
    return false;
  }

  const now = new Date();
  const { startDate, endDate } = this.discountConfig;

  if (now < startDate) {
    return false; // Discount hasn't started yet
  }

  if (endDate && now > endDate) {
    return false; // Discount has expired
  }

  return true;
};

// ✅ NEW: Method to get effective price (with or without discount)
productSchema.methods.getEffectivePrice = function () {
  if (this.isDiscountValid()) {
    return this.discountConfig.newPrice;
  }
  return this.NormalPrice || this.discountConfig?.originalPrice || 0;
};

// ✅ UPDATED: Helper method to get product's overall order status
productSchema.methods.getOverallOrderStatus = function () {
  if (!this.orderStock || this.orderStock.length === 0) {
    return "needs_reorder";
  }

  const statuses = this.orderStock.map((order) => order.status);

  // Priority order: delivered > order_confirmed > order_placed > pending > cancelled
  if (statuses.includes("delivered")) return "delivered";
  if (statuses.includes("order_confirmed")) return "order_confirmed";
  if (statuses.includes("order_placed")) return "order_placed";
  if (statuses.includes("pending")) return "pending";
  return "needs_reorder";
};

// ✅ UPDATED: Helper method to check if product needs reordering
productSchema.methods.needsReorder = function () {
  // Calculate reorder threshold
  let reorderThreshold = 5;
  if (this.useAmountStockmintoReorder && this.AmountStockmintoReorder) {
    reorderThreshold = this.AmountStockmintoReorder;
  } else if (this.minimumOrder) {
    reorderThreshold = this.minimumOrder;
  }

  const currentStock = this.Stock || 0;
  const hasActiveOrders =
    this.orderStock &&
    this.orderStock.some((order) =>
      ["order_placed", "order_confirmed"].includes(order.status)
    );

  return currentStock <= reorderThreshold && !hasActiveOrders;
};

// ✅ UPDATED: Pre-save hook with discount processing
productSchema.pre("save", async function (next) {
  // Auto-generate productId if missing
  if (!this.productId) {
    const prefix =
      this.productType === "Parent"
        ? "P"
        : this.productType === "Child"
        ? "C"
        : "N";

    const highest = await this.constructor
      .findOne({ productId: new RegExp(`^${prefix}`) })
      .sort({ productId: -1 })
      .lean();

    let nextNum = 1;
    if (highest && highest.productId) {
      const num = parseInt(highest.productId.slice(1), 10);
      if (!isNaN(num)) nextNum = num + 1;
    }

    this.productId = `${prefix}${String(nextNum).padStart(4, "0")}`;
  }

  // Update quick access fields based on orderStock array
  if (this.orderStock) {
    const activeOrders = this.orderStock.filter((order) =>
      ["pending", "order_placed", "order_confirmed"].includes(order.status)
    );

    this.hasPendingOrders = activeOrders.length > 0;
    this.totalPendingOrderQuantity = activeOrders.reduce(
      (sum, order) => sum + order.orderQuantity,
      0
    );

    if (activeOrders.length > 0) {
      this.lastOrderDate = Math.max(
        ...activeOrders.map((order) => order.requestedAt)
      );
    }
  }

  // ✅ NEW: Process discount configuration
  if (this.discountConfig) {
    // Auto-generate discount ID if missing
    if (!this.discountConfig.discountId) {
      this.discountConfig.discountId = `DISC-${this.productId}-${Date.now()}`;
    }

    // Calculate discount amount and percentage
    if (this.discountConfig.originalPrice && this.discountConfig.newPrice) {
      this.discountConfig.discountAmount =
        this.discountConfig.originalPrice - this.discountConfig.newPrice;
      this.discountConfig.discountPercentage =
        (this.discountConfig.discountAmount /
          this.discountConfig.originalPrice) *
        100;
    }

    // Update quick access fields
    this.hasActiveDiscount = this.isDiscountValid();
    this.currentDiscountPrice = this.hasActiveDiscount
      ? this.discountConfig.newPrice
      : null;
    this.discountValidUntil = this.discountConfig.endDate;

    // Update timestamps
    this.discountConfig.updatedAt = new Date();
  } else {
    // Clear discount fields if no discount config
    this.hasActiveDiscount = false;
    this.currentDiscountPrice = null;
    this.discountValidUntil = null;
  }

  next();
});

module.exports = mongoose.model("Product", productSchema);
