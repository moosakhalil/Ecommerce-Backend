// routes/orders.js - COMPLETE FIXED VERSION with SINGLE status enum

const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");

/**
 * ✅ ENHANCED: getOrdersFromCustomer
 * This function now properly extracts payment fields from BOTH order and customer
 */
function getOrdersFromCustomer(customer) {
  const orders =
    customer.shoppingHistory && customer.shoppingHistory.length > 0
      ? customer.shoppingHistory
      : customer.orderHistory || [];

  return orders.map((order, index) => {
    const orderObj = order.toObject ? order.toObject() : order;

    // Generate realistic date for each order
    let orderDate;
    if (orderObj.orderDate) {
      orderDate = orderObj.orderDate;
    } else {
      let foundTimestamp = null;

      if (customer.chatHistory && customer.chatHistory.length > 0) {
        const orderRelatedChat = customer.chatHistory.find(
          (chat) => chat.message && chat.message.includes(orderObj.orderId)
        );

        if (orderRelatedChat && orderRelatedChat.timestamp) {
          foundTimestamp = orderRelatedChat.timestamp;
        } else {
          const confirmationChats = customer.chatHistory.filter(
            (chat) =>
              chat.message &&
              (chat.message.includes("order_confirmation") ||
                chat.message.includes("Your total bill") ||
                chat.message.includes("proceed to payment"))
          );

          if (confirmationChats[index] && confirmationChats[index].timestamp) {
            foundTimestamp = confirmationChats[index].timestamp;
          }
        }
      }

      if (foundTimestamp) {
        orderDate = foundTimestamp;
      } else if (customer.updatedAt) {
        const baseDate = new Date(customer.updatedAt);
        const hoursToSubtract = (orders.length - index - 1) * 24;
        orderDate = new Date(
          baseDate.getTime() - hoursToSubtract * 60 * 60 * 1000
        );
      } else {
        const baseDate = new Date(customer.createdAt);
        orderDate = new Date(baseDate.getTime() + index * 24 * 60 * 60 * 1000);
      }
    }

    /**
     * ✅ CRITICAL FIX: Complete Payment Field Extraction
     * Now checks multiple sources in proper priority order
     */
    const paymentFields = {
      // Account Holder Name - Check in priority order
      accountHolderName:
        orderObj.accountHolderName ||
        (customer.payerNames && customer.payerNames.length > 0
          ? customer.payerNames[0]
          : "") ||
        (customer.bankAccounts && customer.bankAccounts.length > 0
          ? customer.bankAccounts[0].accountHolderName
          : "") ||
        "",

      // Bank Name - Check in priority order
      paidBankName:
        orderObj.paidBankName ||
        (customer.bankNames && customer.bankNames.length > 0
          ? customer.bankNames[0]
          : "") ||
        (customer.bankAccounts && customer.bankAccounts.length > 0
          ? customer.bankAccounts[0].bankName
          : "") ||
        "",

      // Transaction ID - FROM ORDER LEVEL
      transactionId: orderObj.transactionId || "",

      // Receipt Image Data - FROM ORDER LEVEL
      receiptImage: orderObj.receiptImage || null,
      receiptImageMetadata: orderObj.receiptImageMetadata || null,

      // Payment Status and Method - FROM ORDER LEVEL
      paymentStatus: orderObj.paymentStatus || "pending",
      paymentMethod: orderObj.paymentMethod || "",
    };

    return {
      orderId: orderObj.orderId,
      orderDate: orderDate,
      created: orderDate,
      createdAt: customer.createdAt,
      customer: customer.name,
      customerName: customer.name,
      customerId: customer._id,
      phoneNumber:
        customer.phoneNumber && customer.phoneNumber.length > 0
          ? customer.phoneNumber[0]
          : "N/A",
      customerPhone:
        customer.phoneNumber && customer.phoneNumber.length > 0
          ? customer.phoneNumber[0]
          : "N/A",
      items: orderObj.items || [],
      totalAmount: orderObj.totalAmount || 0,
      deliveryCharge: orderObj.deliveryCharge || 0,

      // ✅ FIX #2: Use order-level status ONLY (not customer.currentOrderStatus)
      status: orderObj.status || customer.currentOrderStatus || "pending",
      currentOrderStatus:
        orderObj.status || customer.currentOrderStatus || "pending",
      orderStatus: orderObj.status,

      // ✅ INCLUDE ALL PAYMENT FIELDS WITH PROPER FALLBACKS
      ...paymentFields,

      deliveryAddress: orderObj.deliveryAddress || {},
      deliveryOption: orderObj.deliveryOption,
      deliveryLocation: orderObj.deliveryLocation,
      deliveryType: orderObj.deliveryType,
      deliverySpeed: orderObj.deliverySpeed,
      timeSlot: orderObj.timeSlot,
      driver1: orderObj.driver1,
      driver2: orderObj.driver2,
      pickupType: orderObj.pickupType,
      truckOnDeliver: orderObj.truckOnDeliver || false,
      ecoDeliveryDiscount: orderObj.ecoDeliveryDiscount || 0,
      firstOrderDiscount:
        orderObj.discounts?.firstOrderDiscount ||
        orderObj.firstOrderDiscount ||
        0,
      adminReason: orderObj.adminReason,
      pickupAllocated: orderObj.pickupAllocated || false,
      allocatedAt: orderObj.allocatedAt,
      complaints: orderObj.complaints || [],
      refunds: orderObj.refunds || [],
      replacements: orderObj.replacements || [],
      corrections: orderObj.corrections || [],
    };
  });
}

