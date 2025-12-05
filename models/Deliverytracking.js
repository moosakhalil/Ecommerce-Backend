// models/DeliveryTracking.js - Updated with proper method implementations
const mongoose = require("mongoose");

const DeliveryTrackingSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },

    // Workflow Status Tracking - Each step can be true/false
    workflowStatus: {
      pending: {
        completed: { type: Boolean, default: false },
        completedAt: Date,
        completedBy: {
          employeeId: String,
          employeeName: String,
        },
      },
      packed: {
        completed: { type: Boolean, default: false },
        completedAt: Date,
        completedBy: {
          employeeId: String,
          employeeName: String,
        },
        packingNotes: String,
      },
      storage: {
        completed: { type: Boolean, default: false },
        completedAt: Date,
        completedBy: {
          employeeId: String,
          employeeName: String,
        },
        storageLocation: String,
      },
      assigned: {
        completed: { type: Boolean, default: false },
        completedAt: Date,
        assignedDriver: {
          employeeId: String,
          employeeName: String,
          phone: String,
        },
        assignedBy: {
          employeeId: String,
          employeeName: String,
        },
      },
      loaded: {
        completed: { type: Boolean, default: false },
        completedAt: Date,
        completedBy: {
          employeeId: String,
          employeeName: String,
        },
        vehicleInfo: {
          vehicleId: String,
          vehicleType: String,
          vehicleName: String,
        },
        loadingDetails: {
          totalItemsLoaded: Number,
          totalItemsRequested: Number,
          loadingProgress: Number, // Percentage
          loadingNotes: String,
          allItemsVerified: Boolean,
        },
      },
      inTransit: {
        completed: { type: Boolean, default: false },
        completedAt: Date,
        startedBy: {
          employeeId: String,
          employeeName: String,
        },
        currentLocation: {
          latitude: Number,
          longitude: Number,
          address: String,
          lastUpdated: Date,
        },
      },
      delivered: {
        completed: { type: Boolean, default: false },
        completedAt: Date,
        deliveredBy: {
          employeeId: String,
          employeeName: String,
        },
        customerSignature: String,
        deliveryNotes: String,
        customerSatisfaction: {
          type: Number,
          min: 1,
          max: 5,
        },
      },
    },

    // Current Overall Status (from Customer schema)
    currentStatus: {
      type: String,
      default: "order-confirmed",
    },

    // Priority (calculated from order amount)
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },

    // Order Details Cache (for quick access)
    orderDetails: {
      totalAmount: Number,
      itemCount: Number,
      deliveryDate: Date,
      timeSlot: String,
      deliveryAddress: {
        area: String,
        fullAddress: String,
      },
      customerPhone: String,
      customerName: String,
    },

    // Packing Details
    packingDetails: {
      totalItems: { type: Number, default: 0 },
      packedItems: { type: Number, default: 0 },
      packingProgress: { type: Number, default: 0 }, // Percentage
      itemStatus: [
        {
          itemIndex: Number,
          productName: String,
          packed: { type: Boolean, default: false },
          packedAt: Date,
          complaint: {
            hasComplaint: { type: Boolean, default: false },
            complaintType: String,
            complaintDetails: String,
            reportedAt: Date,
          },
        },
      ],
    },

    // Special Instructions & Notes
    specialInstructions: String,
    adminNotes: String,

    // Timing Metrics
    timingMetrics: {
      orderPlacedAt: Date,
      packingStartedAt: Date,
      packingCompletedAt: Date,
      driverAssignedAt: Date,
      dispatchedAt: Date,
      estimatedDeliveryTime: Date,
      actualDeliveryTime: Date,
    },

    // WhatsApp Integration
    whatsappDetails: {
      customerPhone: String,
      lastMessageSent: Date,
      messageHistory: [
        {
          messageType: String, // 'status_update', 'delivery_notification', etc.
          sentAt: Date,
          content: String,
        },
      ],
    },

    // System Metadata
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
DeliveryTrackingSchema.index({ orderId: 1 });
DeliveryTrackingSchema.index({ customerId: 1 });
DeliveryTrackingSchema.index({ currentStatus: 1 });
DeliveryTrackingSchema.index({ "workflowStatus.pending.completed": 1 });
DeliveryTrackingSchema.index({ "workflowStatus.packed.completed": 1 });
DeliveryTrackingSchema.index({ "orderDetails.deliveryDate": 1 });
DeliveryTrackingSchema.index({ createdAt: 1 });

