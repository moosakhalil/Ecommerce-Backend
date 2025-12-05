const mongoose = require("mongoose");

const vendorSchema = new mongoose.Schema(
  {
    vendorId: {
      type: String,
      required: true,
      unique: true,
      default: function () {
        return "VND_" + Date.now().toString().slice(-8);
      },
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    phone: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
    },

    location: {
      city: String,
      area: String,
      fullAddress: String,
      coordinates: {
        latitude: Number,
        longitude: Number,
      },
    },

    // UPDATED: Now uses actual products instead of material types
    availableProducts: [
      {
        productId: {
          type: String,
          required: true,
          ref: "Product",
        },
        productName: String,
        isActive: {
          type: Boolean,
          default: true,
        },
        pricing: {
          supplierPrice: Number, // What vendor charges us
          salePrice: Number, // What we charge customer (supplier + commission)
          commission: {
            type: Number,
            default: 8, // 8% default commission
          },
        },
        availability: {
          inStock: {
            type: Boolean,
            default: true,
          },
          estimatedDeliveryDays: {
            type: Number,
            default: 1,
          },
          minimumOrderQuantity: {
            type: Number,
            default: 1,
          },
          maximumOrderQuantity: Number,
        },
        specifications: {
          quality: String,
          origin: String,
          certifications: [String],
          customNotes: String,
        },
      },
    ],

    // Service areas where this vendor can deliver
    // In vendor model - serviceAreas schema
    serviceAreas: [
      {
        area: {
          // This is the field name that's required
          type: String,
          required: true,
        },
        city: String,
        deliveryCharge: {
          type: Number,
          default: 0,
        },
        estimatedDeliveryTime: {
          type: String,
          default: "Same day",
        },
        isActive: {
          type: Boolean,
          default: true,
        },
      },
    ],

    status: {
      type: String,
      enum: ["Available", "Offline", "Busy"],
      default: "Available",
    },

    responseMetrics: {
      averageResponseTime: {
        type: Number,
        default: 0, // in minutes
      },
      totalOrders: {
        type: Number,
        default: 0,
      },
      completedOrders: {
        type: Number,
        default: 0,
      },
      cancelledOrders: {
        type: Number,
        default: 0,
      },
      rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5,
      },
      totalRatings: {
        type: Number,
        default: 0,
      },
    },

    bankDetails: {
      accountHolder: String,
      accountNumber: String,
      bankName: String,
      routingNumber: String,
    },

    // Track assigned orders from customer schema
    assignedOrders: [
      {
        customerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Customer",
        },
        orderId: String,
        customerName: String,
        customerPhone: String,
        assignedAt: {
          type: Date,
          default: Date.now,
        },
        orderStatus: String,
        deliveryArea: String,
        totalAmount: Number,
        products: [
          {
            productId: String,
            productName: String,
            quantity: Number,
          },
        ],
      },
    ],

    workingHours: {
      monday: { start: String, end: String, isOpen: Boolean },
      tuesday: { start: String, end: String, isOpen: Boolean },
      wednesday: { start: String, end: String, isOpen: Boolean },
      thursday: { start: String, end: String, isOpen: Boolean },
      friday: { start: String, end: String, isOpen: Boolean },
      saturday: { start: String, end: String, isOpen: Boolean },
      sunday: { start: String, end: String, isOpen: Boolean },
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    lastUpdated: {
      type: Date,
      default: Date.now,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for performance
vendorSchema.index({ vendorId: 1 });
vendorSchema.index({ name: 1 });
vendorSchema.index({ "availableProducts.productId": 1 });
vendorSchema.index({ "serviceAreas.area": 1 });
vendorSchema.index({ status: 1 });
vendorSchema.index({ "location.city": 1 });

// Pre-save middleware
vendorSchema.pre("save", function (next) {
  this.lastUpdated = new Date();
  next();
});

// UPDATED: Methods for new functionality
vendorSchema.methods.addProduct = function (productData) {
  // Check if product already exists
  const existingProduct = this.availableProducts.find(
    (p) => p.productId === productData.productId
  );

  if (existingProduct) {
    throw new Error("Product already exists for this vendor");
  }

  this.availableProducts.push(productData);
  return this.save();
};

vendorSchema.methods.updateProductPricing = function (productId, pricingData) {
  const product = this.availableProducts.find((p) => p.productId === productId);
  if (!product) {
    throw new Error("Product not found for this vendor");
  }

  product.pricing = { ...product.pricing, ...pricingData };
  return this.save();
};

vendorSchema.methods.addServiceArea = function (areaData) {
  // Check if area already exists
  const existingArea = this.serviceAreas.find((a) => a.area === areaData.area);

  if (existingArea) {
    throw new Error("Service area already exists for this vendor");
  }

  this.serviceAreas.push(areaData);
  return this.save();
};

vendorSchema.methods.canServiceArea = function (area) {
  return this.serviceAreas.some(
    (serviceArea) =>
      serviceArea.area.toLowerCase() === area.toLowerCase() &&
      serviceArea.isActive
  );
};

vendorSchema.methods.hasProduct = function (productId) {
  return this.availableProducts.some(
    (product) => product.productId === productId && product.isActive
  );
};

vendorSchema.methods.assignOrder = function (orderData) {
  // Check if order already assigned
  const existingOrder = this.assignedOrders.find(
    (order) => order.orderId === orderData.orderId
  );

  if (existingOrder) {
    return this;
  }

  this.assignedOrders.push({
    customerId: orderData.customerId,
    orderId: orderData.orderId,
    customerName: orderData.customerName,
    customerPhone: orderData.customerPhone,
    assignedAt: new Date(),
    orderStatus: orderData.orderStatus,
    deliveryArea: orderData.deliveryArea,
    totalAmount: orderData.totalAmount,
    products: orderData.products,
  });

  this.responseMetrics.totalOrders += 1;
  return this.save();
};

vendorSchema.methods.updateOrderStatus = function (orderId, newStatus) {
  const order = this.assignedOrders.find((order) => order.orderId === orderId);
  if (order) {
    order.orderStatus = newStatus;

    if (newStatus === "order-complete") {
      this.responseMetrics.completedOrders += 1;
    } else if (
      newStatus === "order-refunded" ||
      newStatus === "complain-order"
    ) {
      this.responseMetrics.cancelledOrders += 1;
    }

    return this.save();
  }
  return Promise.resolve(this);
};

vendorSchema.methods.addRating = function (rating) {
  const currentRating = this.responseMetrics.rating;
  const totalRatings = this.responseMetrics.totalRatings;

  this.responseMetrics.totalRatings += 1;
  this.responseMetrics.rating =
    (currentRating * totalRatings + rating) / this.responseMetrics.totalRatings;

  return this.save();
};

// UPDATED: Static methods for new functionality
vendorSchema.statics.findVendorsForArea = function (area, productIds = []) {
  const query = {
    status: "Available",
    isActive: true,
    "serviceAreas.area": { $regex: new RegExp(area, "i") },
    "serviceAreas.isActive": true,
  };

  // If specific products are needed, filter by those
  if (productIds && productIds.length > 0) {
    query["availableProducts.productId"] = { $in: productIds };
    query["availableProducts.isActive"] = true;
  }

  return this.find(query).sort({ "responseMetrics.rating": -1 });
};

vendorSchema.statics.findVendorsForProducts = function (productIds) {
  return this.find({
    status: "Available",
    isActive: true,
    "availableProducts.productId": { $in: productIds },
    "availableProducts.isActive": true,
  }).sort({ "responseMetrics.rating": -1 });
};

vendorSchema.statics.getVendorStats = function () {
  return this.aggregate([
    {
      $group: {
        _id: null,
        totalVendors: { $sum: 1 },
        activeVendors: {
          $sum: {
            $cond: [{ $eq: ["$status", "Available"] }, 1, 0],
          },
        },
        offlineVendors: {
          $sum: {
            $cond: [{ $eq: ["$status", "Offline"] }, 1, 0],
          },
        },
        averageRating: { $avg: "$responseMetrics.rating" },
        totalOrders: { $sum: "$responseMetrics.totalOrders" },
      },
    },
  ]);
};

// Get product statistics
vendorSchema.statics.getProductStats = function () {
  return this.aggregate([
    { $unwind: "$availableProducts" },
    { $match: { "availableProducts.isActive": true } },
    {
      $group: {
        _id: "$availableProducts.productId",
        productName: { $first: "$availableProducts.productName" },
        vendorCount: { $sum: 1 },
        averageSupplierPrice: {
          $avg: "$availableProducts.pricing.supplierPrice",
        },
        averageSalePrice: { $avg: "$availableProducts.pricing.salePrice" },
        averageCommission: { $avg: "$availableProducts.pricing.commission" },
      },
    },
    { $sort: { vendorCount: -1 } },
  ]);
};

// Get area coverage statistics
vendorSchema.statics.getAreaCoverage = function () {
  return this.aggregate([
    { $unwind: "$serviceAreas" },
    { $match: { "serviceAreas.isActive": true } },
    {
      $group: {
        _id: "$serviceAreas.area",
        vendorCount: { $sum: 1 },
        averageDeliveryCharge: { $avg: "$serviceAreas.deliveryCharge" },
      },
    },
    { $sort: { vendorCount: -1 } },
  ]);
};

module.exports = mongoose.model("Vendor", vendorSchema);
