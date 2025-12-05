// routes/deliveryRoutes.js - COMPLETE FIXED WITH PROPER LOCATION DATA EXTRACTION
const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");
const Employee = require("../models/Employee");
const DeliveryTracking = require("../models/Deliverytracking");

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

// ✅ HELPER FUNCTION: Get location data from multiple sources
function getLocationData(customer, order) {
  // Priority 1: Check deliveryAddress in order
  if (order.deliveryAddress?.fullAddress || order.deliveryAddress?.area) {
    return {
      fullAddress: order.deliveryAddress.fullAddress || "",
      area: order.deliveryAddress.area || "",
      nickname: order.deliveryAddress.nickname || "",
      googleMapLink: order.deliveryAddress.googleMapLink || "",
    };
  }

  // Priority 2: Check cart data (during checkout)
  if (customer.cart?.deliveryAddress?.fullAddress) {
    return {
      fullAddress: customer.cart.deliveryAddress.fullAddress || "",
      area: customer.cart.deliveryAddress.area || "",
      nickname: customer.cart.deliveryAddress.nickname || "",
      googleMapLink: customer.cart.deliveryAddress.googleMapLink || "",
    };
  }

  // Priority 3: Check addresses array (saved addresses)
  if (customer.addresses && customer.addresses.length > 0) {
    const defaultAddress =
      customer.addresses.find((a) => a.isDefault) || customer.addresses[0];
    return {
      fullAddress: defaultAddress.fullAddress || "",
      area: defaultAddress.area || "",
      nickname: defaultAddress.nickname || "",
      googleMapLink: defaultAddress.googleMapLink || "",
    };
  }

  // Priority 4: Check contextData (temporary address being filled)
  if (customer.contextData?.tempAddress?.fullAddress) {
    return {
      fullAddress: customer.contextData.tempAddress.fullAddress || "",
      area: customer.contextData.tempAddress.area || "",
      nickname: customer.contextData.tempAddress.nickname || "",
      googleMapLink: customer.contextData.tempAddress.googleMapLink || "",
    };
  }

  // Fallback: Return empty location object
  return {
    fullAddress: "Address not provided",
    area: "Area not specified",
    nickname: "",
    googleMapLink: "",
  };
}

router.post("/initialize-tracking", async (req, res) => {
  try {
    const customers = await Customer.find({
      shoppingHistory: { $exists: true, $ne: [] },
    });
    let createdCount = 0;
    for (let customer of customers) {
      for (let order of customer.shoppingHistory) {
        const existingTracking = await DeliveryTracking.findOne({
          orderId: order.orderId,
        });
        if (!existingTracking) {
          try {
            await DeliveryTracking.createFromCustomerOrder(customer, order);
            createdCount++;
          } catch (error) {
            console.error(
              `Error creating tracking for ${order.orderId}:`,
              error.message
            );
          }
        }
      }
    }
    res.json({ success: true, created: createdCount });
  } catch (error) {
    console.error("Error initializing tracking:", error);
    res.status(500).json({ error: "Failed to initialize tracking" });
  }
});