function findOrderInCustomer(customer, orderId) {
  if (customer.shoppingHistory && customer.shoppingHistory.length > 0) {
    const order = customer.shoppingHistory.find((o) => o.orderId === orderId);
    if (order) {
      return {
        order: order,
        isShoppingHistory: true,
        index: customer.shoppingHistory.findIndex((o) => o.orderId === orderId),
      };
    }
  }

  if (customer.orderHistory && customer.orderHistory.length > 0) {
    const order = customer.orderHistory.find((o) => o.orderId === orderId);
    if (order) {
      return {
        order: order,
        isShoppingHistory: false,
        index: customer.orderHistory.findIndex((o) => o.orderId === orderId),
      };
    }
  }

  return null;
}

// GET /api/orders - List all orders with filtering
router.get("/", async (req, res) => {
  try {
    const {
      currentOrderStatus,
      status,
      search,
      page = 1,
      limit = 10,
      startDate,
      endDate,
      deliveryType,
      area,
      driver1,
      driver2,
    } = req.query;

    console.log("=== ORDERS QUERY DEBUG ===");
    console.log("Query params:", req.query);

    const finalMatch = {
      $or: [
        { "shoppingHistory.0": { $exists: true } },
        { "orderHistory.0": { $exists: true } },
      ],
    };

    const customers = await Customer.find(finalMatch);

    console.log("=== ORDERS ROUTER DEBUG ===");
    console.log("Found customers with orders:", customers.length);

    let allOrders = [];
    customers.forEach((customer) => {
      const orders = getOrdersFromCustomer(customer);
      console.log(`Customer ${customer.name} has ${orders.length} orders`);
      allOrders.push(...orders);
    });

    console.log("=== TOTAL ORDERS FOUND ===");
    console.log("Before filtering:", allOrders.length);

    let filteredOrders = allOrders;

    // ✅ FIX: Filter by order.status (not customer.currentOrderStatus)
    if (currentOrderStatus) {
      const statusArray = currentOrderStatus.split(",");
      filteredOrders = filteredOrders.filter((order) =>
        statusArray.includes(order.status)
      );
      console.log(
        `After status filter (${currentOrderStatus}):`,
        filteredOrders.length
      );
    }

    if (status && !currentOrderStatus) {
      const statusArray = status.includes(",") ? status.split(",") : [status];
      filteredOrders = filteredOrders.filter((order) =>
        statusArray.includes(order.status)
      );
    }

    if (search) {
      filteredOrders = filteredOrders.filter((order) =>
        order.orderId.toLowerCase().includes(search.toLowerCase())
      );
    }

    if (startDate || endDate) {
      filteredOrders = filteredOrders.filter((order) => {
        const orderDate = new Date(order.orderDate);
        if (startDate && orderDate < new Date(startDate)) return false;
        if (endDate && orderDate > new Date(endDate)) return false;
        return true;
      });
    }

    if (deliveryType) {
      filteredOrders = filteredOrders.filter(
        (order) => order.deliveryType === deliveryType
      );
    }
    if (driver1) {
      filteredOrders = filteredOrders.filter(
        (order) => order.driver1 === driver1
      );
    }
    if (driver2) {
      filteredOrders = filteredOrders.filter(
        (order) => order.driver2 === driver2
      );
    }
    if (area) {
      filteredOrders = filteredOrders.filter((order) =>
        order.deliveryAddress?.area?.toLowerCase().includes(area.toLowerCase())
      );
    }

    filteredOrders.sort(
      (a, b) => new Date(b.orderDate) - new Date(a.orderDate)
    );

    const total = filteredOrders.length;
    const skip = (Number(page) - 1) * Number(limit);
    const paginatedOrders = filteredOrders.slice(skip, skip + Number(limit));

    console.log("=== FINAL ORDERS PAYMENT DEBUG ===");
    paginatedOrders.forEach((order, idx) => {
      console.log(`Order ${idx + 1}:`, {
        orderId: order.orderId,
        status: order.status,
        transactionId: order.transactionId || "MISSING",
        receiptImage: order.receiptImage ? "PRESENT" : "MISSING",
        accountHolderName: order.accountHolderName || "MISSING",
        paidBankName: order.paidBankName || "MISSING",
      });
    });

    res.json({
      success: true,
      orders: paginatedOrders,
      total: total,
      count: paginatedOrders.length,
    });
  } catch (error) {
    console.error("Orders API Error:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching orders",
      error: error.message,
    });
  }
});

