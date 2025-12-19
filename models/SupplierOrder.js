const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Issue schema for product-level and order-level issues
const issueSchema = new Schema({
  category: {
    type: String,
    enum: [
      // Product Condition Issues
      "product_broken_damaged",
      "scratched_dented_cracked",
      "leaking",
      "expired_close_to_expiry",
      "defective_not_working",
      "poor_quality_manufacturing_fault",
      // Quantity Issues
      "missing_items",
      "wrong_quantity",
      "incomplete_set",
      "extra_items_by_mistake",
      // Product Specification Issues
      "wrong_color",
      "wrong_size",
      "wrong_model_version",
      "wrong_material",
      "wrong_flavor_scent",
      // Packaging Issues
      "packaging_damaged",
      "packaging_opened_tampered",
      "missing_packaging",
      "incorrect_packaging",
      "poor_labeling",
      // Labeling & Documentation Issues
      "wrong_barcode",
      "missing_barcode",
      "incorrect_product_description",
      "missing_instructions_manual",
      "missing_warranty_documents",
      // Order & Shipping Issues
      "wrong_product_sent",
      "mixed_products",
      "incorrect_customer_order",
      "delivery_delay",
      "wrong_location",
      // Compliance & Safety Issues
      "not_meeting_safety_standards",
      "missing_safety_warnings",
      "incorrect_certification",
    ],
    required: true,
  },
  description: {
    type: String,
    maxlength: 1000,
  },
  media: [
    {
      type: {
        type: String,
        enum: ["photo", "video"],
        required: true,
      },
      url: {
        type: String,
        required: true,
      },
      filename: String,
      uploadedAt: {
        type: Date,
        default: Date.now,
      },
    },
  ],
  reportedBy: String,
  reportedAt: {
    type: Date,
    default: Date.now,
  },
});

// Product item in order
const orderProductSchema = new Schema({
  productRef: {
    type: Schema.Types.ObjectId,
    ref: "Product",
  },
  productId: {
    type: String,
    required: true,
  },
  productName: {
    type: String,
    required: true,
  },
  productImage: String,
  details: {
    size: String,
    color: String,
    material: String,
    specifications: String,
  },
  productItemNumber: {
    type: Number,
    required: true,
    min: 1,
  },
  orderedQuantity: {
    type: Number,
    required: true,
    min: 1,
  },
  receivedQuantity: {
    type: Number,
    default: 0,
    min: 0,
  },
  price: {
    type: Number,
    default: 0,
  },
  totalPrice: {
    type: Number,
    default: 0,
  },
  arrivalStatus: {
    type: String,
    enum: ["pending", "received", "partial", "missing", "damaged"],
    default: "pending",
  },
  arrivalVerifiedAt: Date,
  verifiedBy: String,
  notes: {
    type: String,
    maxlength: 500,
  },
  issues: [issueSchema],
});