// Middleware to update lastUpdated
DeliveryTrackingSchema.pre("save", function (next) {
  this.lastUpdated = new Date();
  next();
});

// Method to update workflow status
DeliveryTrackingSchema.methods.updateWorkflowStatus = function (
  step,
  completed,
  details = {}
) {
  if (!this.workflowStatus[step]) {
    return Promise.reject(new Error(`Invalid workflow step: ${step}`));
  }

  this.workflowStatus[step].completed = completed;
  this.workflowStatus[step].completedAt = completed ? new Date() : null;

  // Add step-specific details
  Object.keys(details).forEach((key) => {
    if (key !== "completed" && key !== "completedAt") {
      this.workflowStatus[step][key] = details[key];
    }
  });

  this.lastUpdated = new Date();
  return this.save();
};

// Method to update packing progress
DeliveryTrackingSchema.methods.updatePackingProgress = function (
  packedItems,
  totalItems
) {
  this.packingDetails.packedItems = packedItems;
  this.packingDetails.totalItems = totalItems;
  this.packingDetails.packingProgress =
    totalItems > 0 ? Math.round((packedItems / totalItems) * 100) : 0;

  // Auto-update packed status
  if (packedItems === totalItems && totalItems > 0) {
    this.workflowStatus.packed.completed = true;
    this.workflowStatus.packed.completedAt = new Date();
  }

  return this.save();
};

// Method to get workflow progress summary
DeliveryTrackingSchema.methods.getWorkflowProgress = function () {
  const workflow = this.workflowStatus;
  return {
    pending: workflow.pending?.completed || false,
    packed: workflow.packed?.completed || false,
    storage: workflow.storage?.completed || false,
    assigned: workflow.assigned?.completed || false,
    loaded: workflow.loaded?.completed || false,
    inTransit: workflow.inTransit?.completed || false,
    delivered: workflow.delivered?.completed || false,
  };
};

// Method to calculate priority based on order amount
DeliveryTrackingSchema.methods.calculatePriority = function () {
  const amount = this.orderDetails.totalAmount || 0;
  if (amount >= 200) {
    this.priority = "high";
  } else if (amount >= 100) {
    this.priority = "medium";
  } else {
    this.priority = "low";
  }
  return this.priority;
};

// Static method to create tracking from customer order
DeliveryTrackingSchema.statics.createFromCustomerOrder = async function (
  customer,
  order
) {
  const totalAmount = order.totalAmount || 0;
  const itemCount = order.items ? order.items.length : 0;

  const tracking = new this({
    orderId: order.orderId,
    customerId: customer._id,
    currentStatus: order.status,

    orderDetails: {
      totalAmount: totalAmount,
      itemCount: itemCount,
      deliveryDate: order.deliveryDate,
      timeSlot: order.timeSlot,
      deliveryAddress: {
        area: order.deliveryAddress?.area || "",
        fullAddress: order.deliveryAddress?.fullAddress || "",
      },
      customerPhone: customer.phoneNumber[0] || "",
      customerName: customer.name,
    },

    packingDetails: {
      totalItems: itemCount,
      packedItems: 0,
      packingProgress: 0,
      itemStatus: order.items
        ? order.items.map((item, index) => ({
            itemIndex: index,
            productName: item.productName,
            packed: false,
            complaint: {
              hasComplaint: false,
            },
          }))
        : [],
    },

    specialInstructions: order.adminReason || "",

    timingMetrics: {
      orderPlacedAt: order.orderDate,
      estimatedDeliveryTime: order.deliveryDate,
    },

    whatsappDetails: {
      customerPhone: customer.phoneNumber[0] || "",
      messageHistory: [],
    },
  });

  // Calculate priority
  tracking.calculatePriority();

  // Set initial workflow status based on current order status
  if (["order-confirmed"].includes(order.status)) {
    tracking.workflowStatus.pending.completed = false;
  }

  return tracking.save();
};

