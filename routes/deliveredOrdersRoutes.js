// routes/deliveredOrdersRoutes.js - Delivered Orders Dashboard routes
const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");
const DeliveryTracking = require("../models/Deliverytracking");

// Get all delivered/completed orders
router.get("/delivered-orders", async (req, res) => {
  try {
    const { statuses, dateFilter } = req.query;

    // ✅ Only show order-complete and order-processed orders
    const deliveredStatuses = statuses
      ? statuses.split(",")
      : ["order-complete", "order-processed"];

    // Build date filter
    let dateQuery = {};
    if (dateFilter && dateFilter !== "all") {
      const now = new Date();
      let startDate;

      switch (dateFilter) {
        case "today":
          startDate = new Date(now.setHours(0, 0, 0, 0));
          dateQuery = { $gte: startDate };
          break;
        case "yesterday":
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          startDate = new Date(yesterday.setHours(0, 0, 0, 0));
          const endDate = new Date(yesterday.setHours(23, 59, 59, 999));
          dateQuery = { $gte: startDate, $lte: endDate };
          break;
        case "week":
          startDate = new Date(now);
          startDate.setDate(startDate.getDate() - 7);
          dateQuery = { $gte: startDate };
          break;
        case "month":
          startDate = new Date(now);
          startDate.setMonth(startDate.getMonth() - 1);
          dateQuery = { $gte: startDate };
          break;
      }
    }

    // Find customers with delivered orders
    const customers = await Customer.find({
      "shoppingHistory.status": { $in: deliveredStatuses },
    });

    let deliveredOrders = [];

    for (let customer of customers) {
      for (let order of customer.shoppingHistory) {
        // Only include delivered/completed orders
        if (deliveredStatuses.includes(order.status)) {
          // Apply date filter if specified
          if (dateFilter && dateFilter !== "all") {
            const orderDate = new Date(
              order.deliveredAt || order.completedAt || order.orderDate
            );
            if (dateQuery.$gte && orderDate < dateQuery.$gte) continue;
            if (dateQuery.$lte && orderDate > dateQuery.$lte) continue;
          }

          // Get delivery tracking info
          let tracking = await DeliveryTracking.findOne({
            orderId: order.orderId,
          });

          // Get driver info
          let driverName = "N/A";
          if (order.driver1?.name) driverName = order.driver1.name;
          else if (order.driver2?.name) driverName = order.driver2.name;
          else if (tracking?.currentDriver?.driverName)
            driverName = tracking.currentDriver.driverName;

          // Get delivery details
          const deliveredAt =
            order.deliveredAt || order.completedAt || order.orderDate;
          const totalAmount = order.totalAmount || 0;

          // Get area
          const area =
            order.deliveryAddress?.area ||
            order.area ||
            order.location ||
            "Unknown Area";

          deliveredOrders.push({
            orderId: order.orderId,
            customerName: customer.name,
            customerPhone: customer.phoneNumber[0] || "",
            customerEmail: customer.email || "",
            area: area,
            fullAddress:
              order.deliveryAddress?.fullAddress ||
              order.address ||
              "Address not provided",
            addressNickname: order.deliveryAddress?.nickname || "",
            googleMapLink:
              order.deliveryAddress?.googleMapLink || order.googleMapLink || "",
            totalAmount: totalAmount,
            itemsCount: order.items ? order.items.length : 0,
            items: order.items || [],
            status: order.status,
            deliveredAt: deliveredAt,
            driverName: driverName,
            paymentMethod: order.paymentMethod || "Cash on Delivery",
            deliveryNotes: order.deliveryNotes || "",
            specialInstructions: order.adminReason || "",
            timeline: tracking?.statusHistory || [],
          });
        }
      }
    }

    // Sort by delivered date (most recent first)
    deliveredOrders.sort((a, b) => {
      return new Date(b.deliveredAt) - new Date(a.deliveredAt);
    });

    res.json(deliveredOrders);
  } catch (error) {
    console.error("Error fetching delivered orders:", error);
    res.status(500).json({ error: "Failed to fetch delivered orders" });
  }
});

