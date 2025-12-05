// routes/dispatchOfficer2Routes.js - Complete Dispatch Officer 2 routes
const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");
const DeliveryTracking = require("../models/Deliverytracking");

// Helper function to get workflow progress
function getWorkflowProgress(tracking) {
  if (
    tracking.getWorkflowProgress &&
    typeof tracking.getWorkflowProgress === "function"
  ) {
    return tracking.getWorkflowProgress();
  }

  const workflow = tracking.workflowStatus || {};
  return {
    pending: workflow.pending?.completed || false,
    packed: workflow.packed?.completed || false,
    storage: workflow.storage?.completed || false,
    assigned: workflow.assigned?.completed || false,
    loaded: workflow.loaded?.completed || false,
    inTransit: workflow.inTransit?.completed || false,
    delivered: workflow.delivered?.completed || false,
  };
}

// Get verification & loading queue - orders assigned to Dispatch Officer 2
router.get("/queue", async (req, res) => {
  try {
    // ✅ FIXED: Use "order-picked-up" from master status list
    const customers = await Customer.find({
      "shoppingHistory.status": {
        $in: ["assigned-dispatch-officer-2", "order-picked-up"],
      },
    }).lean();

    let verificationQueue = [];

    for (let customer of customers) {
      for (let order of customer.shoppingHistory) {
        if (
          ["assigned-dispatch-officer-2", "ready-for-driver"].includes(
            order.status
          )
        ) {
          // Get delivery tracking for workflow status
          let tracking = await DeliveryTracking.findOne({
            orderId: order.orderId,
          });

          if (!tracking) {
            tracking = await DeliveryTracking.createFromCustomerOrder(
              customer,
              order
            );
          }

          // Only include orders that are assigned but not yet loaded (or ready for driver)
          const progress = getWorkflowProgress(tracking);

          // Calculate verification progress
          const totalItems = order.items ? order.items.length : 0;
          const verifiedItems = order.items
            ? order.items.filter((item) => item.loadingVerified === true).length
            : 0;
          const verificationProgress =
            totalItems > 0 ? Math.round((verifiedItems / totalItems) * 100) : 0;

          // Determine loading status
          let loadingStatus = "pending";
          if (order.status === "ready-for-driver") {
            loadingStatus = "confirmed for dispatch";
          } else if (verificationProgress === 100) {
            loadingStatus = "verified";
          } else if (verificationProgress > 0) {
            loadingStatus = "verifying";
          }

          verificationQueue.push({
            orderId: order.orderId,
            customerName: customer.name,
            customerPhone: customer.phoneNumber[0] || "",
            deliveryDate: order.deliveryDate,
            timeSlot: order.timeSlot || "15:00 - 18:00",
            deliveryAddress: {
              area: order.deliveryAddress?.area || "",
              fullAddress: order.deliveryAddress?.fullAddress || "",
            },
            assignmentDetails: order.assignmentDetails || {},
            totalItems: totalItems,
            verifiedItems: verifiedItems,
            verificationProgress: verificationProgress,
            status: order.status,
            loadingStatus: loadingStatus,
            items: order.items || [],
            route: `Route-${
              order.deliveryAddress?.area?.substring(0, 2) || "XX"
            }${Math.floor(Math.random() * 9) + 1}`,
            specialInstructions: order.adminReason || "",
            workflowProgress: progress,
          });
        }
      }
    }

    // Sort by status (pending first, then others)
    verificationQueue.sort((a, b) => {
      const statusOrder = {
        pending: 1,
        verifying: 2,
        verified: 3,
        "confirmed for dispatch": 4,
      };
      return statusOrder[a.loadingStatus] - statusOrder[b.loadingStatus];
    });

    res.json(verificationQueue);
  } catch (error) {
    console.error("Error fetching verification queue:", error);
    res.status(500).json({ error: "Failed to fetch verification queue" });
  }
});