// STATIC METHOD: Bulk update workflow progress for all tracking records
DeliveryTrackingSchema.statics.syncWorkflowProgress = async function () {
  try {
    console.log(
      "🔄 Syncing workflow progress for all delivery tracking records..."
    );

    const trackingRecords = await this.find({});
    let updated = 0;

    for (let tracking of trackingRecords) {
      // Find corresponding customer order
      const Customer = mongoose.model("Customer");
      const customer = await Customer.findOne({
        "shoppingHistory.orderId": tracking.orderId,
      });

      if (customer) {
        const order = customer.shoppingHistory.find(
          (o) => o.orderId === tracking.orderId
        );

        if (order) {
          let hasChanges = false;

          // Update workflow based on order status
          switch (order.status) {
            case "order-confirmed":
              if (!tracking.workflowStatus.pending.completed) {
                tracking.workflowStatus.pending.completed = false;
                hasChanges = true;
              }
              break;

            case "picking-order":
              if (!tracking.workflowStatus.pending.completed) {
                tracking.workflowStatus.pending.completed = true;
                tracking.workflowStatus.pending.completedAt =
                  order.packingDetails?.packingStartedAt || new Date();
                hasChanges = true;
              }
              break;

            case "allocated-driver":
              if (!tracking.workflowStatus.packed.completed) {
                tracking.workflowStatus.pending.completed = true;
                tracking.workflowStatus.packed.completed = true;
                tracking.workflowStatus.packed.completedAt =
                  order.packingDetails?.packingCompletedAt || new Date();
                hasChanges = true;
              }
              break;

            case "ready to pickup":
              if (!tracking.workflowStatus.storage.completed) {
                tracking.workflowStatus.pending.completed = true;
                tracking.workflowStatus.packed.completed = true;
                tracking.workflowStatus.storage.completed = true;
                tracking.workflowStatus.storage.completedAt = new Date();
                hasChanges = true;
              }
              break;

            case "order-pickuped-up":
              if (!tracking.workflowStatus.loaded.completed) {
                tracking.workflowStatus.pending.completed = true;
                tracking.workflowStatus.packed.completed = true;
                tracking.workflowStatus.storage.completed = true;
                tracking.workflowStatus.assigned.completed = true;
                tracking.workflowStatus.loaded.completed = true;
                tracking.workflowStatus.loaded.completedAt = new Date();
                hasChanges = true;
              }
              break;

            case "on-way":
            case "driver-confirmed":
              if (!tracking.workflowStatus.inTransit.completed) {
                tracking.workflowStatus.pending.completed = true;
                tracking.workflowStatus.packed.completed = true;
                tracking.workflowStatus.storage.completed = true;
                tracking.workflowStatus.assigned.completed = true;
                tracking.workflowStatus.loaded.completed = true;
                tracking.workflowStatus.inTransit.completed = true;
                tracking.workflowStatus.inTransit.completedAt = new Date();
                hasChanges = true;
              }
              break;

            case "order-processed":
              if (!tracking.workflowStatus.delivered.completed) {
                tracking.workflowStatus.pending.completed = true;
                tracking.workflowStatus.packed.completed = true;
                tracking.workflowStatus.storage.completed = true;
                tracking.workflowStatus.assigned.completed = true;
                tracking.workflowStatus.loaded.completed = true;
                tracking.workflowStatus.inTransit.completed = true;
                tracking.workflowStatus.delivered.completed = true;
                tracking.workflowStatus.delivered.completedAt = new Date();
                hasChanges = true;
              }
              break;
          }

          // Update current status
          if (tracking.currentStatus !== order.status) {
            tracking.currentStatus = order.status;
            hasChanges = true;
          }

          if (hasChanges) {
            await tracking.save();
            updated++;
          }
        }
      }
    }

    console.log(`✅ Updated ${updated} tracking records`);
    return updated;
  } catch (error) {
    console.error("❌ Error syncing workflow progress:", error);
    throw error;
  }
};
DeliveryTrackingSchema.methods.updateLoadingStatus = function (loadingData) {
  this.workflowStatus.loaded.completed = true;
  this.workflowStatus.loaded.completedAt = new Date();
  this.workflowStatus.loaded.completedBy = loadingData.completedBy;
  this.workflowStatus.loaded.vehicleInfo = loadingData.vehicleInfo;
  this.workflowStatus.loaded.loadingDetails = loadingData.loadingDetails;

  // Update current status
  this.currentStatus = "ready for driver";

  // Update timing metrics
  this.timingMetrics.dispatchedAt = new Date();

  return this.save();
};