// ✅ FIXED: Order Overview - EXTRACTS ALL LOCATION DATA FROM MULTIPLE SOURCES
router.get("/orders/overview", async (req, res) => {
  try {
    const { status, priority, search } = req.query;

    let customerQuery = {
      shoppingHistory: {
        $elemMatch: {
          status: {
            $in: [
              "order-confirmed",
              "picking-order",
              "allocated-driver",
              "ready-to-pickup",
              "order-picked-up",
              "on-way",
              "driver-confirmed",
              "order-processed",
            ],
          },
        },
      },
    };

    if (search) {
      customerQuery.$or = [
        { name: { $regex: search, $options: "i" } },
        { phoneNumber: { $elemMatch: { $regex: search, $options: "i" } } },
        { "shoppingHistory.orderId": { $regex: search, $options: "i" } },
        {
          "shoppingHistory.deliveryAddress.area": {
            $regex: search,
            $options: "i",
          },
        },
        { "cart.deliveryAddress.area": { $regex: search, $options: "i" } },
        { "addresses.area": { $regex: search, $options: "i" } },
        { "contextData.tempAddress.area": { $regex: search, $options: "i" } },
      ];
    }

    const customers = await Customer.find(customerQuery);

    let allOrders = [];

    for (let customer of customers) {
      for (let order of customer.shoppingHistory) {
        if (
          ![
            "order-confirmed",
            "picking-order",
            "allocated-driver",
            "ready-to-pickup",
            "order-picked-up",
            "on-way",
            "driver-confirmed",
            "order-processed",
          ].includes(order.status)
        ) {
          continue;
        }

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
        const orderPriority =
          totalAmount >= 200 ? "HIGH" : totalAmount >= 100 ? "MEDIUM" : "LOW";

        if (
          priority &&
          priority !== "All Priorities" &&
          orderPriority !== priority
        ) {
          continue;
        }

        const totalItems = order.items
          ? order.items.reduce((sum, item) => sum + (item.quantity || 1), 0)
          : 0;
        const workflowProgress = getWorkflowProgress(tracking);

        // ✅ GET LOCATION DATA FROM ALL SOURCES
        const locationData = getLocationData(customer, order);

        // ✅ COMPLETE FIELD MAPPING WITH ALL LOCATION DATA FILLED
        const formattedOrder = {
          // Order Identification
          id: order.orderId || `ORD${Date.now()}`,
          orderId: order.orderId || `ORD${Date.now()}`,

          // Customer Details - COMPLETE
          customer: customer.name || "Unknown Customer",
          customerId: customer._id?.toString() || "",
          phone: (customer.phoneNumber && customer.phoneNumber[0]) || "N/A",
          email: customer.email || "Not provided",

          // Location Information - EXTRACTED FROM ALL SOURCES
          location: locationData.area || "Area not specified",
          address: locationData.fullAddress || "Address not provided",
          googleMapLink: locationData.googleMapLink || null,
          mapLink: locationData.googleMapLink || null,
          addressNickname: locationData.nickname || "",
          area: locationData.area || "Area not specified",
          fullAddress: locationData.fullAddress || "Address not provided",

          // Order Items & Pricing
          items: `${totalItems} items`,
          itemsCount: totalItems,
          itemsArray: (order.items || []).map((item) => ({
            productId: item.productId || "",
            productName: item.productName || "Unknown Product",
            category: item.category || "",
            subCategory: item.subCategory || "",
            weight: item.weight || "N/A",
            quantity: item.quantity || 0,
            unitPrice: item.unitPrice || 0,
            totalPrice: item.totalPrice || 0,
            isDiscountedProduct: item.isDiscountedProduct || false,
          })),
          amount: `AED ${(totalAmount || 0).toFixed(2)}`,
          totalAmount: totalAmount || 0,
          deliveryCharge: order.deliveryCharge || 0,
          finalAmount: (totalAmount || 0) + (order.deliveryCharge || 0),

          // Order Status & Priority
          status: mapStatusToDisplay(order.status),
          rawStatus: order.status,
          priority: orderPriority,

          // Workflow & Progress
          progress: workflowProgress,
          workflowProgress: workflowProgress,

          // Delivery Information
          deliveryDate: order.deliveryDate
            ? new Date(order.deliveryDate).toLocaleString()
            : "Not scheduled",
          deliveryDateRaw: order.deliveryDate || null,
          timeSlot: order.timeSlot || "Not specified",
          deliveryType: order.deliveryType || "truck",
          deliverySpeed: order.deliverySpeed || "normal",

          // Driver Assignment
          driver1: order.driver1 || "Not assigned",
          driver2: order.driver2 || "Not assigned",
          assignedDriver: order.driver1 || order.driver2 || "Not assigned",

          // Special Notes & Instructions
          specialInstructions: order.adminReason || "",
          adminReason: order.adminReason || "",
          packingNotes: order.items?.[0]?.packingNotes || "",

          // Complaints & Issues
          hasComplaints:
            (order.complaints && order.complaints.length > 0) || false,
          complaintsCount: order.complaints?.length || 0,
          complaints: order.complaints || [],

          // Verification Status
          storageVerified:
            order.items?.some((item) => item.storageVerified) || false,
          loadingVerified:
            order.items?.some((item) => item.loadingVerified) || false,

          // Payment Information
          paymentStatus: order.paymentStatus || "pending",
          paymentMethod: order.paymentMethod || "Not specified",
          transactionId: order.transactionId || "",
          accountHolderName: order.accountHolderName || "",
          paidBankName: order.paidBankName || "",

          // Order Metadata
          orderDate: order.orderDate
            ? new Date(order.orderDate).toLocaleString()
            : "Unknown",
          orderDateRaw: order.orderDate || null,
          isOverdue: isOrderOverdue(order.deliveryDate),

          // Additional Details
          pickupType: order.pickupType || "heavy-pickup",

          // Customer Details Object (for modal)
          customerDetails: {
            name: customer.name || "Unknown",
            phone: (customer.phoneNumber && customer.phoneNumber[0]) || "N/A",
            email: customer.email || "Not provided",
            address: {
              fullAddress: locationData.fullAddress || "Address not provided",
              area: locationData.area || "Area not specified",
              nickname: locationData.nickname || "",
              googleMapLink: locationData.googleMapLink || "",
            },
            totalOrders:
              (customer.shoppingHistory && customer.shoppingHistory.length) ||
              0,
          },
        };

        allOrders.push(formattedOrder);
      }
    }

    if (status && status !== "All Status") {
      allOrders = allOrders.filter((order) => order.status === status);
    }

    allOrders.sort((a, b) => {
      const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      const priorityDiff =
        priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      const aDate = new Date(a.deliveryDateRaw || a.orderDateRaw || 0);
      const bDate = new Date(b.deliveryDateRaw || b.orderDateRaw || 0);
      return aDate - bDate;
    });

    res.json(allOrders);
  } catch (error) {
    console.error("Error fetching orders overview:", error);
    res.status(500).json({ error: "Failed to fetch orders overview" });
  }
});

