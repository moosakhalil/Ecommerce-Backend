// routes/packingRoutes.js - COMPLETE FIXED
const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");
const Employee = require("../models/Employee");
const DeliveryTracking = require("../models/Deliverytracking");

router.get("/staff", async (req, res) => {
  try {
    const staff = await Employee.find({
      roles: "packing-staff",
      isActivated: true,
      isBlocked: false,
    }).select("employeeId name email phone currentAssignments maxAssignments");

    res.json(Array.isArray(staff) ? staff : [staff]);
  } catch (error) {
    console.error("Error fetching packing staff:", error);
    res.json([]);
  }
});

// ✅ FIXED: Complete packing queue with ALL data
router.get("/queue", async (req, res) => {
  try {
    const customers = await Customer.find({
      "shoppingHistory.status": {
        $in: ["order-confirmed", "picking-order", "allocated-driver"],
      },
    }).lean();

    let packingQueue = [];

    for (let customer of customers) {
      for (let order of customer.shoppingHistory) {
        if (
          ["order-confirmed", "picking-order", "allocated-driver"].includes(
            order.status
          )
        ) {
          let tracking = await DeliveryTracking.findOne({
            orderId: order.orderId,
          });

          if (!tracking) {
            tracking = await DeliveryTracking.createFromCustomerOrder(
              customer,
              order
            );
          }

          const totalAmount = order.totalAmount || 0;
          const priority =
            totalAmount >= 200 ? "high" : totalAmount >= 100 ? "medium" : "low";

          const deliveryTime = new Date(order.deliveryDate || Date.now());
          const packByTime = new Date(
            deliveryTime.getTime() - 2.5 * 60 * 60 * 1000
          );

          const totalItems = order.items ? order.items.length : 0;
          const packedItems = order.items
            ? order.items.filter((item) => item.packingStatus === "packed")
                .length
            : 0;

          packingQueue.push({
            orderId: order.orderId,
            customerName: customer.name || "Unknown",
            customerPhone:
              (customer.phoneNumber && customer.phoneNumber[0]) || "",
            customerEmail: customer.email || "",
            customerId: customer._id?.toString() || "",
            priority: priority,
            deliveryDate: order.deliveryDate,
            packByTime: packByTime,
            isOverdue: new Date() > packByTime,
            status: order.status,
            itemsCount: totalItems,
            packedItemsCount: packedItems,
            packingProgress:
              totalItems > 0 ? Math.round((packedItems / totalItems) * 100) : 0,
            // ✅ COMPLETE DELIVERY ADDRESS
            deliveryAddress: {
              nickname: order.deliveryAddress?.nickname || "",
              area: order.deliveryAddress?.area || "",
              fullAddress: order.deliveryAddress?.fullAddress || "",
              googleMapLink: order.deliveryAddress?.googleMapLink || "",
            },
            // ✅ COMPLETE ORDER DETAILS
            specialInstructions: order.adminReason || "",
            timeSlot: order.timeSlot || "",
            totalAmount: totalAmount,
            deliveryCharge: order.deliveryCharge || 0,
            finalAmount: totalAmount + (order.deliveryCharge || 0),
            paymentStatus: order.paymentStatus || "pending",
            paymentMethod: order.paymentMethod || "",
            // ✅ COMPLETE PACKING DETAILS
            packingDetails: order.packingDetails || {},
          });
        }
      }
    }

    packingQueue.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const priorityDiff =
        priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return new Date(a.packByTime) - new Date(b.packByTime);
    });

    res.json(packingQueue);
  } catch (error) {
    console.error("Error fetching packing queue:", error);
    res.status(500).json({ error: "Failed to fetch packing queue" });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const customers = await Customer.find({
      "shoppingHistory.status": {
        $in: ["order-confirmed", "picking-order", "allocated-driver"],
      },
    }).lean();

    let stats = {
      pending: 0,
      packing: 0,
      completed: 0,
    };

    for (let customer of customers) {
      for (let order of customer.shoppingHistory) {
        if (order.status === "order-confirmed") {
          stats.pending++;
        } else if (order.status === "picking-order") {
          stats.packing++;
        } else if (order.status === "allocated-driver") {
          stats.completed++;
        }
      }
    }

    res.json(stats);
  } catch (error) {
    console.error("Error fetching packing stats:", error);
    res.status(500).json({ error: "Failed to fetch packing stats" });
  }
});