// Get vehicle status with assigned orders
router.get("/vehicles", async (req, res) => {
  try {
    // ✅ FIXED: Use "order-picked-up" from master status list
    const customers = await Customer.find({
      "shoppingHistory.status": {
        $in: ["assigned-dispatch-officer-2", "order-picked-up"],
      },
    }).lean();

    let vehicleStatus = {};

    for (let customer of customers) {
      for (let order of customer.shoppingHistory) {
        if (
          ["assigned-dispatch-officer-2", "order-picked-up"].includes(
            order.status
          )
        ) {
          const assignmentDetails = order.assignmentDetails;

          if (assignmentDetails && assignmentDetails.assignedVehicle) {
            const vehicleId = assignmentDetails.assignedVehicle.vehicleId;
            const vehicleName = assignmentDetails.assignedVehicle.displayName;
            const vehicleCategory = assignmentDetails.assignedVehicle.category;
            const maxCapacity =
              assignmentDetails.assignedVehicle.specifications?.maxPackages ||
              20;

            if (!vehicleStatus[vehicleId]) {
              vehicleStatus[vehicleId] = {
                vehicleId: vehicleId,
                vehicleName: vehicleName,
                displayName: vehicleName,
                category: vehicleCategory,
                type: vehicleCategory === "scooter" ? "Scooter" : "Truck",
                maxCapacity: maxCapacity,
                assignedOrders: [],
                totalItems: 0,
                loadedItems: 0,
                loadProgress: 0,
                status: "loading",
              };
            }

            // Calculate loading progress for this order
            const totalItems = order.items ? order.items.length : 0;
            const loadedItems = order.items
              ? order.items.filter((item) => item.loadingVerified === true)
                  .length
              : 0;

            vehicleStatus[vehicleId].assignedOrders.push({
              orderId: order.orderId,
              customerName: customer.name,
              totalItems: totalItems,
              loadedItems: loadedItems,
              isFullyLoaded: loadedItems === totalItems && totalItems > 0,
              orderStatus: order.status,
            });

            vehicleStatus[vehicleId].totalItems += totalItems;
            vehicleStatus[vehicleId].loadedItems += loadedItems;
          }
        }
      }
    }

    // Calculate final progress and status for each vehicle
    Object.values(vehicleStatus).forEach((vehicle) => {
      vehicle.loadProgress =
        vehicle.totalItems > 0
          ? Math.round((vehicle.loadedItems / vehicle.totalItems) * 100)
          : 0;

      // Determine vehicle status
      const allOrdersReady = vehicle.assignedOrders.every(
        (order) => order.orderStatus === "order-picked-up"
      );
      if (allOrdersReady && vehicle.assignedOrders.length > 0) {
        vehicle.status = "all orders loaded";
      } else if (vehicle.loadProgress === 100) {
        vehicle.status = "ready for dispatch";
      } else if (vehicle.loadProgress > 0) {
        vehicle.status = "loading";
      } else {
        vehicle.status = "pending";
      }
    });

    res.json(Object.values(vehicleStatus));
  } catch (error) {
    console.error("Error fetching vehicle status:", error);
    res.status(500).json({ error: "Failed to fetch vehicle status" });
  }
});

// Get detailed order for verification
router.get("/order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = customer.shoppingHistory.find((o) => o.orderId === orderId);

    // Initialize loading verification status for items if not exists
    if (order.items) {
      order.items.forEach((item, index) => {
        if (
          item.loadingVerified === undefined ||
          item.loadingVerified === null
        ) {
          item.loadingVerified = false;
        }
        if (!item.loadingNotes) {
          item.loadingNotes = "";
        }
      });
    }

    const orderDetails = {
      orderId: order.orderId,
      customerName: customer.name,
      customerPhone: customer.phoneNumber[0] || "",
      status: order.status,
      deliveryDate: order.deliveryDate,
      timeSlot: order.timeSlot,
      deliveryAddress: order.deliveryAddress,
      specialInstructions: order.adminReason || "",
      items: order.items || [],
      assignmentDetails: order.assignmentDetails || {},
      loadingDetails: order.loadingDetails || {
        verificationStartedAt: null,
        verificationCompletedAt: null,
        verificationStaff: {},
        loadingNotes: "",
        totalItemsLoaded: 0,
        totalItemsRequested: order.items ? order.items.length : 0,
        loadingProgress: 0,
        isReadyForDispatch: false,
      },
    };

    res.json(orderDetails);
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).json({ error: "Failed to fetch order details" });
  }
});