router.get("/workflow-status", async (req, res) => {
  try {
    const trackingRecords = await DeliveryTracking.find({ isActive: true });
    const statusCounts = {
      pending: 0,
      packed: 0,
      storage: 0,
      assigned: 0,
      loaded: 0,
      inTransit: 0,
      delivered: 0,
    };

    trackingRecords.forEach((tracking) => {
      const progress = getWorkflowProgress(tracking);
      if (progress.pending) statusCounts.pending++;
      if (progress.packed) statusCounts.packed++;
      if (progress.storage) statusCounts.storage++;
      if (progress.assigned) statusCounts.assigned++;
      if (progress.loaded) statusCounts.loaded++;
      if (progress.inTransit) statusCounts.inTransit++;
      if (progress.delivered) statusCounts.delivered++;
    });

    res.json(statusCounts);
  } catch (error) {
    console.error("Error fetching workflow status:", error);
    res.status(500).json({ error: "Failed to fetch workflow status" });
  }
});

// ✅ FIXED: Order Details - EXTRACTS ALL LOCATION DATA FROM MULTIPLE SOURCES
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
    const tracking = await DeliveryTracking.findOne({ orderId: orderId });

    // ✅ GET LOCATION DATA FROM ALL SOURCES
    const locationData = getLocationData(customer, order);

    const orderDetails = {
      orderId: order.orderId,
      customer: {
        name: customer.name || "Unknown",
        phone: (customer.phoneNumber && customer.phoneNumber[0]) || "",
        email: customer.email || "",
        address: {
          fullAddress: locationData.fullAddress || "Address not provided",
          area: locationData.area || "Area not specified",
          nickname: locationData.nickname || "",
          googleMapLink: locationData.googleMapLink || "",
        },
      },
      items: (order.items || []).map((item) => ({
        productId: item.productId || "",
        productName: item.productName || "Unknown Product",
        category: item.category || "",
        subCategory: item.subCategory || "",
        weight: item.weight || "N/A",
        quantity: item.quantity || 0,
        unitPrice: item.unitPrice || 0,
        totalPrice: item.totalPrice || 0,
        isDiscountedProduct: item.isDiscountedProduct || false,
      })),
      itemsArray: (order.items || []).map((item) => ({
        productId: item.productId || "",
        productName: item.productName || "Unknown Product",
        category: item.category || "",
        subCategory: item.subCategory || "",
        weight: item.weight || "N/A",
        quantity: item.quantity || 0,
        unitPrice: item.unitPrice || 0,
        totalPrice: item.totalPrice || 0,
        isDiscountedProduct: item.isDiscountedProduct || false,
      })),
      itemsCount: order.items ? order.items.length : 0,
      totalAmount: order.totalAmount || 0,
      deliveryCharge: order.deliveryCharge || 0,
      finalAmount: (order.totalAmount || 0) + (order.deliveryCharge || 0),
      status: mapStatusToDisplay(order.status),
      rawStatus: order.status,
      deliveryDate: order.deliveryDate,
      deliveryDateRaw: order.deliveryDate,
      timeSlot: order.timeSlot,
      deliveryType: order.deliveryType || "truck",
      driver1: order.driver1 || "Not assigned",
      driver2: order.driver2 || "Not assigned",
      complaints: order.complaints || [],
      orderDate: order.orderDate,
      paymentStatus: order.paymentStatus || "pending",
      paymentMethod: order.paymentMethod || "Not specified",
      specialInstructions: order.adminReason || "",
      workflowProgress: tracking ? getWorkflowProgress(tracking) : null,
      whatsappPhone: (customer.phoneNumber && customer.phoneNumber[0]) || "",
      // ✅ Google Maps Link
      googleMapLink: locationData.googleMapLink || "",
      area: locationData.area || "Area not specified",
      fullAddress: locationData.fullAddress || "Address not provided",
      nickname: locationData.nickname || "",
    };

    res.json(orderDetails);
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).json({ error: "Failed to fetch order details" });
  }
});

