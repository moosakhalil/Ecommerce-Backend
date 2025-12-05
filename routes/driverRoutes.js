// routes/driverRoutes.js - Fixed Driver routes using order-picked-up status
const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");
const DeliveryTracking = require("../models/Deliverytracking");

// ✅ FIXED: Get available vehicles for driver selection using DeliveryTracking
router.get("/vehicles", async (req, res) => {
  try {
    console.log(
      "🚛 Driver: Fetching vehicles from DeliveryTracking with 'order-picked-up' status..."
    );

    // ✅ FIXED: Use "order-picked-up" from master status list
    const trackingRecords = await DeliveryTracking.find({
      currentStatus: "order-picked-up",
      isActive: true,
    }).lean();

    console.log(
      `📊 Found ${trackingRecords.length} orders in DeliveryTracking with 'order-picked-up' status`
    );

    let vehicleData = {};
    let totalOrdersFound = 0;

    for (let tracking of trackingRecords) {
      try {
        // Get the customer and order details
        const customer = await Customer.findById(tracking.customerId);
        if (!customer) {
          console.log(`⚠️ Customer not found for tracking ${tracking.orderId}`);
          continue;
        }

        const order = customer.shoppingHistory.find(
          (o) => o.orderId === tracking.orderId
        );
        if (!order) {
          console.log(
            `⚠️ Order ${tracking.orderId} not found in customer ${customer.name}`
          );
          continue;
        }

        totalOrdersFound++;
        console.log(
          `📦 Processing order ${order.orderId} for customer ${customer.name}`
        );

        const assignmentDetails = order.assignmentDetails;

        if (assignmentDetails && assignmentDetails.assignedVehicle) {
          const vehicleId = assignmentDetails.assignedVehicle.vehicleId;
          const vehicleName = assignmentDetails.assignedVehicle.displayName;
          const vehicleCategory = assignmentDetails.assignedVehicle.category;
          const maxCapacity =
            assignmentDetails.assignedVehicle.specifications?.maxPackages || 20;

          console.log(
            `🚛 Order ${order.orderId} assigned to vehicle: ${vehicleName} (${vehicleId})`
          );

          if (!vehicleData[vehicleId]) {
            vehicleData[vehicleId] = {
              vehicleId: vehicleId,
              vehicleName: vehicleName,
              displayName: vehicleName,
              category: vehicleCategory,
              type: vehicleCategory === "scooter" ? "scooter" : "truck",
              maxCapacity: maxCapacity,
              assignedOrders: [],
              totalItems: 0,
              driverInfo: assignmentDetails.assignedDriver,
              status: "loaded",
            };
          }

          // Calculate items for this order
          const totalItems = order.items ? order.items.length : 0;

          vehicleData[vehicleId].assignedOrders.push({
            orderId: order.orderId,
            customerName: customer.name,
            customerPhone: customer.phoneNumber[0] || "",
            deliveryDate: order.deliveryDate,
            timeSlot: order.timeSlot || "",
            deliveryAddress: order.deliveryAddress,
            totalItems: totalItems,
            orderStatus: order.status,
            trackingStatus: tracking.currentStatus,
            specialInstructions: order.adminReason || "",
          });

          vehicleData[vehicleId].totalItems += totalItems;
        } else {
          console.log(
            `⚠️ Order ${order.orderId} has no vehicle assignment details`
          );
        }
      } catch (error) {
        console.error(
          `❌ Error processing tracking record ${tracking.orderId}:`,
          error
        );
      }
    }

    // Calculate load progress for each vehicle
    Object.values(vehicleData).forEach((vehicle) => {
      vehicle.loadProgress =
        vehicle.maxCapacity > 0
          ? Math.round((vehicle.totalItems / vehicle.maxCapacity) * 100)
          : 0;

      // Ensure progress doesn't exceed 100%
      if (vehicle.loadProgress > 100) vehicle.loadProgress = 100;
    });

    const vehicleArray = Object.values(vehicleData);

    console.log(
      `✅ Driver: Returning ${vehicleArray.length} vehicles with ${totalOrdersFound} total orders`
    );
    console.log(
      "🚛 Vehicles summary:",
      vehicleArray.map((v) => ({
        id: v.vehicleId,
        name: v.displayName,
        orders: v.assignedOrders.length,
        totalItems: v.totalItems,
      }))
    );

    res.json(vehicleArray);
  } catch (error) {
    console.error("❌ Error fetching vehicles:", error);
    res.status(500).json({ error: "Failed to fetch vehicles" });
  }
});

