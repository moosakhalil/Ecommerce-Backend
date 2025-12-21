const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");

// Helper function to extract orders from customer (adapted from orders.js/salesDataRoutes.js)
function getOrdersFromCustomer(customer) {
  const orders =
    customer.shoppingHistory && customer.shoppingHistory.length > 0
      ? customer.shoppingHistory
      : customer.orderHistory || [];

  return orders.map((order, index) => {
    // Determine Order Date
    let orderDate;
    if (order.orderDate) {
      orderDate = order.orderDate;
    } else {
      if (customer.updatedAt) {
        const baseDate = new Date(customer.updatedAt);
        const hoursToSubtract = (orders.length - index - 1) * 24;
        orderDate = new Date(baseDate.getTime() - hoursToSubtract * 60 * 60 * 1000);
      } else {
        const baseDate = new Date(customer.createdAt);
        orderDate = new Date(baseDate.getTime() + index * 24 * 60 * 60 * 1000);
      }
    }

    // Extract Receipt Image (Order level)
    // Note: Some payment fields might be on customer level, but for Bill History we check order first
    const receiptImage = order.receiptImage || null;

    return {
      orderId: order.orderId,
      customerName: customer.name,
      customerId: customer._id,
      date: orderDate,
      totalAmount: order.totalAmount || 0,
      status: order.status || order.paymentStatus || "pending", // Use payment status or order status
      items: order.items || [],
      receiptImage: receiptImage,
      paymentStatus: order.paymentStatus || "pending",
      deliveryOption: order.deliveryOption
    };
  });
}

// GET /api/bills -> Return all orders as "bills"
router.get("/", async (req, res) => {
  try {
    // 1. Fetch customers with history
    const customers = await Customer.find({
      $or: [
        { "shoppingHistory.0": { $exists: true } },
        { "orderHistory.0": { $exists: true } },
      ],
    }).select("name shoppingHistory orderHistory createdAt updatedAt");

    let allBills = [];

    // 2. Extract Bills
    customers.forEach(customer => {
      const orders = getOrdersFromCustomer(customer);
      allBills.push(...orders);
    });

    // 3. Sort by Date Descending
    allBills.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      success: true,
      count: allBills.length,
      data: allBills
    });

  } catch (error) {
    console.error("Error fetching bills:", error);
    res.status(500).json({ success: false, message: "Error fetching bills" });
  }
});

module.exports = router;