// STATIC METHOD: Get orders ready for loading verification
DeliveryTrackingSchema.statics.getLoadingQueue = async function () {
  const trackingRecords = await this.find({
    currentStatus: { $in: ["assigned-dispatch-officer-2", "ready for driver"] },
    "workflowStatus.assigned.completed": true,
    isActive: true,
  })
    .populate("customerId")
    .lean();

  const Customer = mongoose.model("Customer");

  let loadingQueue = [];

  for (let tracking of trackingRecords) {
    // Get the full customer data
    const customer = await Customer.findById(tracking.customerId);
    if (!customer) continue;

    // Find the corresponding order
    const order = customer.shoppingHistory.find(
      (o) => o.orderId === tracking.orderId
    );
    if (
      !order ||
      !["assigned-dispatch-officer-2", "ready for driver"].includes(
        order.status
      )
    )
      continue;

    // Calculate loading progress
    const totalItems = order.items ? order.items.length : 0;
    const loadedItems = order.items
      ? order.items.filter((item) => item.loadingVerified === true).length
      : 0;
    const loadingProgress =
      totalItems > 0 ? Math.round((loadedItems / totalItems) * 100) : 0;

    loadingQueue.push({
      orderId: tracking.orderId,
      trackingId: tracking._id,
      customerName: customer.name,
      customerPhone: customer.phoneNumber[0] || "",
      deliveryDate: order.deliveryDate,
      timeSlot: order.timeSlot || "",
      deliveryAddress: order.deliveryAddress,
      assignmentDetails: order.assignmentDetails || {},
      totalItems: totalItems,
      loadedItems: loadedItems,
      loadingProgress: loadingProgress,
      status: order.status,
      items: order.items || [],
      specialInstructions: order.adminReason || "",
      workflowProgress: tracking.getWorkflowProgress
        ? tracking.getWorkflowProgress()
        : {},
    });
  }

  return loadingQueue;
};

// STATIC METHOD: Get vehicle loading status
DeliveryTrackingSchema.statics.getVehicleLoadingStatus = async function () {
  const Customer = mongoose.model("Customer");

  // Get all customers with orders assigned to dispatch officer 2 or ready for driver
  const customers = await Customer.find({
    "shoppingHistory.status": {
      $in: ["assigned-dispatch-officer-2", "ready for driver"],
    },
  }).lean();

  let vehicleStatus = {};

  for (let customer of customers) {
    for (let order of customer.shoppingHistory) {
      if (
        ["assigned-dispatch-officer-2", "ready for driver"].includes(
          order.status
        )
      ) {
        const assignmentDetails = order.assignmentDetails;

        if (assignmentDetails && assignmentDetails.assignedVehicle) {
          const vehicleId = assignmentDetails.assignedVehicle.vehicleId;

          if (!vehicleStatus[vehicleId]) {
            vehicleStatus[vehicleId] = {
              vehicleId: vehicleId,
              vehicleInfo: assignmentDetails.assignedVehicle,
              driverInfo: assignmentDetails.assignedDriver,
              orders: [],
              totalItems: 0,
              loadedItems: 0,
              loadingProgress: 0,
              allOrdersReady: false,
            };
          }

          // Calculate loading progress for this order
          const totalItems = order.items ? order.items.length : 0;
          const loadedItems = order.items
            ? order.items.filter((item) => item.loadingVerified === true).length
            : 0;

          vehicleStatus[vehicleId].orders.push({
            orderId: order.orderId,
            customerName: customer.name,
            status: order.status,
            totalItems: totalItems,
            loadedItems: loadedItems,
            isComplete: order.status === "ready for driver",
          });

          vehicleStatus[vehicleId].totalItems += totalItems;
          vehicleStatus[vehicleId].loadedItems += loadedItems;
        }
      }
    }
  }

  // Calculate final status for each vehicle
  Object.values(vehicleStatus).forEach((vehicle) => {
    vehicle.loadingProgress =
      vehicle.totalItems > 0
        ? Math.round((vehicle.loadedItems / vehicle.totalItems) * 100)
        : 0;

    vehicle.allOrdersReady = vehicle.orders.every(
      (order) => order.status === "ready for driver"
    );
  });

  return Object.values(vehicleStatus);
};