// ✅ FIXED: Get orders for a specific vehicle using DeliveryTracking
router.get("/vehicle/:vehicleId/orders", async (req, res) => {
  try {
    const { vehicleId } = req.params;

    console.log(`\n📦 Driver: Fetching orders for vehicle ${vehicleId}`);
    console.log(`📦 Requested Vehicle ID Type: ${typeof vehicleId}`);

    // ✅ FIXED: Use "order-picked-up" from master status list
    const trackingRecords = await DeliveryTracking.find({
      currentStatus: "order-picked-up",
      isActive: true,
    }).lean();

    console.log(
      `📊 Found ${trackingRecords.length} tracking records with 'order-picked-up' status`
    );

    let orders = [];
    let debugInfo = [];

    for (let tracking of trackingRecords) {
      try {
        // Get customer and order details
        const customer = await Customer.findById(tracking.customerId);
        if (!customer) {
          console.log(`❌ Customer not found for tracking ${tracking.orderId}`);
          continue;
        }

        const order = customer.shoppingHistory.find(
          (o) => o.orderId === tracking.orderId
        );
        if (!order) {
          console.log(
            `❌ Order ${tracking.orderId} not found in customer ${customer.name}`
          );
          continue;
        }

        // CRITICAL: Get the vehicle assignment details
        const assignedVehicleId =
          order.assignmentDetails?.assignedVehicle?.vehicleId;

        console.log(`\n🔍 Checking Order ${order.orderId}:`);
        console.log(`   - Customer Order Status: ${order.status}`);
        console.log(`   - DeliveryTracking Status: ${tracking.currentStatus}`);
        console.log(
          `   - Has Assignment Details: ${!!order.assignmentDetails}`
        );
        console.log(
          `   - Has Assigned Vehicle: ${!!order.assignmentDetails
            ?.assignedVehicle}`
        );
        console.log(`   - Assigned Vehicle ID: ${assignedVehicleId}`);
        console.log(
          `   - Assigned Vehicle ID Type: ${typeof assignedVehicleId}`
        );
        console.log(`   - Requested Vehicle ID: ${vehicleId}`);
        console.log(`   - Requested Vehicle ID Type: ${typeof vehicleId}`);

        // Store debug info
        debugInfo.push({
          orderId: order.orderId,
          customerOrderStatus: order.status,
          trackingStatus: tracking.currentStatus,
          hasAssignment: !!order.assignmentDetails,
          hasVehicle: !!order.assignmentDetails?.assignedVehicle,
          assignedVehicleId,
          assignedVehicleIdType: typeof assignedVehicleId,
          requestedVehicleId: vehicleId,
          requestedVehicleIdType: typeof vehicleId,
        });

        if (!order.assignmentDetails?.assignedVehicle) {
          console.log(`❌ Order ${order.orderId} has no vehicle assignment`);
          continue;
        }

        // FLEXIBLE VEHICLE ID MATCHING - Convert both to strings for comparison
        const assignedVehicleIdStr = String(assignedVehicleId);
        const requestedVehicleIdStr = String(vehicleId);

        // Also try ObjectId toString() method if it exists
        const assignedVehicleIdObjStr = assignedVehicleId?.toString
          ? assignedVehicleId.toString()
          : assignedVehicleIdStr;

        const strictMatch = assignedVehicleId === vehicleId;
        const stringMatch = assignedVehicleIdStr === requestedVehicleIdStr;
        const objectIdMatch = assignedVehicleIdObjStr === requestedVehicleIdStr;

        console.log(`   - Strict Match (===): ${strictMatch}`);
        console.log(`   - String Match: ${stringMatch}`);
        console.log(`   - ObjectId Match: ${objectIdMatch}`);
        console.log(`   - Assigned as String: "${assignedVehicleIdStr}"`);
        console.log(`   - Requested as String: "${requestedVehicleIdStr}"`);
        console.log(`   - ObjectId toString: "${assignedVehicleIdObjStr}"`);

        // Update debug info with match results
        debugInfo[debugInfo.length - 1] = {
          ...debugInfo[debugInfo.length - 1],
          strictMatch,
          stringMatch,
          objectIdMatch,
          assignedVehicleIdStr,
          requestedVehicleIdStr,
          assignedVehicleIdObjStr,
        };

        // Use the most flexible matching - if any method matches, include the order
        if (stringMatch || objectIdMatch || strictMatch) {
          console.log(
            `✅ MATCH FOUND! Adding order ${order.orderId} to vehicle ${vehicleId}`
          );

          orders.push({
            orderId: order.orderId,
            customerName: customer.name,
            customerPhone: customer.phoneNumber[0] || "",
            deliveryDate: order.deliveryDate,
            timeSlot: order.timeSlot || "",
            deliveryAddress: order.deliveryAddress,
            items: order.items || [],
            totalItems: order.items ? order.items.length : 0,
            specialInstructions: order.adminReason || "",
            assignmentDetails: order.assignmentDetails,
            isVerified: order.driverVerification?.verified || false,
            trackingStatus: tracking.currentStatus,
            orderStatus: order.status,
          });
        } else {
          console.log(
            `❌ NO MATCH for order ${order.orderId} - Vehicle ID mismatch`
          );
          console.log(
            `   - This order is assigned to vehicle: ${assignedVehicleIdStr}`
          );
          console.log(
            `   - But requested vehicle is: ${requestedVehicleIdStr}`
          );
        }
      } catch (error) {
        console.error(`❌ Error processing order ${tracking.orderId}:`, error);
      }
    }

    // Sort by delivery time
    orders.sort((a, b) => new Date(a.deliveryDate) - new Date(b.deliveryDate));

    console.log(
      `\n✅ Driver: Returning ${orders.length} orders for vehicle ${vehicleId}`
    );
    console.log(`📊 DEBUG INFO:`, debugInfo);

    res.json(orders);
  } catch (error) {
    console.error("❌ Error fetching vehicle orders:", error);
    res.status(500).json({ error: "Failed to fetch vehicle orders" });
  }
});