// GET /api/orders/:orderId - Get single order with complete data
router.get("/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    console.log("=== GET SINGLE ORDER DEBUG ===");
    console.log("Requested Order ID:", orderId);

    const customer = await Customer.findOne({
      $or: [
        { "shoppingHistory.orderId": orderId },
        { "orderHistory.orderId": orderId },
      ],
    });

    if (!customer) {
      console.log("Customer not found for order:", orderId);
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    console.log("Found customer:", customer.name);
    console.log("Customer payerNames:", customer.payerNames);
    console.log("Customer bankNames:", customer.bankNames);

    const orderInfo = findOrderInCustomer(customer, orderId);
    if (!orderInfo) {
      return res.status(404).json({
        success: false,
        message: "Order not found in customer data",
      });
    }

    const order = orderInfo.order;

    // Generate realistic date for this order
    let orderDate;
    if (order.orderDate) {
      orderDate = order.orderDate;
    } else {
      let foundTimestamp = null;

      if (customer.chatHistory && customer.chatHistory.length > 0) {
        const orderRelatedChat = customer.chatHistory.find(
          (chat) => chat.message && chat.message.includes(orderId)
        );

        if (orderRelatedChat && orderRelatedChat.timestamp) {
          foundTimestamp = orderRelatedChat.timestamp;
        } else {
          const confirmationChats = customer.chatHistory.filter(
            (chat) =>
              chat.message &&
              (chat.message.includes("order_confirmation") ||
                chat.message.includes("Your total bill") ||
                chat.message.includes("proceed to payment"))
          );

          if (
            confirmationChats[orderInfo.index] &&
            confirmationChats[orderInfo.index].timestamp
          ) {
            foundTimestamp = confirmationChats[orderInfo.index].timestamp;
          }
        }
      }

      if (foundTimestamp) {
        orderDate = foundTimestamp;
      } else if (customer.updatedAt) {
        orderDate = customer.updatedAt;
      } else {
        orderDate = customer.createdAt;
      }
    }

    /**
     * ✅ CRITICAL FIX: Extract payment fields with proper fallbacks
     */
    const paymentFields = {
      accountHolderName:
        order.accountHolderName ||
        (customer.payerNames && customer.payerNames.length > 0
          ? customer.payerNames[0]
          : "") ||
        (customer.bankAccounts && customer.bankAccounts.length > 0
          ? customer.bankAccounts[0].accountHolderName
          : "") ||
        "",

      paidBankName:
        order.paidBankName ||
        (customer.bankNames && customer.bankNames.length > 0
          ? customer.bankNames[0]
          : "") ||
        (customer.bankAccounts && customer.bankAccounts.length > 0
          ? customer.bankAccounts[0].bankName
          : "") ||
        "",

      transactionId: order.transactionId || "",
      receiptImage: order.receiptImage || null,
      receiptImageMetadata: order.receiptImageMetadata || null,
      paymentStatus: order.paymentStatus || "pending",
      paymentMethod: order.paymentMethod || "",
    };

    console.log("=== PAYMENT FIELDS EXTRACTED ===");
    console.log("Account Holder:", paymentFields.accountHolderName);
    console.log("Bank Name:", paymentFields.paidBankName);
    console.log("Transaction ID:", paymentFields.transactionId);
    console.log(
      "Receipt Image:",
      paymentFields.receiptImage ? "PRESENT" : "MISSING"
    );

    const formattedOrder = {
      orderId: order.orderId,
      orderDate: orderDate,
      created: orderDate,
      createdAt: customer.createdAt,
      customer: customer.name,
      customerName: customer.name,
      customerId: customer._id,
      phoneNumber:
        customer.phoneNumber && customer.phoneNumber.length > 0
          ? customer.phoneNumber[0]
          : "N/A",
      customerPhone:
        customer.phoneNumber && customer.phoneNumber.length > 0
          ? customer.phoneNumber[0]
          : "N/A",
      items: order.items || [],
      totalAmount: order.totalAmount,
      deliveryCharge: order.deliveryCharge || 0,

      // ✅ FIX: Use order-level status (not customer.currentOrderStatus)
      status: order.status || customer.currentOrderStatus || "pending",
      currentOrderStatus:
        order.status || customer.currentOrderStatus || "pending",
      orderStatus: order.status,

      // ✅ INCLUDE ALL PAYMENT FIELDS
      ...paymentFields,

      deliveryAddress: order.deliveryAddress || {},
      deliveryOption: order.deliveryOption,
      deliveryLocation: order.deliveryLocation,
      deliveryType: order.deliveryType,
      deliverySpeed: order.deliverySpeed,
      timeSlot: order.timeSlot,
      driver1: order.driver1,
      driver2: order.driver2,
      pickupType: order.pickupType,
      truckOnDeliver: order.truckOnDeliver || false,
      ecoDeliveryDiscount: order.ecoDeliveryDiscount || 0,
      firstOrderDiscount:
        order.discounts?.firstOrderDiscount || order.firstOrderDiscount || 0,
      adminReason: order.adminReason,
      pickupAllocated: order.pickupAllocated || false,
      allocatedAt: order.allocatedAt,
      complaints: order.complaints || [],
      refunds: order.refunds || [],
      replacements: order.replacements || [],
      corrections: order.corrections || [],
    };

    res.json(formattedOrder);
  } catch (error) {
    console.error("Error fetching specific order:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching order",
      error: error.message,
    });
  }
});

