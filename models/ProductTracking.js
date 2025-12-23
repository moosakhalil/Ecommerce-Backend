const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Movement History Sub-Schema
const movementHistorySchema = new Schema({
  timestamp: { type: Date, default: Date.now },
  fromLocation: {
    type: { type: String }, // warehouse, vehicle, supplier, customer
    details: String, // Zone A, Shelf A-12-3, etc.
  },
  toLocation: {
    type: { type: String },
    details: String,
  },
  movedBy: String, // Employee name/ID
  reason: {
    type: String,
    enum: ["receiving", "storage", "picking", "packing", "loading", "delivery", "return", "quality_check", "disposal", "other"],
  },
  status: String, // Status at this point
  notes: String,
});

// Quality Check Sub-Schema
const qualityCheckSchema = new Schema({
  checkDate: { type: Date, default: Date.now },
  checkedBy: String,
  status: {
    type: String,
    enum: ["passed", "failed", "conditional"],
  },
  condition: {
    type: String,
    enum: ["new", "good", "damaged", "defective", "expired"],
  },
  issues: [String],
  notes: String,
  photos: [String], // URLs to uploaded photos
});

// Status History Sub-Schema
const statusHistorySchema = new Schema({
  status: String,
  timestamp: { type: Date, default: Date.now },
  changedBy: String,
  reason: String,
  notes: String,
  relatedDocument: {
    docType: String, // supplier_order, customer_order, return
    documentId: String,
  },
});

// Main ProductTracking Schema
const ProductTrackingSchema = new Schema(
  {
    // Unique Tracking Identifier
    uti: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    
    // QR Code data (can be same as UTI or encoded version)
    qrCode: String,
    
    // Barcode (if applicable)
    barcode: String,

    // Product Reference - Links to existing Product model
    productRef: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      index: true,
    },
    productId: {
      type: String,
      required: true,
      index: true,
    },
    productName: {
      type: String,
      required: true,
    },

    // Batch Information
    batchId: {
      type: String,
      required: true,
      index: true,
    },
    batchNumber: String, // Supplier's batch number
    lotNumber: String, // Manufacturing lot number
    manufacturingDate: Date,
    expiryDate: Date,
    unitNumber: {
      type: Number,
      required: true,
    }, // Which unit within the batch (1, 2, 3...)

    // Supplier Information - Links to existing SupplierOrder
    supplierOrderRef: {
      type: Schema.Types.ObjectId,
      ref: "SupplierOrder",
    },
    supplierOrderNumber: String,
    productItemNumber: Number, // From supplier order
    supplierName: String,
    receivedDate: {
      type: Date,
      default: Date.now,
    },

    // Current Status
    currentStatus: {
      type: String,
      enum: [
        "received", // Just received from supplier
        "in_storage", // In warehouse storage
        "reserved", // Reserved for a customer order
        "allocated", // Allocated/picked for packing
        "packed", // Packed and ready
        "loaded", // Loaded on delivery vehicle
        "in_transit", // On the way to customer
        "delivered", // Delivered to customer
        "returned", // Returned by customer
        "damaged", // Damaged, not usable
        "lost", // Missing
        "disposed", // Scrapped or discarded
        "quality_check", // Undergoing inspection
        "recalled", // Recalled due to issues
      ],
      default: "received",
      required: true,
      index: true,
    },

    // Current Location
    currentLocation: {
      locationType: {
        type: String,
        enum: ["supplier", "warehouse", "packing_area", "loading_dock", "vehicle", "customer", "disposal"],
        default: "warehouse",
      },
      warehouseZone: String, // Zone A, Zone B
      shelfLocation: String, // A-12-3 (Aisle-Shelf-Bin)
      vehicleId: String, // If in transit
      vehicleName: String,
      customerId: String, // If delivered
      customerName: String,
      details: String, // Any additional location details
      lastUpdated: { type: Date, default: Date.now },
    },

    // Customer Order Linkage - Links to existing Customer model
    customerRef: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
    },
    customerOrderId: String, // Order ID from customer's shoppingHistory
    customerName: String,
    soldDate: Date,
    deliveryDate: Date,

    // Condition
    condition: {
      type: String,
      enum: ["new", "good", "damaged", "defective", "expired"],
      default: "new",
    },

    // Quality Checks
    qualityChecks: [qualityCheckSchema],

    // Movement History (Complete Audit Trail)
    movementHistory: [movementHistorySchema],

    // Status History
    statusHistory: [statusHistorySchema],

    // Special Attributes
    isHighValue: { type: Boolean, default: false },
    serialNumber: String,
    
    // Warranty Info
    warrantyInfo: {
      warrantyPeriod: Number, // In months
      warrantyStartDate: Date,
      warrantyEndDate: Date,
      warrantyProvider: String,
    },

    // Return Info
    returnInfo: {
      isReturned: { type: Boolean, default: false },
      returnDate: Date,
      returnReason: String,
      returnedBy: String,
      replacementUti: String,
      refundIssued: { type: Boolean, default: false },
    },

    // Flags
    isActive: { type: Boolean, default: true },
    isReserved: { type: Boolean, default: false },
    reservedFor: String, // Customer order ID
    reservationExpiry: Date,

    // Notes
    notes: String,

    // Metadata
    createdBy: String,
    lastModifiedBy: String,
  },
  { timestamps: true }
);