// DEBUG ROUTE: Get all tracking records and their statuses
router.get("/debug-tracking", async (req, res) => {
  try {
    // ✅ FIXED: Use "order-picked-up" from master status list
    const trackingRecords = await DeliveryTracking.find({
      currentStatus: {
        $in: ["order-picked-up", "on-way", "order-complete"],
      },
      isActive: true,
    }).lean();

    console.log(`🔍 Found ${trackingRecords.length} relevant tracking records`);

    let debugInfo = [];

    for (let tracking of trackingRecords) {
      try {
        const customer = await Customer.findById(tracking.customerId);
        const order = customer?.shoppingHistory.find(
          (o) => o.orderId === tracking.orderId
        );

        debugInfo.push({
          orderId: tracking.orderId,
          trackingStatus: tracking.currentStatus,
          customerName: customer?.name || "Unknown",
          orderStatus: order?.status || "Unknown",
          hasAssignment: !!order?.assignmentDetails,
          hasVehicle: !!order?.assignmentDetails?.assignedVehicle,
          vehicleId: order?.assignmentDetails?.assignedVehicle?.vehicleId,
          vehicleName: order?.assignmentDetails?.assignedVehicle?.displayName,
          workflowProgress: tracking.workflowStatus,
        });
      } catch (error) {
        debugInfo.push({
          orderId: tracking.orderId,
          trackingStatus: tracking.currentStatus,
          error: error.message,
        });
      }
    }

    res.json({
      totalTracking: debugInfo.length,
      orderPickedUpCount: debugInfo.filter(
        (o) => o.trackingStatus === "order-picked-up"
      ).length,
      onWayCount: debugInfo.filter((o) => o.trackingStatus === "on-way").length,
      orderCompleteCount: debugInfo.filter(
        (o) => o.trackingStatus === "order-complete"
      ).length,
      orders: debugInfo,
    });
  } catch (error) {
    console.error("Error in debug tracking route:", error);
    res.status(500).json({ error: "Debug tracking failed" });
  }
});