// ✅ FIXED: Complete order details with ALL customer and item data
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

    // Ensure all items have proper structure
    if (order.items) {
      order.items.forEach((item, index) => {
        if (!item.packingStatus) {
          item.packingStatus = "pending";
        }
        if (!item.itemComplaints) {
          item.itemComplaints = [];
        }
      });
    }

    const orderDetails = {
      // ✅ ORDER IDENTIFICATION
      orderId: order.orderId,
      customerId: customer._id?.toString() || "",

      // ✅ CUSTOMER INFORMATION
      customerName: customer.name || "Unknown",
      customerPhone: (customer.phoneNumber && customer.phoneNumber[0]) || "",
      customerEmail: customer.email || "",

      // ✅ DELIVERY ADDRESS - COMPLETE
      deliveryAddress: {
        nickname: order.deliveryAddress?.nickname || "",
        area: order.deliveryAddress?.area || "",
        fullAddress: order.deliveryAddress?.fullAddress || "",
        googleMapLink: order.deliveryAddress?.googleMapLink || "",
      },

      // ✅ ORDER STATUS & TIMING
      status: order.status,
      deliveryDate: order.deliveryDate,
      timeSlot: order.timeSlot || "",

      // ✅ ORDER AMOUNTS
      totalAmount: order.totalAmount || 0,
      deliveryCharge: order.deliveryCharge || 0,
      finalAmount: (order.totalAmount || 0) + (order.deliveryCharge || 0),

      // ✅ SPECIAL INSTRUCTIONS
      specialInstructions: order.adminReason || "",

      // ✅ ITEMS WITH COMPLETE STRUCTURE
      items: (order.items || []).map((item, index) => ({
        itemIndex: index,
        productName: item.productName || "Unknown Product",
        quantity: item.quantity || 1,
        weight: item.weight || "N/A",
        packingStatus: item.packingStatus || "pending",
        packedAt: item.packedAt || null,
        packedBy: item.packedBy || {},
        itemComplaints: item.itemComplaints || [],
        totalPrice: item.totalPrice || 0,
      })),

      // ✅ PACKING DETAILS
      packingDetails: {
        packingStartedAt: order.packingDetails?.packingStartedAt || null,
        packingCompletedAt: order.packingDetails?.packingCompletedAt || null,
        packingStaff: order.packingDetails?.packingStaff || {},
        packingNotes: order.packingDetails?.packingNotes || "",
        totalItemsPacked: order.packingDetails?.totalItemsPacked || 0,
        totalItemsRequested: order.items ? order.items.length : 0,
        packingProgress: order.packingDetails?.packingProgress || 0,
        hasPackingComplaints:
          order.packingDetails?.hasPackingComplaints || false,
      },

      // ✅ PAYMENT INFORMATION
      paymentStatus: order.paymentStatus || "pending",
      paymentMethod: order.paymentMethod || "",
      accountHolderName: order.accountHolderName || "",
      paidBankName: order.paidBankName || "",
      transactionId: order.transactionId || "",

      // ✅ DELIVERY TYPE & SPEED
      deliveryType: order.deliveryType || "truck",
      deliverySpeed: order.deliverySpeed || "normal",
    };

    res.json(orderDetails);
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).json({ error: "Failed to fetch order details" });
  }
});