// Start verification process for an order
router.post("/start-verification/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { employeeId, employeeName } = req.body;

    const result = await Customer.updateOne(
      { "shoppingHistory.orderId": orderId },
      {
        $set: {
          "shoppingHistory.$.loadingDetails.verificationStartedAt": new Date(),
          "shoppingHistory.$.loadingDetails.verificationStaff.staffId":
            employeeId,
          "shoppingHistory.$.loadingDetails.verificationStaff.staffName":
            employeeName,
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({
      success: true,
      message: `Loading verification started for order ${orderId}`,
    });
  } catch (error) {
    console.error("Error starting verification:", error);
    res.status(500).json({ error: "Failed to start verification" });
  }
});

// Verify individual item
router.put("/verify-item/:orderId/:itemIndex", async (req, res) => {
  try {
    const { orderId, itemIndex } = req.params;
    const { employeeId, employeeName, verified, notes } = req.body;

    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const orderIndex = customer.shoppingHistory.findIndex(
      (o) => o.orderId === orderId
    );

    if (!customer.shoppingHistory[orderIndex].items[itemIndex]) {
      return res.status(404).json({ error: "Item not found" });
    }

    // Set the verification status
    customer.shoppingHistory[orderIndex].items[itemIndex].loadingVerified =
      Boolean(verified);
    customer.shoppingHistory[orderIndex].items[itemIndex].loadingNotes =
      notes || "";
    customer.shoppingHistory[orderIndex].items[itemIndex].loadingVerifiedAt =
      new Date();
    customer.shoppingHistory[orderIndex].items[itemIndex].loadingVerifiedBy = {
      staffId: employeeId,
      staffName: employeeName,
      timestamp: new Date(),
    };

    await customer.save();

    // Count verified items after save
    const savedCustomer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });
    const savedOrder = savedCustomer.shoppingHistory.find(
      (o) => o.orderId === orderId
    );

    const verifiedItems = savedOrder.items.filter(
      (item) => item.loadingVerified === true
    ).length;
    const totalItems = savedOrder.items.length;

    // Update loading details
    const orderIdx = savedCustomer.shoppingHistory.findIndex(
      (o) => o.orderId === orderId
    );
    if (!savedCustomer.shoppingHistory[orderIdx].loadingDetails) {
      savedCustomer.shoppingHistory[orderIdx].loadingDetails = {};
    }

    savedCustomer.shoppingHistory[orderIdx].loadingDetails.totalItemsLoaded =
      verifiedItems;
    savedCustomer.shoppingHistory[orderIdx].loadingDetails.totalItemsRequested =
      totalItems;
    savedCustomer.shoppingHistory[orderIdx].loadingDetails.loadingProgress =
      Math.round((verifiedItems / totalItems) * 100);

    await savedCustomer.save();

    console.log(
      `✅ Item ${itemIndex} verified. Progress: ${verifiedItems}/${totalItems}`
    );

    res.json({
      success: true,
      message: `Item ${itemIndex} verification updated`,
      verifiedItems,
      totalItems,
      loadingProgress: Math.round((verifiedItems / totalItems) * 100),
    });
  } catch (error) {
    console.error("Error verifying item:", error);
    res.status(500).json({ error: "Failed to verify item" });
  }
});

