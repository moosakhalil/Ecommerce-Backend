const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");

// ─── GET /api/customers ─────────────────────────────────
// List all customers with pagination and search
router.get("/", async (req, res) => {
  try {
    const {
      search,
      page = 1,
      limit = 10,
      startDate,
      endDate,
      status,
    } = req.query;

    const match = {};

    // Search by name, phone, or email
    if (search) {
      match.$or = [
        { name: { $regex: search, $options: "i" } },
        { phoneNumber: { $elemMatch: { $regex: search, $options: "i" } } },
        { "contextData.email": { $regex: search, $options: "i" } },
      ];
    }

    // Filter by date range
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = new Date(startDate);
      if (endDate) match.createdAt.$lte = new Date(endDate);
    }

    // Filter by current order status
    if (status) {
      match.currentOrderStatus = status;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const pipeline = [
      { $match: match },
      { $sort: { createdAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: "total" }],
          data: [
            { $skip: skip },
            { $limit: Number(limit) },
            {
              $project: {
                _id: 1,
                name: 1,
                phoneNumber: { $arrayElemAt: ["$phoneNumber", 0] },
                email: "$contextData.email",
                currentOrderStatus: 1,
                conversationState: 1,
                createdAt: 1,
                lastInteraction: 1,
                // Calculate total orders from both orderHistory and shoppingHistory
                totalOrders: {
                  $add: [
                    { $size: { $ifNull: ["$orderHistory", []] } },
                    { $size: { $ifNull: ["$shoppingHistory", []] } },
                  ],
                },
                // Calculate total spent from both arrays
                totalSpent: {
                  $add: [
                    { $sum: { $ifNull: ["$orderHistory.totalAmount", []] } },
                    { $sum: { $ifNull: ["$shoppingHistory.totalAmount", []] } },
                  ],
                },
                // Get all customer schema fields
                addresses: 1,
                payerNames: 1,
                chatHistory: { $size: { $ifNull: ["$chatHistory", []] } },
                contextData: 1,
                preferences: 1,
                loyaltyPoints: 1,
                discountEligibility: 1,
                location: 1,
                verificationStatus: 1,
                notes: 1,
                tags: 1,
                source: 1,
                referralCode: 1,
                isBlocked: 1,
                blockedReason: 1,
                blockedAt: 1,
                unblockRequests: 1,
                // Calculate customer lifetime value
                lifetimeValue: {
                  $add: [
                    { $sum: { $ifNull: ["$orderHistory.totalAmount", []] } },
                    { $sum: { $ifNull: ["$shoppingHistory.totalAmount", []] } },
                  ],
                },
                // Get last order date
                lastOrderDate: {
                  $max: {
                    $concatArrays: [
                      { $ifNull: ["$orderHistory.orderDate", []] },
                      { $ifNull: ["$shoppingHistory.orderDate", []] },
                    ],
                  },
                },
                // Customer segmentation data
                segment: {
                  $switch: {
                    branches: [
                      {
                        case: {
                          $gte: [
                            {
                              $add: [
                                {
                                  $sum: {
                                    $ifNull: ["$orderHistory.totalAmount", []],
                                  },
                                },
                                {
                                  $sum: {
                                    $ifNull: [
                                      "$shoppingHistory.totalAmount",
                                      [],
                                    ],
                                  },
                                },
                              ],
                            },
                            10000,
                          ],
                        },
                        then: "VIP",
                      },
                      {
                        case: {
                          $gte: [
                            {
                              $add: [
                                {
                                  $sum: {
                                    $ifNull: ["$orderHistory.totalAmount", []],
                                  },
                                },
                                {
                                  $sum: {
                                    $ifNull: [
                                      "$shoppingHistory.totalAmount",
                                      [],
                                    ],
                                  },
                                },
                              ],
                            },
                            5000,
                          ],
                        },
                        then: "Premium",
                      },
                      {
                        case: {
                          $gt: [
                            {
                              $add: [
                                { $size: { $ifNull: ["$orderHistory", []] } },
                                {
                                  $size: { $ifNull: ["$shoppingHistory", []] },
                                },
                              ],
                            },
                            0,
                          ],
                        },
                        then: "Regular",
                      },
                    ],
                    default: "New",
                  },
                },
              },
            },
          ],
        },
      },
      {
        $project: {
          total: { $ifNull: [{ $arrayElemAt: ["$metadata.total", 0] }, 0] },
          customers: "$data",
        },
      },
    ];

    const [result] = await Customer.aggregate(pipeline);

    res.json({
      customers: result.customers || [],
      total: result.total || 0,
      page: Number(page),
      totalPages: Math.ceil((result.total || 0) / Number(limit)),
    });
  } catch (err) {
    console.error("GET /api/customers error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── GET /api/customers/:id ─────────────────────────────
// Get single customer details with complete schema information
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findById(id);

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Combine orders from both orderHistory and shoppingHistory
    const allOrders = [
      ...(customer.orderHistory || []),
      ...(customer.shoppingHistory || []),
    ];

    // Calculate comprehensive statistics
    const totalOrders = allOrders.length;
    const completedOrders = allOrders.filter(
      (order) => order.status === "order-complete"
    ).length;
    const cancelledOrders = allOrders.filter(
      (order) =>
        order.status === "order-refunded" || order.status === "order-cancelled"
    ).length;
    const pendingOrders = allOrders.filter((order) =>
      ["order-made-not-paid", "pay-not-confirmed", "order-processing"].includes(
        order.status
      )
    ).length;

    // Calculate spending by year
    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;

    const spending2024 = allOrders
      .filter(
        (order) =>
          order.orderDate &&
          new Date(order.orderDate).getFullYear() === currentYear
      )
      .reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    const spending2023 = allOrders
      .filter(
        (order) =>
          order.orderDate &&
          new Date(order.orderDate).getFullYear() === lastYear
      )
      .reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    const lifetimeSpending = allOrders.reduce(
      (sum, order) => sum + (order.totalAmount || 0),
      0
    );

    // Calculate average order value
    const averageOrderValue =
      totalOrders > 0 ? lifetimeSpending / totalOrders : 0;

    // Get most ordered products
    const productCounts = {};
    allOrders.forEach((order) => {
      (order.items || []).forEach((item) => {
        productCounts[item.productName] =
          (productCounts[item.productName] || 0) + (item.quantity || 0);
      });
    });

    const topProducts = Object.entries(productCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    // Get recent orders (last 20) from combined array
    const recentOrders = allOrders
      .sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate))
      .slice(0, 20)
      .map((order) => ({
        orderId: order.orderId,
        orderDate: order.orderDate,
        totalAmount: order.totalAmount,
        status: order.status,
        items: order.items || [],
        deliveryAddress: order.deliveryAddress,
        paymentMethod: order.paymentMethod,
        deliveryType: order.deliveryType,
      }));

    // Calculate customer segment
    let segment = "New";
    if (lifetimeSpending >= 10000) segment = "VIP";
    else if (lifetimeSpending >= 5000) segment = "Premium";
    else if (totalOrders > 0) segment = "Regular";

    // Get last order date
    const lastOrderDate =
      allOrders.length > 0
        ? new Date(
            Math.max(...allOrders.map((order) => new Date(order.orderDate)))
          )
        : null;

    // Days since last order
    const daysSinceLastOrder = lastOrderDate
      ? Math.floor((new Date() - lastOrderDate) / (1000 * 60 * 60 * 24))
      : null;

    // Customer status analysis
    const isActive = daysSinceLastOrder !== null && daysSinceLastOrder < 30;
    const isAtRisk = daysSinceLastOrder !== null && daysSinceLastOrder > 90;

    const customerData = {
      // Basic Info
      _id: customer._id,
      name: customer.name,
      phoneNumber: customer.phoneNumber || [],
      email: customer.contextData?.email || null,

      // Order Status
      currentOrderStatus: customer.currentOrderStatus,
      conversationState: customer.conversationState,

      // Timestamps
      createdAt: customer.createdAt,
      lastInteraction: customer.lastInteraction,

      // Addresses and Payment Info
      addresses: customer.addresses || [],
      payerNames: customer.payerNames || [],

      // Chat and Communication
      chatHistory: customer.chatHistory || [],
      chatHistoryCount: (customer.chatHistory || []).length,

      // Context and Preferences
      contextData: customer.contextData || {},
      preferences: customer.preferences || {},

      // Loyalty and Rewards
      loyaltyPoints: customer.loyaltyPoints || 0,
      discountEligibility: customer.discountEligibility || {},

      // Location
      location: customer.location || {},

      // Verification and Status
      verificationStatus: customer.verificationStatus || "unverified",
      isBlocked: customer.isBlocked || false,
      blockedReason: customer.blockedReason || null,
      blockedAt: customer.blockedAt || null,

      // Notes and Tags
      notes: customer.notes || [],
      tags: customer.tags || [],

      // Marketing
      source: customer.source || "unknown",
      referralCode: customer.referralCode || null,

      // Unblock Requests
      unblockRequests: customer.unblockRequests || [],

      // Order Statistics
      statistics: {
        totalOrders,
        completedOrders,
        cancelledOrders,
        pendingOrders,
        averageOrderValue: Math.round(averageOrderValue * 100) / 100,
        spending: {
          year2023: spending2023,
          year2024: spending2024,
          lifetime: lifetimeSpending,
        },
        segment,
        isActive,
        isAtRisk,
        daysSinceLastOrder,
        lastOrderDate,
      },

      // Top Products
      topProducts,

      // Recent Orders
      recentOrders,

      // Order History (complete)
      orderHistory: customer.orderHistory || [],
      shoppingHistory: customer.shoppingHistory || [],
      allOrders: allOrders,
    };

    res.json(customerData);
  } catch (err) {
    console.error("GET /api/customers/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── PUT /api/customers/:id ─────────────────────────────
// Update customer information with support for all schema fields
router.put("/customers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      phoneNumber,
      email,
      addresses,
      preferences,
      notes,
      tags,
      loyaltyPoints,
      verificationStatus,
      contextData,
      payerNames,
    } = req.body;

    const updateData = {};

    // Basic info updates
    if (name) updateData.name = name;
    if (phoneNumber) {
      updateData.phoneNumber = Array.isArray(phoneNumber)
        ? phoneNumber
        : [phoneNumber];
    }
    if (email) updateData["contextData.email"] = email;

    // Address updates
    if (addresses) updateData.addresses = addresses;

    // Preferences and customization
    if (preferences) updateData.preferences = preferences;
    if (notes) updateData.notes = notes;
    if (tags) updateData.tags = tags;
    if (payerNames) updateData.payerNames = payerNames;

    // Loyalty and verification
    if (loyaltyPoints !== undefined) updateData.loyaltyPoints = loyaltyPoints;
    if (verificationStatus) updateData.verificationStatus = verificationStatus;

    // Context data (merge with existing)
    if (contextData) {
      Object.keys(contextData).forEach((key) => {
        updateData[`contextData.${key}`] = contextData[key];
      });
    }

    // Update last interaction
    updateData.lastInteraction = new Date();

    const customer = await Customer.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    );

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    res.json({ success: true, customer });
  } catch (err) {
    console.error("PUT /api/customers/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── POST /api/customers/:id/notes ──────────────────────
// Add note to customer
router.post("/customers/:id/notes", async (req, res) => {
  try {
    const { id } = req.params;
    const { note, employeeName, noteType = "general" } = req.body;

    if (!note) {
      return res.status(400).json({ error: "Note is required" });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Add note to notes array if it exists, otherwise add to chat history
    if (customer.notes && Array.isArray(customer.notes)) {
      customer.notes.push({
        content: note,
        addedBy: employeeName || "Admin",
        addedAt: new Date(),
        type: noteType,
      });
    } else {
      // Fallback to chat history for backwards compatibility
      const noteMessage = `${employeeName || "Admin"}: ${note}`;
      customer.chatHistory.push({
        message: noteMessage,
        sender: "bot", // Using bot sender for admin notes
        timestamp: new Date(),
      });
    }

    customer.lastInteraction = new Date();
    await customer.save();

    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/customers/:id/notes error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── GET /api/customers/:id/orders ──────────────────────
// Get customer orders with pagination and filtering (from both order arrays)
router.get("/:id/orders", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, page = 1, limit = 10 } = req.query;

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Combine orders from both arrays
    let orders = [
      ...(customer.orderHistory || []),
      ...(customer.shoppingHistory || []),
    ];

    // Filter by status if provided
    if (status && status !== "All") {
      orders = orders.filter((order) => order.status === status);
    }

    // Sort by date (newest first)
    orders.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));

    // Pagination
    const skip = (Number(page) - 1) * Number(limit);
    const paginatedOrders = orders.slice(skip, skip + Number(limit));

    res.json({
      orders: paginatedOrders,
      total: orders.length,
      page: Number(page),
      totalPages: Math.ceil(orders.length / Number(limit)),
    });
  } catch (err) {
    console.error("GET /api/customers/:id/orders error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── GET /api/customers/:id/chat ────────────────────────
// Get customer chat history
router.get("/:id/chat", async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findById(id, {
      chatHistory: 1,
      name: 1,
    });

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    res.json({
      chatHistory: customer.chatHistory || [],
      customerName: customer.name,
    });
  } catch (err) {
    console.error("GET /api/customers/:id/chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── DELETE /api/customers/:id ──────────────────────────
// Block customer (soft delete by updating status)
router.delete("/customers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason = "Admin action" } = req.body;

    const customer = await Customer.findByIdAndUpdate(
      id,
      {
        $set: {
          conversationState: "blocked",
          isBlocked: true,
          blockedReason: reason,
          blockedAt: new Date(),
          lastInteraction: new Date(),
        },
      },
      { new: true }
    );

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    res.json({ success: true, message: "Customer blocked successfully" });
  } catch (err) {
    console.error("DELETE /api/customers/:id error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── PUT /api/customers/:id/unblock ─────────────────────
// Unblock customer
router.put("/customers/:id/unblock", async (req, res) => {
  try {
    const { id } = req.params;

    const customer = await Customer.findByIdAndUpdate(
      id,
      {
        $set: {
          conversationState: "new",
          isBlocked: false,
          blockedReason: null,
          blockedAt: null,
          lastInteraction: new Date(),
        },
      },
      { new: true }
    );

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    res.json({ success: true, message: "Customer unblocked successfully" });
  } catch (err) {
    console.error("PUT /api/customers/:id/unblock error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── PUT /api/customers/:id/loyalty ─────────────────────
// Update customer loyalty points
router.put("/customers/:id/loyalty", async (req, res) => {
  try {
    const { id } = req.params;
    const { points, operation = "set" } = req.body; // operation: 'set', 'add', 'subtract'

    if (points === undefined) {
      return res.status(400).json({ error: "Points value is required" });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    let newPoints = customer.loyaltyPoints || 0;

    switch (operation) {
      case "add":
        newPoints += Number(points);
        break;
      case "subtract":
        newPoints = Math.max(0, newPoints - Number(points)); // Don't allow negative points
        break;
      case "set":
      default:
        newPoints = Number(points);
        break;
    }

    customer.loyaltyPoints = newPoints;
    customer.lastInteraction = new Date();
    await customer.save();

    res.json({
      success: true,
      newPoints,
      message: `Loyalty points ${
        operation === "set"
          ? "updated"
          : operation === "add"
          ? "added"
          : "deducted"
      } successfully`,
    });
  } catch (err) {
    console.error("PUT /api/customers/:id/loyalty error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── GET /api/customers/analytics/summary ───────────────
// Get customer analytics summary
router.get("/analytics/summary", async (req, res) => {
  try {
    const pipeline = [
      {
        $project: {
          name: 1,
          phoneNumber: 1,
          createdAt: 1,
          currentOrderStatus: 1,
          conversationState: 1,
          isBlocked: 1,
          loyaltyPoints: 1,
          // Combine orders from both arrays
          allOrders: {
            $concatArrays: [
              { $ifNull: ["$orderHistory", []] },
              { $ifNull: ["$shoppingHistory", []] },
            ],
          },
        },
      },
      {
        $project: {
          name: 1,
          phoneNumber: 1,
          createdAt: 1,
          currentOrderStatus: 1,
          conversationState: 1,
          isBlocked: 1,
          loyaltyPoints: 1,
          totalOrders: { $size: "$allOrders" },
          totalSpent: { $sum: "$allOrders.totalAmount" },
          lastOrderDate: { $max: "$allOrders.orderDate" },
        },
      },
      {
        $group: {
          _id: null,
          totalCustomers: { $sum: 1 },
          activeCustomers: {
            $sum: {
              $cond: [{ $eq: ["$conversationState", "active"] }, 1, 0],
            },
          },
          blockedCustomers: {
            $sum: {
              $cond: [{ $eq: ["$isBlocked", true] }, 1, 0],
            },
          },
          customersWithOrders: {
            $sum: {
              $cond: [{ $gt: ["$totalOrders", 0] }, 1, 0],
            },
          },
          totalRevenue: { $sum: "$totalSpent" },
          totalOrders: { $sum: "$totalOrders" },
          averageOrderValue: {
            $avg: {
              $cond: [
                { $gt: ["$totalOrders", 0] },
                { $divide: ["$totalSpent", "$totalOrders"] },
                0,
              ],
            },
          },
          averageCustomerValue: { $avg: "$totalSpent" },
          totalLoyaltyPoints: { $sum: "$loyaltyPoints" },
        },
      },
    ];

    const [analytics] = await Customer.aggregate(pipeline);

    // Get customer segments
    const segmentPipeline = [
      {
        $project: {
          totalSpent: {
            $add: [
              { $sum: { $ifNull: ["$orderHistory.totalAmount", []] } },
              { $sum: { $ifNull: ["$shoppingHistory.totalAmount", []] } },
            ],
          },
        },
      },
      {
        $project: {
          segment: {
            $switch: {
              branches: [
                { case: { $gte: ["$totalSpent", 10000] }, then: "VIP" },
                { case: { $gte: ["$totalSpent", 5000] }, then: "Premium" },
                { case: { $gt: ["$totalSpent", 0] }, then: "Regular" },
              ],
              default: "New",
            },
          },
        },
      },
      {
        $group: {
          _id: "$segment",
          count: { $sum: 1 },
        },
      },
    ];

    const segments = await Customer.aggregate(segmentPipeline);

    // Get recent registrations (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentRegistrations = await Customer.countDocuments({
      createdAt: { $gte: thirtyDaysAgo },
    });

    res.json({
      summary: analytics || {
        totalCustomers: 0,
        activeCustomers: 0,
        blockedCustomers: 0,
        customersWithOrders: 0,
        totalRevenue: 0,
        totalOrders: 0,
        averageOrderValue: 0,
        averageCustomerValue: 0,
        totalLoyaltyPoints: 0,
      },
      segments: segments.reduce(
        (acc, seg) => {
          acc[seg._id] = seg.count;
          return acc;
        },
        { VIP: 0, Premium: 0, Regular: 0, New: 0 }
      ),
      recentRegistrations,
    });
  } catch (err) {
    console.error("GET /api/customers/analytics/summary error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/// ─── REMOVED CONFLICTING /orders ROUTE ─────────────────────────────────
// This route is now handled by orders.js router to avoid conflicts

// ─── PUT /api/orders/:orderId/status ──────────────────── (req, res) => { ... })

// ─── PUT /api/orders/:orderId/status ────────────────────
// Update order status and additional fields
router.put("/orders/:orderId/status", async (req, res) => {
  try {
    const { orderId } = req.params;
    const {
      status,
      timeSlot,
      driver1,
      driver2,
      pickupType,
      truckOnDeliver,
      reason,
    } = req.body;

    const customer = await Customer.findOne({
      $or: [
        { "orderHistory.orderId": orderId },
        { "shoppingHistory.orderId": orderId },
      ],
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Find order in orderHistory
    let orderIndex = customer.orderHistory?.findIndex(
      (order) => order.orderId === orderId
    );
    let isOrderHistory = true;

    // If not found in orderHistory, check shoppingHistory
    if (orderIndex === -1) {
      orderIndex = customer.shoppingHistory?.findIndex(
        (order) => order.orderId === orderId
      );
      isOrderHistory = false;
    }

    if (orderIndex === -1) {
      return res.status(404).json({ error: "Order not found" });
    }

    const updateFields = { status };

    // Add optional fields if provided
    if (timeSlot !== undefined) updateFields.timeSlot = timeSlot;
    if (driver1 !== undefined) updateFields.driver1 = driver1;
    if (driver2 !== undefined) updateFields.driver2 = driver2;
    if (pickupType !== undefined) updateFields.pickupType = pickupType;
    if (truckOnDeliver !== undefined)
      updateFields.truckOnDeliver = truckOnDeliver;
    if (reason !== undefined) updateFields.adminReason = reason;

    // Update the order
    if (isOrderHistory) {
      Object.assign(customer.orderHistory[orderIndex], updateFields);
    } else {
      Object.assign(customer.shoppingHistory[orderIndex], updateFields);
    }

    // Also update the customer's current order status
    customer.currentOrderStatus = status;

    await customer.save();
    res.json({ success: true });
  } catch (err) {
    console.error("PUT /orders/:orderId/status error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── PUT /api/orders/:orderId/item-status ────────────────────
// Update individual item status in an order
router.put("/orders/:orderId/item-status", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { itemIndex, onTruck } = req.body;

    if (itemIndex === undefined || onTruck === undefined) {
      return res
        .status(400)
        .json({ error: "itemIndex and onTruck are required" });
    }

    // Find the customer with the order
    const customer = await Customer.findOne({
      $or: [
        { "orderHistory.orderId": orderId },
        { "shoppingHistory.orderId": orderId },
      ],
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Find the order
    let orderIndex = customer.orderHistory?.findIndex(
      (order) => order.orderId === orderId
    );
    let isOrderHistory = true;

    if (orderIndex === -1) {
      orderIndex = customer.shoppingHistory?.findIndex(
        (order) => order.orderId === orderId
      );
      isOrderHistory = false;
    }

    if (orderIndex === -1) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = isOrderHistory
      ? customer.orderHistory[orderIndex]
      : customer.shoppingHistory[orderIndex];

    if (!order.items[itemIndex]) {
      return res.status(404).json({ error: "Item not found" });
    }

    // Update the item's onTruck status
    order.items[itemIndex].onTruck = onTruck;

    // Check if all items are now on truck
    const allItemsOnTruck = order.items.every((item) => item.onTruck === true);

    if (allItemsOnTruck) {
      // Update order status to allocated-driver and set truckOnDeliver to true
      order.status = "allocated-driver";
      order.truckOnDeliver = true;
      customer.currentOrderStatus = "allocated-driver";
    }

    await customer.save();

    res.json({
      success: true,
      allItemsOnTruck,
      orderStatus: order.status,
    });
  } catch (err) {
    console.error("PUT /orders/:orderId/item-status error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── GET /api/orders/:orderId ───────────────────────────
// Get single order detail with customer info
router.get("/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    console.log("=== ORDER DETAIL API DEBUG ===");
    console.log("Requested Order ID:", orderId);

    // Find customer with this order and get both customer and order data
    const customer = await Customer.findOne({
      $or: [
        { "orderHistory.orderId": orderId },
        { "shoppingHistory.orderId": orderId },
      ],
    });

    console.log("=== CUSTOMER FOUND ===");
    if (customer) {
      console.log("Customer name:", customer.name);
      console.log("Customer phoneNumber:", customer.phoneNumber);
    } else {
      console.log("No customer found with this order");
      return res.status(404).json({ error: "Order not found" });
    }

    // Find the specific order
    let order = customer.orderHistory?.find((o) => o.orderId === orderId);
    if (!order) {
      order = customer.shoppingHistory?.find((o) => o.orderId === orderId);
    }

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Add customer information to order data
    const enrichedOrder = {
      ...order.toObject(),
      customer: customer.name,
      customerId: customer._id,
      phoneNumber:
        customer.phoneNumber && customer.phoneNumber.length > 0
          ? customer.phoneNumber[0]
          : "N/A",
      accountHolderName:
        order.accountHolderName ||
        (customer.payerNames && customer.payerNames.length > 0
          ? customer.payerNames[0]
          : "Not provided"),
    };

    console.log("=== ENRICHED ORDER RESPONSE ===");
    console.log("Customer name:", enrichedOrder.customer);
    console.log("Phone number:", enrichedOrder.phoneNumber);
    console.log("Account holder:", enrichedOrder.accountHolderName);

    res.json(enrichedOrder);
  } catch (err) {
    console.error("GET /api/orders/:orderId error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// All other routes from previous router...
router.put("/orders/:orderId/allocate", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { timeSlot, driver1, driver2, pickupType } = req.body;

    if (!timeSlot || !driver1 || !driver2 || !pickupType) {
      return res
        .status(400)
        .json({ error: "All allocation fields are required" });
    }

    const customer = await Customer.findOne({
      $or: [
        { "orderHistory.orderId": orderId },
        { "shoppingHistory.orderId": orderId },
      ],
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Find and update order
    let updated = false;
    if (customer.orderHistory) {
      const orderIndex = customer.orderHistory.findIndex(
        (o) => o.orderId === orderId
      );
      if (orderIndex !== -1) {
        Object.assign(customer.orderHistory[orderIndex], {
          timeSlot,
          driver1,
          driver2,
          pickupType,
          truckOnDeliver: false,
        });
        updated = true;
      }
    }

    if (!updated && customer.shoppingHistory) {
      const orderIndex = customer.shoppingHistory.findIndex(
        (o) => o.orderId === orderId
      );
      if (orderIndex !== -1) {
        Object.assign(customer.shoppingHistory[orderIndex], {
          timeSlot,
          driver1,
          driver2,
          pickupType,
          truckOnDeliver: false,
        });
        updated = true;
      }
    }

    if (!updated) {
      return res.status(404).json({ error: "Order not found" });
    }

    await customer.save();
    res.json({ success: true });
  } catch (err) {
    console.error("PUT /orders/:orderId/allocate error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// New route for changing order status to "ready-to-pickup"
router.put("/orders/:orderId/ready", async (req, res) => {
  try {
    const { orderId } = req.params;

    const customer = await Customer.findOne({
      $or: [
        { "orderHistory.orderId": orderId },
        { "shoppingHistory.orderId": orderId },
      ],
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Find and update order status
    let updated = false;
    if (customer.orderHistory) {
      const orderIndex = customer.orderHistory.findIndex(
        (o) => o.orderId === orderId
      );
      if (orderIndex !== -1) {
        customer.orderHistory[orderIndex].status = "ready-to-pickup";
        updated = true;
      }
    }

    if (!updated && customer.shoppingHistory) {
      const orderIndex = customer.shoppingHistory.findIndex(
        (o) => o.orderId === orderId
      );
      if (orderIndex !== -1) {
        customer.shoppingHistory[orderIndex].status = "ready-to-pickup";
        updated = true;
      }
    }

    if (!updated) {
      return res.status(404).json({ error: "Order not found" });
    }

    await customer.save();
    res.json({ success: true });
  } catch (err) {
    console.error("PUT /orders/:orderId/ready error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Return phone number and name for a given order
router.get(":orderId/phone", async (req, res) => {
  try {
    const { orderId } = req.params;

    const customer = await Customer.findOne(
      {
        $or: [
          { "orderHistory.orderId": orderId },
          { "shoppingHistory.orderId": orderId },
        ],
      },
      { phoneNumber: 1, name: 1 }
    );

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const raw =
      customer.phoneNumber && customer.phoneNumber.length > 0
        ? customer.phoneNumber[0]
        : "";
    const cleaned = raw.replace(/\D+/g, "");

    res.json({
      phoneNumber: cleaned,
      name: customer.name,
    });
  } catch (err) {
    console.error("GET /api/orders/:orderId/phone error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

router.put("/orders/:orderId/pickup-status", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { pickupStatus } = req.body;

    const validStatuses = [
      "ready to pickup",
      "order-not-pickedup",
      "order-pickuped-up",
    ];

    if (!validStatuses.includes(pickupStatus)) {
      return res.status(400).json({ error: "Invalid pickup status" });
    }

    const customer = await Customer.findOne({
      $or: [
        { "orderHistory.orderId": orderId },
        { "shoppingHistory.orderId": orderId },
      ],
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Find and update order
    let updated = false;
    if (customer.orderHistory) {
      const orderIndex = customer.orderHistory.findIndex(
        (o) => o.orderId === orderId
      );
      if (orderIndex !== -1) {
        customer.orderHistory[orderIndex].status = pickupStatus;
        updated = true;
      }
    }

    if (!updated && customer.shoppingHistory) {
      const orderIndex = customer.shoppingHistory.findIndex(
        (o) => o.orderId === orderId
      );
      if (orderIndex !== -1) {
        customer.shoppingHistory[orderIndex].status = pickupStatus;
        updated = true;
      }
    }

    if (!updated) {
      return res.status(404).json({ error: "Order not found" });
    }

    await customer.save();
    res.json({ success: true });
  } catch (err) {
    console.error("PUT /orders/:orderId/pickup-status error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