router.post("/start/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { employeeId, employeeName } = req.body;

    const employee = await Employee.findOne({ employeeId: employeeId });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const result = await Customer.updateOne(
      { "shoppingHistory.orderId": orderId },
      {
        $set: {
          "shoppingHistory.$.status": "picking-order",
          "shoppingHistory.$.packingDetails.packingStartedAt": new Date(),
          "shoppingHistory.$.packingDetails.packingStaff.staffId": employeeId,
          "shoppingHistory.$.packingDetails.packingStaff.staffName":
            employeeName,
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    await Employee.updateOne(
      { employeeId: employeeId },
      {
        $inc: { currentAssignments: 1 },
        $push: {
          assignedOrders: {
            orderId: orderId,
            status: "in-progress",
            assignedAt: new Date(),
          },
        },
      }
    );

    const tracking = await DeliveryTracking.findOne({ orderId: orderId });
    if (tracking) {
      tracking.workflowStatus.pending.completed = true;
      tracking.workflowStatus.pending.completedAt = new Date();
      tracking.workflowStatus.pending.completedBy = {
        employeeId: employeeId,
        employeeName: employeeName,
      };
      await tracking.save();
    }

    res.json({
      success: true,
      message: `Packing started for order ${orderId}`,
      newStatus: "picking-order",
    });
  } catch (error) {
    console.error("Error starting packing:", error);
    res.status(500).json({ error: "Failed to start packing" });
  }
});

router.put("/item/:orderId/:itemIndex", async (req, res) => {
  try {
    const { orderId, itemIndex } = req.params;
    const { employeeId, employeeName } = req.body;

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

    if (!order.items[itemIndex]) {
      return res.status(404).json({ error: "Item not found" });
    }

    order.items[itemIndex].packingStatus = "packed";
    order.items[itemIndex].packedAt = new Date();
    order.items[itemIndex].packedBy = {
      staffId: employeeId,
      staffName: employeeName,
      timestamp: new Date(),
    };

    const packedItems = order.items.filter(
      (item) => item.packingStatus === "packed"
    ).length;
    const totalItems = order.items.length;

    order.packingDetails = order.packingDetails || {};
    order.packingDetails.totalItemsPacked = packedItems;
    order.packingDetails.totalItemsRequested = totalItems;
    order.packingDetails.packingProgress = Math.round(
      (packedItems / totalItems) * 100
    );

    await customer.save();

    res.json({
      success: true,
      message: `Item ${itemIndex} marked as packed`,
      packedItems: packedItems,
      totalItems: totalItems,
      packingProgress: Math.round((packedItems / totalItems) * 100),
    });
  } catch (error) {
    console.error("Error marking item as packed:", error);
    res.status(500).json({ error: "Failed to mark item as packed" });
  }
});

router.post("/complaint/:orderId/:itemIndex", async (req, res) => {
  try {
    const { orderId, itemIndex } = req.params;
    const { complaintType, complaintDetails, employeeId, employeeName } =
      req.body;

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

    if (!order.items[itemIndex]) {
      return res.status(404).json({ error: "Item not found" });
    }

    const complaintId = `ITEM_COMP_${Date.now()}`;

    if (!order.items[itemIndex].itemComplaints) {
      order.items[itemIndex].itemComplaints = [];
    }

    order.items[itemIndex].itemComplaints.push({
      complaintId: complaintId,
      complaintType: complaintType,
      complaintDetails: complaintDetails,
      reportedBy: {
        staffId: employeeId,
        staffName: employeeName,
        timestamp: new Date(),
      },
      status: "open",
    });

    if (
      ["not_available", "damaged", "expired", "insufficient_stock"].includes(
        complaintType
      )
    ) {
      order.items[itemIndex].packingStatus = "unavailable";
    }

    order.packingDetails = order.packingDetails || {};
    order.packingDetails.hasPackingComplaints = true;

    await customer.save();

    res.json({
      success: true,
      message: "Complaint added successfully",
      complaintId: complaintId,
    });
  } catch (error) {
    console.error("Error adding complaint:", error);
    res.status(500).json({ error: "Failed to add complaint" });
  }
});

router.post("/complete/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { packingNotes, employeeId, employeeName } = req.body;

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

    const allItemsHandled = order.items.every(
      (item) =>
        item.packingStatus === "packed" || item.packingStatus === "unavailable"
    );

    if (!allItemsHandled) {
      return res.status(400).json({
        error: "Cannot complete packing. Some items are still pending.",
      });
    }

    order.status = "allocated-driver";
    order.packingDetails = order.packingDetails || {};
    order.packingDetails.packingCompletedAt = new Date();
    order.packingDetails.packingNotes = packingNotes;
    order.packingDetails.packingProgress = 100;

    await customer.save();

    await Employee.updateOne(
      { employeeId: employeeId },
      {
        $inc: { currentAssignments: -1 },
        $pull: {
          assignedOrders: { orderId: orderId },
        },
        $push: {
          packingHistory: {
            orderId: orderId,
            customerId: customer._id,
            customerName: customer.name,
            startedAt: order.packingDetails.packingStartedAt,
            completedAt: new Date(),
            totalItems: order.items ? order.items.length : 0,
            packedItems: order.items
              ? order.items.filter((item) => item.packingStatus === "packed")
                  .length
              : 0,
            status: "completed",
            notes: packingNotes,
            complaints: order.items
              ? order.items.reduce(
                  (count, item) =>
                    count +
                    (item.itemComplaints ? item.itemComplaints.length : 0),
                  0
                )
              : 0,
          },
        },
      }
    );

    const tracking = await DeliveryTracking.findOne({ orderId: orderId });
    if (tracking) {
      tracking.workflowStatus.packed.completed = true;
      tracking.workflowStatus.packed.completedAt = new Date();
      tracking.workflowStatus.packed.completedBy = {
        employeeId: employeeId,
        employeeName: employeeName,
      };
      tracking.workflowStatus.packed.packingNotes = packingNotes;
      tracking.currentStatus = "allocated-driver";
      await tracking.save();
    }

    res.json({
      success: true,
      message: `Order ${orderId} packing completed successfully`,
      newStatus: "allocated-driver",
    });
  } catch (error) {
    console.error("Error completing packing:", error);
    res.status(500).json({ error: "Failed to complete packing" });
  }
});

router.get("/complaints/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = customer.shoppingHistory.find((o) => o.orderId === orderId);
    let complaints = [];

    order.items.forEach((item, index) => {
      if (item.itemComplaints && item.itemComplaints.length > 0) {
        item.itemComplaints.forEach((complaint) => {
          complaints.push({
            itemIndex: index,
            itemName: item.productName,
            ...complaint,
          });
        });
      }
    });

    res.json(complaints);
  } catch (error) {
    console.error("Error fetching complaints:", error);
    res.status(500).json({ error: "Failed to fetch complaints" });
  }
});

module.exports = router;