// Debug route to check verification status
router.get("/debug/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = customer.shoppingHistory.find((o) => o.orderId === orderId);

    const itemsStatus =
      order.items?.map((item, index) => ({
        index: index,
        productName: item.productName,
        loadingVerified: item.loadingVerified,
        loadingVerifiedType: typeof item.loadingVerified,
        loadingVerifiedAt: item.loadingVerifiedAt,
        loadingVerifiedBy: item.loadingVerifiedBy,
        isStrictlyTrue: item.loadingVerified === true,
        isLooselyTrue: Boolean(item.loadingVerified),
      })) || [];

    const strictCount =
      order.items?.filter((item) => item.loadingVerified === true).length || 0;
    const looseCount =
      order.items?.filter((item) => Boolean(item.loadingVerified)).length || 0;
    const totalCount = order.items?.length || 0;

    res.json({
      orderId: orderId,
      orderStatus: order.status,
      totalItems: totalCount,
      verifiedItemsStrict: strictCount,
      verifiedItemsLoose: looseCount,
      allItemsVerifiedStrict: strictCount === totalCount && totalCount > 0,
      allItemsVerifiedLoose: looseCount === totalCount && totalCount > 0,
      itemsStatus: itemsStatus,
      loadingDetails: order.loadingDetails || {},
    });
  } catch (error) {
    console.error("Error fetching debug info:", error);
    res.status(500).json({ error: "Failed to fetch debug info" });
  }
});

// ✅ FIXED: Complete loading for single order
router.post("/complete-loading/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { loadingNotes, employeeId, employeeName } = req.body;

    console.log(`🔄 Completing loading for order: ${orderId}`);

    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const orderIndex = customer.shoppingHistory.findIndex(
      (o) => o.orderId === orderId
    );
    const order = customer.shoppingHistory[orderIndex];

    // Check if all items are verified
    const unverifiedItems = order.items.filter(
      (item) => item.loadingVerified !== true
    );

    if (unverifiedItems.length > 0) {
      console.log(
        `❌ Unverified items found:`,
        unverifiedItems.map((i) => i.productName)
      );
      return res.status(400).json({
        error: "Cannot complete loading. Some items are not verified.",
        details: {
          totalItems: order.items.length,
          verifiedItems: order.items.length - unverifiedItems.length,
          unverifiedItems: unverifiedItems.map((item) => item.productName),
        },
      });
    }

    // ✅ FIXED: Use "order-picked-up" from master status list
    customer.shoppingHistory[orderIndex].status = "order-picked-up";

    // Update loading details
    if (!customer.shoppingHistory[orderIndex].loadingDetails) {
      customer.shoppingHistory[orderIndex].loadingDetails = {};
    }

    customer.shoppingHistory[
      orderIndex
    ].loadingDetails.verificationCompletedAt = new Date();
    customer.shoppingHistory[orderIndex].loadingDetails.loadingNotes =
      loadingNotes || "";
    customer.shoppingHistory[orderIndex].loadingDetails.loadingProgress = 100;
    customer.shoppingHistory[
      orderIndex
    ].loadingDetails.isReadyForDispatch = true;
    customer.shoppingHistory[orderIndex].loadingDetails.verificationStaff = {
      staffId: employeeId,
      staffName: employeeName,
    };

    await customer.save();

    console.log(`✅ Order ${orderId} status updated to "ready-for-driver"`);

    // Update delivery tracking
    const tracking = await DeliveryTracking.findOne({ orderId });
    if (tracking) {
      tracking.workflowStatus.loaded.completed = true;
      tracking.workflowStatus.loaded.completedAt = new Date();
      tracking.workflowStatus.loaded.completedBy = {
        employeeId,
        employeeName,
      };
      tracking.currentStatus = "order-picked-up";
      await tracking.save();

      console.log(`✅ Delivery tracking updated for order ${orderId}`);
    }

    res.json({
      success: true,
      message: `Order ${orderId} loading completed successfully`,
      newStatus: "order-picked-up",
    });
  } catch (error) {
    console.error("❌ Error completing loading:", error);
    res.status(500).json({ error: "Failed to complete loading" });
  }
});