// Verify order by driver
router.post("/verify-order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { driverId, driverName, verified, notes } = req.body;

    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const orderIndex = customer.shoppingHistory.findIndex(
      (o) => o.orderId === orderId
    );

    // Add driver verification details
    if (!customer.shoppingHistory[orderIndex].driverVerification) {
      customer.shoppingHistory[orderIndex].driverVerification = {};
    }

    customer.shoppingHistory[orderIndex].driverVerification = {
      verified: Boolean(verified),
      verifiedAt: new Date(),
      verifiedBy: {
        driverId: driverId,
        driverName: driverName,
      },
      notes: notes || "",
    };

    await customer.save();

    console.log(`✅ Driver verified order ${orderId}: ${verified}`);

    res.json({
      success: true,
      message: `Order ${orderId} verification updated`,
      verified: Boolean(verified),
    });
  } catch (error) {
    console.error("Error verifying order:", error);
    res.status(500).json({ error: "Failed to verify order" });
  }
});

// ✅ SIMPLE: Start route - NO verification check, just change status
router.post("/start-route/:vehicleId", async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const { driverId, driverName } = req.body;

    console.log(`🚀 Driver: Starting route for vehicle ${vehicleId}`);

    // Find all tracking records with "order-picked-up" status
    const trackingRecords = await DeliveryTracking.find({
      currentStatus: "order-picked-up",
      isActive: true,
    });

    console.log(
      `📊 Found ${trackingRecords.length} tracking records with 'order-picked-up' status`
    );

    let updatedOrders = [];
    let errors = [];

    for (let tracking of trackingRecords) {
      try {
        const customer = await Customer.findById(tracking.customerId);
        if (!customer) continue;

        const orderIndex = customer.shoppingHistory.findIndex(
          (o) => o.orderId === tracking.orderId
        );
        if (orderIndex === -1) continue;

        const order = customer.shoppingHistory[orderIndex];

        // Check vehicle assignment
        const assignedVehicleId =
          order.assignmentDetails?.assignedVehicle?.vehicleId;
        const vehicleIdMatches =
          String(assignedVehicleId) === String(vehicleId) ||
          assignedVehicleId?.toString() === vehicleId;

        if (vehicleIdMatches) {
          console.log(`✅ Updating order ${order.orderId} to 'on-way'`);

          // ✅ SIMPLE: Just change the status - NO verification check
          customer.shoppingHistory[orderIndex].status = "on-way";
          customer.shoppingHistory[orderIndex].routeStartedAt = new Date();
          customer.shoppingHistory[orderIndex].routeStartedBy = {
            driverId: driverId,
            driverName: driverName,
          };

          await customer.save();
          console.log(`✅ Updated customer order ${order.orderId} to 'on-way'`);

          // Update DeliveryTracking
          tracking.workflowStatus.inTransit.completed = true;
          tracking.workflowStatus.inTransit.completedAt = new Date();
          tracking.workflowStatus.inTransit.startedBy = {
            employeeId: driverId,
            employeeName: driverName,
          };
          tracking.currentStatus = "on-way";
          tracking.timingMetrics.dispatchedAt = new Date();

          await tracking.save();
          console.log(
            `✅ Updated delivery tracking ${order.orderId} to 'on-way'`
          );

          updatedOrders.push(order.orderId);
        }
      } catch (error) {
        console.error(`❌ Error processing order ${tracking.orderId}:`, error);
        errors.push(
          `Error processing order ${tracking.orderId}: ${error.message}`
        );
      }
    }

    if (updatedOrders.length === 0) {
      console.log(`❌ No orders found for vehicle ${vehicleId}`);
      return res.status(400).json({
        error: "No orders were found for this vehicle",
        details: errors,
      });
    }

    console.log(
      `🎉 Successfully started route for ${updatedOrders.length} orders`
    );

    res.json({
      success: true,
      message: `Route started for vehicle ${vehicleId}`,
      ordersOnRoute: updatedOrders,
      totalOrders: updatedOrders.length,
    });
  } catch (error) {
    console.error("Error starting route:", error);
    res.status(500).json({ error: "Failed to start route" });
  }
});
// Debug route for verification
router.get("/debug-verification/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = customer.shoppingHistory.find((o) => o.orderId === orderId);

    res.json({
      orderId: orderId,
      orderStatus: order.status,
      hasDriverVerification: !!order.driverVerification,
      driverVerification: order.driverVerification,
      driverVerified: order.driverVerification?.verified,
      driverVerifiedType: typeof order.driverVerification?.verified,
      driverVerifiedStrictly: order.driverVerification?.verified === true,
      assignmentDetails: order.assignmentDetails,
      vehicleId: order.assignmentDetails?.assignedVehicle?.vehicleId,
    });
  } catch (error) {
    console.error("Error in debug verification:", error);
    res.status(500).json({ error: "Debug failed" });
  }
});