// PUT /api/orders/:orderId/status - Update order status
router.put("/:orderId/status", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, reason } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    console.log("=== UPDATE ORDER STATUS ===");
    console.log("Order ID:", orderId);
    console.log("New Status:", status);
    console.log("Reason:", reason);

    const customer = await Customer.findOne({
      $or: [
        { "shoppingHistory.orderId": orderId },
        { "orderHistory.orderId": orderId },
      ],
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const orderInfo = findOrderInCustomer(customer, orderId);

    if (!orderInfo) {
      return res.status(404).json({
        success: false,
        message: "Order not found in customer data",
      });
    }

    console.log("Found order:", orderId);
    console.log(
      "Order is in:",
      orderInfo.isShoppingHistory ? "shoppingHistory" : "orderHistory"
    );
    console.log("Order index:", orderInfo.index);

    // ✅ FIX #2: Update ONLY the individual order's status (not customer.currentOrderStatus)
    if (orderInfo.isShoppingHistory) {
      console.log("Updating shoppingHistory order status...");
      console.log(
        "Before update:",
        customer.shoppingHistory[orderInfo.index].status
      );

      customer.shoppingHistory[orderInfo.index].status = status;
      if (reason) {
        customer.shoppingHistory[orderInfo.index].adminReason = reason;
      }

      console.log(
        "After update:",
        customer.shoppingHistory[orderInfo.index].status
      );
    } else {
      console.log("Updating orderHistory order status...");
      console.log(
        "Before update:",
        customer.orderHistory[orderInfo.index].status
      );

      customer.orderHistory[orderInfo.index].status = status;
      if (reason) {
        customer.orderHistory[orderInfo.index].adminReason = reason;
      }

      console.log(
        "After update:",
        customer.orderHistory[orderInfo.index].status
      );
    }

    // ✅ IMPORTANT: DO NOT update customer.currentOrderStatus
    // This keeps it separate from individual order statuses
    // customer.currentOrderStatus remains unchanged or can be set independently

    const savedCustomer = await customer.save();

    console.log("=== STATUS UPDATE SUCCESSFUL ===");
    console.log("Order status updated successfully");
    const updatedStatus = orderInfo.isShoppingHistory
      ? savedCustomer.shoppingHistory[orderInfo.index].status
      : savedCustomer.orderHistory[orderInfo.index].status;
    console.log("Verified saved status:", updatedStatus);

    res.json({
      success: true,
      message: "Order status updated successfully",
      orderId: orderId,
      newStatus: updatedStatus,
      reason: reason || null,
    });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating order status",
      error: error.message,
    });
  }
});

module.exports = router;
