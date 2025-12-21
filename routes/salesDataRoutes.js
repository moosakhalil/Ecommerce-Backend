const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");
const Product = require("../models/Product");

// Helper function to extract orders from customer (simplified/adapted from orders.js)
function getOrdersFromCustomer(customer) {
  const orders =
    customer.shoppingHistory && customer.shoppingHistory.length > 0
      ? customer.shoppingHistory
      : customer.orderHistory || [];

  return orders.map((order, index) => {
    // Determine Order Date (same logic as orders.js for consistency)
    let orderDate;
    if (order.orderDate) {
      orderDate = order.orderDate;
    } else {
      // Fallback date logic
      if (customer.updatedAt) {
        const baseDate = new Date(customer.updatedAt);
        const hoursToSubtract = (orders.length - index - 1) * 24;
        orderDate = new Date(baseDate.getTime() - hoursToSubtract * 60 * 60 * 1000);
      } else {
        const baseDate = new Date(customer.createdAt);
        orderDate = new Date(baseDate.getTime() + index * 24 * 60 * 60 * 1000);
      }
    }

    return {
      orderId: order.orderId,
      orderDate: orderDate,
      items: order.items || [],
      // We process items later, just pass what we need
      customerId: customer._id,
      customerName: customer.name
    };
  });
}

// GET /api/sales-data
router.get("/", async (req, res) => {
  try {
    // 1. Fetch all customers with orders
    const customers = await Customer.find({
      $or: [
        { "shoppingHistory.0": { $exists: true } },
        { "orderHistory.0": { $exists: true } },
      ],
    }).select("name shoppingHistory orderHistory createdAt updatedAt");

    // 2. Fetch all products to get pricing details
    const products = await Product.find({}).lean();
    const productMap = new Map();
    products.forEach(p => productMap.set(p.productId, p));

    let salesData = [];

    // 3. Process each customer -> order -> item
    customers.forEach(customer => {
      const orders = getOrdersFromCustomer(customer);
      
      orders.forEach(order => {
        order.items.forEach(item => {
          // Find product details
          // Item usually has productId property or we match by check
          // Inspecting order structure typically: item = { productId, productName, quantity, price, ... }
          
          let productDetails = productMap.get(item.productId);
          
          // Fallback matching by name if productId not found/valid
          if (!productDetails && item.productName) {
             productDetails = products.find(p => p.productName === item.productName);
          }

          // Extract Pricing
          // "Our Price" = Price sold at (from order item)
          const soldPrice = item.price || 0;

          // "Normal Price" = Standard price from Product
          const normalPrice = productDetails?.NormalPrice || 0;

          // "Our Original Price" = Price before discount (from discountConfig) or NormalPrice
          const originalPrice = productDetails?.discountConfig?.originalPrice || normalPrice;

          // "Discount Price" = New price after discount or 0 if no discount
          const discountPrice = productDetails?.discountConfig?.newPrice || 0;

          salesData.push({
            id: order.orderId + "-" + (item.productId || Math.random().toString(36).substr(2, 5)), // Unique Key
            billNumber: order.orderId,
            date: order.orderDate, // Will format in frontend
            productName: item.productName || productDetails?.productName || "Unknown Product",
            quantitySold: item.quantity || 0,
            ourPrice: soldPrice,
            normalPrice: normalPrice,
            ourOriginalPrice: originalPrice,
            discountPrice: discountPrice
          });
        });
      });
    });

    // 4. Sort by Date (Newest first)
    salesData.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      success: true,
      count: salesData.length,
      data: salesData
    });

  } catch (error) {
    console.error("Sales Data API Error:", error);
    res.status(500).json({ success: false, message: "Error fetching sales data", error: error.message });
  }
});

module.exports = router;