router.put("/orders/:orderId/workflow/:step", async (req, res) => {
  try {
    const { orderId, step } = req.params;
    const { completed, employeeId, employeeName, details } = req.body;

    const tracking = await DeliveryTracking.findOne({ orderId: orderId });
    if (!tracking) {
      return res.status(404).json({ error: "Order tracking not found" });
    }

    const updateDetails = {
      completedBy: {
        employeeId: employeeId || "SYSTEM",
        employeeName: employeeName || "System",
      },
      ...details,
    };
    await tracking.updateWorkflowStatus(step, completed, updateDetails);

    if (step === "packed" && completed) {
      await Customer.updateOne(
        { "shoppingHistory.orderId": orderId },
        { $set: { "shoppingHistory.$.status": "allocated-driver" } }
      );
    }

    res.json({
      success: true,
      message: `Workflow step '${step}' updated`,
      workflowProgress: getWorkflowProgress(tracking),
    });
  } catch (error) {
    console.error("Error updating workflow status:", error);
    res.status(500).json({ error: "Failed to update workflow status" });
  }
});

router.post("/orders/:orderId/whatsapp", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { messageType, customMessage } = req.body;

    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });
    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = customer.shoppingHistory.find((o) => o.orderId === orderId);
    const phone = customer.phoneNumber && customer.phoneNumber[0];

    if (!phone) {
      return res.status(400).json({ error: "Customer phone number not found" });
    }

    let message = customMessage;
    if (!customMessage) {
      switch (messageType) {
        case "status_update":
          message = `Hello ${
            customer.name
          }, your order ${orderId} status has been updated. Current status: ${mapStatusToDisplay(
            order.status
          )}`;
          break;
        case "delivery_notification":
          message = `Hello ${
            customer.name
          }, your order ${orderId} is ready for delivery. Estimated delivery: ${
            order.deliveryDate
              ? new Date(order.deliveryDate).toLocaleDateString()
              : "TBD"
          }`;
          break;
        case "general_inquiry":
          message = `Hello ${customer.name}, regarding your order ${orderId}. How can we help you today?`;
          break;
        default:
          message = `Hello ${customer.name}, regarding your order ${orderId}.`;
      }
    }

    const whatsappUrl = `https://wa.me/${phone.replace(
      /[^0-9]/g,
      ""
    )}?text=${encodeURIComponent(message)}`;

    res.json({
      success: true,
      whatsappUrl: whatsappUrl,
      message: message,
      customerPhone: phone,
    });
  } catch (error) {
    console.error("Error generating WhatsApp URL:", error);
    res.status(500).json({ error: "Failed to generate WhatsApp URL" });
  }
});

router.get("/drivers/available", async (req, res) => {
  try {
    const drivers = await Employee.find({
      employeeCategory: "Driver",
      isActivated: true,
      isBlocked: false,
    }).select("employeeId name email phone roles");

    res.json(drivers);
  } catch (error) {
    console.error("Error fetching available drivers:", error);
    res.status(500).json({ error: "Failed to fetch available drivers" });
  }
});

function mapStatusToDisplay(status) {
  const statusMap = {
    "order-confirmed": "Pending",
    "picking-order": "Packing",
    "allocated-driver": "Assigned",
    "ready-to-pickup": "Ready",
    "order-picked-up": "Loaded",
    "on-way": "In Transit",
    "driver-confirmed": "In Transit",
    "order-processed": "Delivered",
  };
  return statusMap[status] || status;
}

function isOrderOverdue(deliveryDate) {
  if (!deliveryDate) return false;
  const now = new Date();
  const delivery = new Date(deliveryDate);
  return delivery < now;
}

module.exports = router;