// Indexes for better query performance
ProductTrackingSchema.index({ batchId: 1, productId: 1 });
ProductTrackingSchema.index({ currentStatus: 1, "currentLocation.locationType": 1 });
ProductTrackingSchema.index({ expiryDate: 1 });
ProductTrackingSchema.index({ customerOrderId: 1 });
ProductTrackingSchema.index({ supplierOrderNumber: 1 });

// Virtual for full location string
ProductTrackingSchema.virtual("fullLocation").get(function () {
  const loc = this.currentLocation;
  if (loc.locationType === "warehouse") {
    return `${loc.warehouseZone || "Unknown Zone"} - ${loc.shelfLocation || "Unknown Shelf"}`;
  } else if (loc.locationType === "vehicle") {
    return `Vehicle: ${loc.vehicleName || loc.vehicleId || "Unknown"}`;
  } else if (loc.locationType === "customer") {
    return `Delivered to: ${loc.customerName || "Customer"}`;
  }
  return loc.details || loc.locationType;
});

// Pre-save hook to update status history
ProductTrackingSchema.pre("save", function (next) {
  if (this.isModified("currentStatus")) {
    this.statusHistory.push({
      status: this.currentStatus,
      timestamp: new Date(),
      changedBy: this.lastModifiedBy || "System",
      notes: `Status changed to ${this.currentStatus}`,
    });
  }
  next();
});

// Static method to generate UTI
ProductTrackingSchema.statics.generateUTI = function (productId, batchId, unitNumber) {
  return `${productId}-${batchId}-U${String(unitNumber).padStart(4, "0")}`;
};

// Static method to get tracking summary
ProductTrackingSchema.statics.getTrackingSummary = async function () {
  const summary = await this.aggregate([
    {
      $group: {
        _id: "$currentStatus",
        count: { $sum: 1 },
      },
    },
  ]);
  
  const result = {
    total: 0,
    received: 0,
    in_storage: 0,
    reserved: 0,
    allocated: 0,
    packed: 0,
    loaded: 0,
    in_transit: 0,
    delivered: 0,
    returned: 0,
    damaged: 0,
    lost: 0,
    disposed: 0,
  };
  
  summary.forEach((item) => {
    result[item._id] = item.count;
    result.total += item.count;
  });
  
  return result;
};

// Instance method to update status and location
ProductTrackingSchema.methods.updateStatusAndLocation = async function (
  newStatus,
  newLocation,
  changedBy = "System",
  reason = "",
  notes = ""
) {
  // Add to movement history
  this.movementHistory.push({
    timestamp: new Date(),
    fromLocation: {
      type: this.currentLocation.locationType,
      details: this.fullLocation,
    },
    toLocation: {
      type: newLocation.locationType,
      details: newLocation.details || "",
    },
    movedBy: changedBy,
    reason: reason,
    status: newStatus,
    notes: notes,
  });

  // Update current status and location
  this.currentStatus = newStatus;
  this.currentLocation = {
    ...newLocation,
    lastUpdated: new Date(),
  };
  this.lastModifiedBy = changedBy;

  await this.save();
  return this;
};

module.exports = mongoose.model("ProductTracking", ProductTrackingSchema);