// STATIC METHOD: Sync loading status
DeliveryTrackingSchema.statics.syncLoadingStatus = async function () {
  try {
    console.log("🔄 Syncing loading status for delivery tracking...");

    const Customer = mongoose.model("Customer");

    // Find all tracking records that should be loaded but aren't marked as such
    const trackingRecords = await this.find({
      currentStatus: { $ne: "ready for driver" },
      "workflowStatus.loaded.completed": false,
      "workflowStatus.assigned.completed": true,
    });

    let updated = 0;

    for (let tracking of trackingRecords) {
      const customer = await Customer.findOne({
        "shoppingHistory.orderId": tracking.orderId,
      });

      if (customer) {
        const order = customer.shoppingHistory.find(
          (o) => o.orderId === tracking.orderId
        );

        if (
          order &&
          order.status === "ready for driver" &&
          order.loadingDetails
        ) {
          // Update tracking to match customer order status
          tracking.workflowStatus.loaded.completed = true;
          tracking.workflowStatus.loaded.completedAt =
            order.loadingDetails.verificationCompletedAt;
          tracking.workflowStatus.loaded.completedBy = {
            employeeId:
              order.loadingDetails.verificationStaff?.staffId || "DO2_001",
            employeeName:
              order.loadingDetails.verificationStaff?.staffName ||
              "Dispatch Officer 2",
          };

          if (order.assignmentDetails?.assignedVehicle) {
            tracking.workflowStatus.loaded.vehicleInfo = {
              vehicleId: order.assignmentDetails.assignedVehicle.vehicleId,
              vehicleType: order.assignmentDetails.assignedVehicle.category,
              vehicleName: order.assignmentDetails.assignedVehicle.displayName,
            };
          }

          tracking.workflowStatus.loaded.loadingDetails = {
            totalItemsLoaded: order.loadingDetails.totalItemsLoaded || 0,
            totalItemsRequested: order.loadingDetails.totalItemsRequested || 0,
            loadingProgress: order.loadingDetails.loadingProgress || 0,
            loadingNotes: order.loadingDetails.loadingNotes || "",
            allItemsVerified: order.loadingDetails.isReadyForDispatch || false,
          };

          tracking.currentStatus = "ready for driver";
          tracking.timingMetrics.dispatchedAt =
            order.loadingDetails.verificationCompletedAt;

          await tracking.save();
          updated++;
        }
      }
    }

    console.log(`✅ Updated ${updated} tracking records for loading status`);
    return updated;
  } catch (error) {
    console.error("❌ Error syncing loading status:", error);
    throw error;
  }
};

DeliveryTrackingSchema.index({ "workflowStatus.loaded.completed": 1 });
DeliveryTrackingSchema.index({
  "workflowStatus.loaded.completedBy.employeeId": 1,
});
DeliveryTrackingSchema.index({
  "workflowStatus.loaded.vehicleInfo.vehicleId": 1,
});

// Add these methods to the DeliveryTracking schema (models/DeliveryTracking.js):

// Method to update status to on-route
DeliveryTrackingSchema.methods.startDeliveryRoute = function (driverInfo) {
  this.workflowStatus.inTransit.completed = true;
  this.workflowStatus.inTransit.completedAt = new Date();
  this.workflowStatus.inTransit.startedBy = driverInfo;

  this.currentStatus = "on-route";
  this.timingMetrics.dispatchedAt = new Date();

  return this.save();
};

// Method to mark as arrived
DeliveryTrackingSchema.methods.markAsArrived = function (arrivalInfo) {
  if (this.workflowStatus.inTransit.currentLocation) {
    this.workflowStatus.inTransit.currentLocation = {
      ...this.workflowStatus.inTransit.currentLocation,
      address: arrivalInfo.location?.address || "Delivery location",
      latitude: arrivalInfo.location?.latitude,
      longitude: arrivalInfo.location?.longitude,
      lastUpdated: new Date(),
    };
  } else {
    this.workflowStatus.inTransit.currentLocation = {
      address: arrivalInfo.location?.address || "Delivery location",
      latitude: arrivalInfo.location?.latitude,
      longitude: arrivalInfo.location?.longitude,
      lastUpdated: new Date(),
    };
  }

  return this.save();
};