// Get delivered orders statistics
router.get("/delivered-stats", async (req, res) => {
  try {
    const deliveredStatuses = ["order-complete", "order-processed"];

    const customers = await Customer.find({
      "shoppingHistory.status": { $in: deliveredStatuses },
    }).lean();

    let stats = {
      totalDelivered: 0,
      todayDelivered: 0,
      totalRevenue: 0,
      averageDeliveryTime: "N/A",
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let totalDeliveryTime = 0;
    let deliveryTimeCount = 0;

    for (let customer of customers) {
      for (let order of customer.shoppingHistory) {
        if (deliveredStatuses.includes(order.status)) {
          stats.totalDelivered++;
          stats.totalRevenue += order.totalAmount || 0;

          // Check if delivered today
          const deliveredAt = new Date(
            order.deliveredAt || order.completedAt || order.orderDate
          );
          if (deliveredAt >= today) {
            stats.todayDelivered++;
          }

          // Calculate delivery time if available
          if (order.orderDate && order.deliveredAt) {
            const orderDate = new Date(order.orderDate);
            const deliveryDate = new Date(order.deliveredAt);
            const timeDiff = deliveryDate - orderDate;
            totalDeliveryTime += timeDiff;
            deliveryTimeCount++;
          }
        }
      }
    }

    // Calculate average delivery time
    if (deliveryTimeCount > 0) {
      const avgTimeMs = totalDeliveryTime / deliveryTimeCount;
      const avgHours = Math.round(avgTimeMs / (1000 * 60 * 60));
      stats.averageDeliveryTime =
        avgHours < 24
          ? `${avgHours} hours`
          : `${Math.round(avgHours / 24)} days`;
    }

    res.json(stats);
  } catch (error) {
    console.error("Error fetching delivered stats:", error);
    res.status(500).json({ error: "Failed to fetch delivered stats" });
  }
});

// Get specific order details
router.get("/orders/:orderId/details", async (req, res) => {
  try {
    const { orderId } = req.params;

    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = customer.shoppingHistory.find((o) => o.orderId === orderId);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Get delivery tracking
    const tracking = await DeliveryTracking.findOne({ orderId: orderId });

    // Get driver info
    let driverName = "N/A";
    if (order.driver1?.name) driverName = order.driver1.name;
    else if (order.driver2?.name) driverName = order.driver2.name;
    else if (tracking?.currentDriver?.driverName)
      driverName = tracking.currentDriver.driverName;

    const orderDetails = {
      orderId: order.orderId,
      customer: {
        name: customer.name,
        phone: customer.phoneNumber[0] || "",
        email: customer.email || "",
        address: {
          fullAddress:
            order.deliveryAddress?.fullAddress ||
            order.address ||
            "Address not provided",
          area:
            order.deliveryAddress?.area ||
            order.area ||
            order.location ||
            "Unknown Area",
          nickname: order.deliveryAddress?.nickname || "",
          googleMapLink:
            order.deliveryAddress?.googleMapLink || order.googleMapLink || "",
        },
      },
      status: order.status,
      totalAmount: order.totalAmount || 0,
      itemsCount: order.items ? order.items.length : 0,
      items: order.items || [],
      deliveryDateRaw: order.deliveryDate,
      timeSlot: order.timeSlot || "Not specified",
      deliveredAt: order.deliveredAt || order.completedAt || order.orderDate,
      driverName: driverName,
      paymentMethod: order.paymentMethod || "Cash on Delivery",
      deliveryNotes: order.deliveryNotes || "",
      specialInstructions: order.adminReason || "",
      timeline: tracking?.statusHistory || [],
    };

    res.json(orderDetails);
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).json({ error: "Failed to fetch order details" });
  }
});

module.exports = router;