// Debug route for start-route
router.get("/debug-start-route/:vehicleId", async (req, res) => {
  try {
    const { vehicleId } = req.params;

    console.log(
      `🔍 DEBUG: Checking start-route readiness for vehicle ${vehicleId}`
    );

    // ✅ FIXED: Use "order-picked-up" from master status list
    const trackingRecords = await DeliveryTracking.find({
      currentStatus: "order-picked-up",
      isActive: true,
    });

    let debugData = [];

    for (let tracking of trackingRecords) {
      const customer = await Customer.findById(tracking.customerId);
      if (!customer) continue;

      const order = customer.shoppingHistory.find(
        (o) => o.orderId === tracking.orderId
      );
      if (!order) continue;

      const assignedVehicleId =
        order.assignmentDetails?.assignedVehicle?.vehicleId;
      const vehicleMatches = String(assignedVehicleId) === String(vehicleId);

      debugData.push({
        orderId: order.orderId,
        orderStatus: order.status,
        trackingStatus: tracking.currentStatus,
        assignedVehicleId: String(assignedVehicleId),
        requestedVehicleId: String(vehicleId),
        vehicleMatches,
        hasDriverVerification: !!order.driverVerification,
        driverVerified: order.driverVerification?.verified,
        driverVerifiedType: typeof order.driverVerification?.verified,
        driverVerifiedStrictly: order.driverVerification?.verified === true,
        isReadyForRoute:
          vehicleMatches && order.driverVerification?.verified === true,
        fullDriverVerification: order.driverVerification,
      });
    }

    res.json({
      vehicleId,
      totalTrackingRecords: trackingRecords.length,
      ordersChecked: debugData.length,
      ordersReadyForRoute: debugData.filter((o) => o.isReadyForRoute).length,
      debugData,
    });
  } catch (error) {
    console.error("Error in debug start-route:", error);
    res.status(500).json({ error: "Debug failed" });
  }
});

// Get driver statistics using DeliveryTracking
router.get("/stats", async (req, res) => {
  try {
    // ✅ FIXED: Use "order-picked-up" and "on-way" from master status list
    const trackingRecords = await DeliveryTracking.find({
      currentStatus: { $in: ["order-picked-up", "on-way"] },
      isActive: true,
    }).lean();

    let stats = {
      readyForPickup: 0,
      onRoute: 0,
      totalVehicles: 0,
    };

    let vehicles = new Set();

    for (let tracking of trackingRecords) {
      if (tracking.currentStatus === "order-picked-up") {
        stats.readyForPickup++;
      } else if (tracking.currentStatus === "on-way") {
        stats.onRoute++;
      }

      // Get vehicle info from customer data
      try {
        const customer = await Customer.findById(tracking.customerId);
        const order = customer?.shoppingHistory.find(
          (o) => o.orderId === tracking.orderId
        );

        if (order?.assignmentDetails?.assignedVehicle?.vehicleId) {
          vehicles.add(order.assignmentDetails.assignedVehicle.vehicleId);
        }
      } catch (error) {
        console.error(
          `Error getting vehicle info for ${tracking.orderId}:`,
          error
        );
      }
    }

    stats.totalVehicles = vehicles.size;

    console.log("📊 Driver stats from DeliveryTracking:", stats);

    res.json(stats);
  } catch (error) {
    console.error("Error fetching driver stats:", error);
    res.status(500).json({ error: "Failed to fetch driver stats" });
  }
});

module.exports = router;