// Main supplier order schema
const supplierOrderSchema = new Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
    },
    supplier: {
      type: Schema.Types.ObjectId,
      ref: "Supplier",
    },
    supplierName: {
      type: String,
      required: true,
    },
    supplierContact: String,
    supplierEmail: String,
    supplierAddress: String,

    // Dates
    orderDate: {
      type: Date,
      default: Date.now,
    },
    estimatedArrival: Date,
    actualArrival: Date,

    // Status
    status: {
      type: String,
      enum: [
        "pending",
        "in_transit",
        "arrived",
        "verification_in_progress",
        "issues_reported",
        "completed",
      ],
      default: "pending",
    },

    // Products
    products: [orderProductSchema],

    // Financials
    totalValue: {
      type: Number,
      default: 0,
    },
    productLineCount: {
      type: Number,
      default: 0,
    },

    // Overall order issues (quick checkboxes)
    issueCategories: {
      // Product Condition
      productBrokenDamaged: { type: Boolean, default: false },
      scratchedDentedCracked: { type: Boolean, default: false },
      leaking: { type: Boolean, default: false },
      expiredCloseToExpiry: { type: Boolean, default: false },
      defectiveNotWorking: { type: Boolean, default: false },
      poorQualityManufacturingFault: { type: Boolean, default: false },

      // Quantity
      missingItems: { type: Boolean, default: false },
      wrongQuantity: { type: Boolean, default: false },
      incompleteSet: { type: Boolean, default: false },
      extraItemsByMistake: { type: Boolean, default: false },

      // Specification
      wrongColor: { type: Boolean, default: false },
      wrongSize: { type: Boolean, default: false },
      wrongModelVersion: { type: Boolean, default: false },
      wrongMaterial: { type: Boolean, default: false },
      wrongFlavorScent: { type: Boolean, default: false },

      // Packaging
      packagingDamaged: { type: Boolean, default: false },
      packagingOpenedTampered: { type: Boolean, default: false },
      missingPackaging: { type: Boolean, default: false },
      incorrectPackaging: { type: Boolean, default: false },
      poorLabeling: { type: Boolean, default: false },

      // Labeling & Documentation
      wrongBarcode: { type: Boolean, default: false },
      missingBarcode: { type: Boolean, default: false },
      incorrectProductDescription: { type: Boolean, default: false },
      missingInstructionsManual: { type: Boolean, default: false },
      missingWarrantyDocuments: { type: Boolean, default: false },

      // Order & Shipping
      wrongProductSent: { type: Boolean, default: false },
      mixedProducts: { type: Boolean, default: false },
      incorrectCustomerOrder: { type: Boolean, default: false },
      deliveryDelay: { type: Boolean, default: false },
      wrongLocation: { type: Boolean, default: false },

      // Compliance & Safety
      notMeetingSafetyStandards: { type: Boolean, default: false },
      missingSafetyWarnings: { type: Boolean, default: false },
      incorrectCertification: { type: Boolean, default: false },

      // Overall flags
      allOrderBroken: { type: Boolean, default: false },
      wrongNumberOfProducts: { type: Boolean, default: false },
    },

    // Overall issues with detailed descriptions
    overallIssues: [issueSchema],

    // Additional notes
    additionalNotes: {
      type: String,
      maxlength: 2000,
    },

    // Tracking
    createdBy: {
      type: String,
      default: "Admin",
    },
    verifiedBy: String,
    verificationCompletedAt: Date,

    // Link to original stock order if exists
    originalOrderRef: {
      productId: Schema.Types.ObjectId,
      orderStockId: Schema.Types.ObjectId,
    },
  },
  { timestamps: true }
);

// Pre-save hook to auto-generate order number
supplierOrderSchema.pre("save", async function (next) {
  if (!this.orderNumber) {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    // Find the highest order number for today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const lastOrder = await this.constructor
      .findOne({
        createdAt: { $gte: today, $lt: tomorrow },
      })
      .sort({ orderNumber: -1 });

    let sequence = 1;
    if (lastOrder && lastOrder.orderNumber) {
      const lastSequence = parseInt(lastOrder.orderNumber.slice(-4), 10);
      if (!isNaN(lastSequence)) {
        sequence = lastSequence + 1;
      }
    }

    this.orderNumber = `SO${year}${month}${day}${String(sequence).padStart(4, "0")}`;
  }

  // Calculate totals and assign product item numbers
  if (this.products && this.products.length > 0) {
    this.productLineCount = this.products.length;
    
    // Assign product item numbers if not already set
    this.products.forEach((product, index) => {
      if (!product.productItemNumber) {
        product.productItemNumber = index + 1;
      }
    });
    
    // Calculate total value
    this.totalValue = this.products.reduce((sum, product) => {
      product.totalPrice = product.price * product.orderedQuantity;
      return sum + product.totalPrice;
    }, 0);
  }

  next();
});

// Method to check if all products are verified
supplierOrderSchema.methods.isFullyVerified = function () {
  return this.products.every(
    (product) => product.arrivalStatus !== "pending"
  );
};

// Method to get verification progress
supplierOrderSchema.methods.getVerificationProgress = function () {
  const total = this.products.length;
  const verified = this.products.filter(
    (p) => p.arrivalStatus !== "pending"
  ).length;
  return {
    total,
    verified,
    percentage: total > 0 ? Math.round((verified / total) * 100) : 0,
  };
};

// Method to check if there are any issues
supplierOrderSchema.methods.hasIssues = function () {
  // Check product-level issues
  const hasProductIssues = this.products.some(
    (product) => product.issues && product.issues.length > 0
  );

  // Check overall issues
  const hasOverallIssues = this.overallIssues && this.overallIssues.length > 0;

  // Check issue categories
  const hasCheckedCategories = Object.values(this.issueCategories || {}).some(
    (value) => value === true
  );

  return hasProductIssues || hasOverallIssues || hasCheckedCategories;
};

const SupplierOrder = mongoose.model("SupplierOrder", supplierOrderSchema);

module.exports = SupplierOrder;