// Complete loading for entire vehicle (all orders in vehicle)
router.post("/complete-vehicle-loading/:vehicleId", async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const { employeeId, employeeName } = req.body;

    // Find all orders assigned to this vehicle
    const customers = await Customer.find({
      "shoppingHistory.assignmentDetails.assignedVehicle.vehicleId": vehicleId,
      "shoppingHistory.status": "assigned-dispatch-officer-2",
    });

    let completedOrders = [];
    let errors = [];

    for (let customer of customers) {
      for (let i = 0; i < customer.shoppingHistory.length; i++) {
        const order = customer.shoppingHistory[i];

        if (
          order.assignmentDetails?.assignedVehicle?.vehicleId === vehicleId &&
          order.status === "assigned-dispatch-officer-2"
        ) {
          // Check if all items are verified
          const allItemsVerified = order.items.every(
            (item) => item.loadingVerified === true
          );

          if (allItemsVerified) {
            // ✅ FIXED: Use "order-picked-up" from master status list
            customer.shoppingHistory[i].status = "order-picked-up";

            if (!customer.shoppingHistory[i].loadingDetails) {
              customer.shoppingHistory[i].loadingDetails = {};
            }
            customer.shoppingHistory[i].loadingDetails.verificationCompletedAt =
              new Date();
            customer.shoppingHistory[i].loadingDetails.loadingProgress = 100;
            customer.shoppingHistory[
              i
            ].loadingDetails.isReadyForDispatch = true;

            await customer.save();

            // Update delivery tracking
            const tracking = await DeliveryTracking.findOne({
              orderId: order.orderId,
            });
            if (tracking) {
              tracking.workflowStatus.loaded.completed = true;
              tracking.workflowStatus.loaded.completedAt = new Date();
              tracking.workflowStatus.loaded.completedBy = {
                employeeId: employeeId,
                employeeName: employeeName,
              };
              tracking.currentStatus = "order-picked-up";
              await tracking.save();
            }

            completedOrders.push(order.orderId);
          } else {
            errors.push(`Order ${order.orderId} has unverified items`);
          }
        }
      }
    }

    if (completedOrders.length === 0) {
      return res.status(400).json({
        error: "No orders were ready for completion",
        details: errors,
      });
    }

    res.json({
      success: true,
      message: `Vehicle loading completed for ${completedOrders.length} orders`,
      completedOrders: completedOrders,
      errors: errors,
    });
  } catch (error) {
    console.error("Error completing vehicle loading:", error);
    res.status(500).json({ error: "Failed to complete vehicle loading" });
  }
});

// Get verification statistics
router.get("/stats", async (req, res) => {
  try {
    // ✅ FIXED: Use "order-picked-up" from master status list
    const customers = await Customer.find({
      "shoppingHistory.status": {
        $in: ["assigned-dispatch-officer-2", "order-picked-up"],
      },
    }).lean();

    let stats = {
      pending: 0,
      verifying: 0,
      readyForDispatch: 0,
      totalVehicles: 0,
    };

    let vehicles = new Set();

    for (let customer of customers) {
      for (let order of customer.shoppingHistory) {
        if (order.status === "assigned-dispatch-officer-2") {
          const totalItems = order.items ? order.items.length : 0;
          const verifiedItems = order.items
            ? order.items.filter((item) => item.loadingVerified === true).length
            : 0;

          if (verifiedItems === 0) {
            stats.pending++;
          } else if (verifiedItems < totalItems) {
            stats.verifying++;
          } else {
            stats.readyForDispatch++;
          }
        } else if (order.status === "order-picked-up") {
          stats.readyForDispatch++;
        }

        // Count unique vehicles
        if (order.assignmentDetails?.assignedVehicle?.vehicleId) {
          vehicles.add(order.assignmentDetails.assignedVehicle.vehicleId);
        }
      }
    }

    stats.totalVehicles = vehicles.size;

    res.json(stats);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

module.exports = router;