// Method to complete delivery
DeliveryTrackingSchema.methods.completeDelivery = function (deliveryInfo) {
  this.workflowStatus.delivered.completed = true;
  this.workflowStatus.delivered.completedAt = new Date();
  this.workflowStatus.delivered.deliveredBy = {
    employeeId: deliveryInfo.driverId,
    employeeName: deliveryInfo.driverName,
  };
  this.workflowStatus.delivered.customerSignature =
    deliveryInfo.customerSignature || "";
  this.workflowStatus.delivered.deliveryNotes =
    deliveryInfo.deliveryNotes || "";
  this.workflowStatus.delivered.customerSatisfaction =
    deliveryInfo.customerSatisfaction || 5;

  this.currentStatus = "order-complete";
  this.timingMetrics.actualDeliveryTime = new Date();

  return this.save();
};

// Static method to get orders on route
DeliveryTrackingSchema.statics.getOrdersOnRoute = async function (driverId) {
  const trackingRecords = await this.find({
    currentStatus: "on-route",
    isActive: true,
  }).lean();

  const Customer = mongoose.model("Customer");
  let onRouteOrders = [];

  for (let tracking of trackingRecords) {
    const customer = await Customer.findById(tracking.customerId);
    if (!customer) continue;

    const order = customer.shoppingHistory.find(
      (o) => o.orderId === tracking.orderId
    );
    if (!order || order.status !== "on-route") continue;

    // Filter by driver if specified
    if (driverId && order.routeStartedBy?.driverId !== driverId) {
      continue;
    }

    onRouteOrders.push({
      orderId: tracking.orderId,
      trackingId: tracking._id,
      customerName: customer.name,
      customerPhone: customer.phoneNumber[0] || "",
      deliveryDate: order.deliveryDate,
      timeSlot: order.timeSlot || "",
      deliveryAddress: order.deliveryAddress,
      specialInstructions: order.adminReason || "",
      routeStartedAt: order.routeStartedAt,
      routeStartedBy: order.routeStartedBy,
      items: order.items || [],
      totalItems: order.items ? order.items.length : 0,
      assignmentDetails: order.assignmentDetails || {},
      deliveryPhotos: order.deliveryPhotos || [],
      isArrived: order.arrivedAt ? true : false,
      arrivedAt: order.arrivedAt,
      workflowProgress: tracking.getWorkflowProgress
        ? tracking.getWorkflowProgress()
        : {},
    });
  }

  return onRouteOrders;
};

// Static method to sync delivery status
DeliveryTrackingSchema.statics.syncDeliveryStatus = async function () {
  try {
    console.log("🔄 Syncing delivery status for tracking records...");

    const Customer = mongoose.model("Customer");
    let updated = 0;

    // Sync on-route orders
    const onRouteCustomers = await Customer.find({
      "shoppingHistory.status": "on-route",
    });

    for (let customer of onRouteCustomers) {
      for (let order of customer.shoppingHistory) {
        if (order.status === "on-route") {
          const tracking = await this.findOne({ orderId: order.orderId });
          if (tracking && tracking.currentStatus !== "on-route") {
            await tracking.startDeliveryRoute({
              employeeId: order.routeStartedBy?.driverId || "DR_001",
              employeeName: order.routeStartedBy?.driverName || "Driver",
            });
            updated++;
          }
        }
      }
    }

    // Sync completed orders
    const completedCustomers = await Customer.find({
      "shoppingHistory.status": "order-complete",
    });

    for (let customer of completedCustomers) {
      for (let order of customer.shoppingHistory) {
        if (order.status === "order-complete") {
          const tracking = await this.findOne({ orderId: order.orderId });
          if (tracking && tracking.currentStatus !== "order-complete") {
            await tracking.completeDelivery({
              driverId: order.deliveredBy?.driverId || "DR_001",
              driverName: order.deliveredBy?.driverName || "Driver",
              deliveryNotes: order.deliveryNotes || "",
              customerSatisfaction: order.customerSatisfaction || 5,
            });
            updated++;
          }
        }
      }
    }

    console.log(`✅ Updated ${updated} delivery tracking records`);
    return updated;
  } catch (error) {
    console.error("❌ Error syncing delivery status:", error);
    throw error;
  }
};

// Add indexes for performance
DeliveryTrackingSchema.index({ "workflowStatus.inTransit.completed": 1 });
DeliveryTrackingSchema.index({ "workflowStatus.delivered.completed": 1 });
DeliveryTrackingSchema.index({
  "workflowStatus.inTransit.startedBy.employeeId": 1,
});
module.exports = mongoose.model("DeliveryTracking", DeliveryTrackingSchema);
