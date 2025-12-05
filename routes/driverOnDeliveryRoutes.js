// routes/driverOnDeliveryRoutes.js - COMPLETE IMPLEMENTATION

const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");
const DeliveryTracking = require("../models/Deliverytracking");
const multer = require("multer");

// Configure multer for multiple file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB for videos
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype.startsWith("image/") ||
      file.mimetype.startsWith("video/")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only image and video files are allowed!"), false);
    }
  },
});

// Get active deliveries
router.get("/active-deliveries", async (req, res) => {
  try {
    const { driverId } = req.query;

    const customers = await Customer.find({
      "shoppingHistory.status": "on-way",
    }).lean();

    let activeDeliveries = [];

    for (let customer of customers) {
      for (let order of customer.shoppingHistory) {
        if (order.status === "on-way") {
          if (driverId && order.routeStartedBy?.driverId !== driverId) {
            continue;
          }

          // Check delivery media completion
          const hasDeliveryMedia =
            order.deliveryMedia && order.deliveryMedia.allMediaUploaded;

          activeDeliveries.push({
            orderId: order.orderId,
            customerName: customer.name,
            customerPhone: customer.phoneNumber[0] || "",
            deliveryDate: order.deliveryDate,
            timeSlot: order.timeSlot || "",
            deliveryAddress: order.deliveryAddress,
            specialInstructions: order.adminReason || "",
            items: order.items || [],
            totalItems: order.items ? order.items.length : 0,
            isArrived: order.arrivedAt ? true : false,
            arrivedAt: order.arrivedAt,
            deliveryMedia: order.deliveryMedia || {},
            hasDeliveryMedia: hasDeliveryMedia,
          });
        }
      }
    }

    res.json(activeDeliveries);
  } catch (error) {
    console.error("Error fetching active deliveries:", error);
    res.status(500).json({ error: "Failed to fetch active deliveries" });
  }
});

// Mark as arrived
router.post("/mark-arrived/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { driverId, driverName, location } = req.body;

    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const orderIndex = customer.shoppingHistory.findIndex(
      (o) => o.orderId === orderId
    );

    customer.shoppingHistory[orderIndex].arrivedAt = new Date();
    customer.shoppingHistory[orderIndex].arrivedBy = {
      driverId: driverId,
      driverName: driverName,
    };

    // Initialize deliveryMedia if not exists
    if (!customer.shoppingHistory[orderIndex].deliveryMedia) {
      customer.shoppingHistory[orderIndex].deliveryMedia = {
        allMediaUploaded: false,
        allMediaVerified: false,
        hasCustomerComplaints: false,
      };
    }

    await customer.save();

    console.log(`✅ Driver marked as arrived for order ${orderId}`);

    res.json({
      success: true,
      message: `Marked as arrived for order ${orderId}`,
      arrivedAt: new Date(),
    });
  } catch (error) {
    console.error("Error marking as arrived:", error);
    res.status(500).json({ error: "Failed to mark as arrived" });
  }
});

// 1. Upload DELIVERY VIDEO (MANDATORY)
router.post(
  "/upload-delivery-video/:orderId",
  upload.single("deliveryVideo"),
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { driverId, driverName, videoDetails } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: "No video file uploaded" });
      }

      console.log(`📹 Uploading delivery video for order ${orderId}`);

      const customer = await Customer.findOne({
        "shoppingHistory.orderId": orderId,
      });

      if (!customer) {
        return res.status(404).json({ error: "Order not found" });
      }

      const orderIndex = customer.shoppingHistory.findIndex(
        (o) => o.orderId === orderId
      );

      if (!customer.shoppingHistory[orderIndex].deliveryMedia) {
        customer.shoppingHistory[orderIndex].deliveryMedia = {};
      }

      const base64Data = req.file.buffer.toString("base64");

      customer.shoppingHistory[orderIndex].deliveryMedia.deliveryVideo = {
        videoId: `DELVID_${Date.now()}`,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        fileSize: req.file.size,
        base64Data: base64Data,
        uploadedAt: new Date(),
        uploadedBy: {
          driverId: driverId,
          driverName: driverName,
        },
        videoDetails: videoDetails ? JSON.parse(videoDetails) : {},
        verificationStatus: "pending",
      };

      await customer.save();

      console.log(`✅ Delivery video uploaded for order ${orderId}`);

      res.json({
        success: true,
        message: "Delivery video uploaded successfully",
        videoId: `DELVID_${Date.now()}`,
      });
    } catch (error) {
      console.error("Error uploading delivery video:", error);
      res.status(500).json({ error: "Failed to upload delivery video" });
    }
  }
);

// 2. Upload COMPLAINT VIDEO (CONDITIONAL)
router.post(
  "/upload-complaint-video/:orderId",
  upload.single("complaintVideo"),
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { driverId, driverName, complaintDetails } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: "No video file uploaded" });
      }

      console.log(`📹 Uploading complaint video for order ${orderId}`);

      const customer = await Customer.findOne({
        "shoppingHistory.orderId": orderId,
      });

      if (!customer) {
        return res.status(404).json({ error: "Order not found" });
      }

      const orderIndex = customer.shoppingHistory.findIndex(
        (o) => o.orderId === orderId
      );

      if (!customer.shoppingHistory[orderIndex].deliveryMedia) {
        customer.shoppingHistory[orderIndex].deliveryMedia = {};
      }

      const base64Data = req.file.buffer.toString("base64");

      customer.shoppingHistory[orderIndex].deliveryMedia.complaintVideo = {
        videoId: `COMPVID_${Date.now()}`,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        fileSize: req.file.size,
        base64Data: base64Data,
        uploadedAt: new Date(),
        uploadedBy: {
          driverId: driverId,
          driverName: driverName,
        },
        complaintDetails: complaintDetails ? JSON.parse(complaintDetails) : {},
        verificationStatus: "pending",
      };

      customer.shoppingHistory[
        orderIndex
      ].deliveryMedia.hasCustomerComplaints = true;

      await customer.save();

      console.log(`✅ Complaint video uploaded for order ${orderId}`);

      res.json({
        success: true,
        message: "Complaint video uploaded successfully",
        videoId: `COMPVID_${Date.now()}`,
      });
    } catch (error) {
      console.error("Error uploading complaint video:", error);
      res.status(500).json({ error: "Failed to upload complaint video" });
    }
  }
);

// 3. Upload ENTRANCE PHOTO (MANDATORY)
router.post(
  "/upload-entrance-photo/:orderId",
  upload.single("entrancePhoto"),
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { driverId, driverName } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: "No photo uploaded" });
      }

      console.log(`📸 Uploading entrance photo for order ${orderId}`);

      const customer = await Customer.findOne({
        "shoppingHistory.orderId": orderId,
      });

      if (!customer) {
        return res.status(404).json({ error: "Order not found" });
      }

      const orderIndex = customer.shoppingHistory.findIndex(
        (o) => o.orderId === orderId
      );

      if (!customer.shoppingHistory[orderIndex].deliveryMedia) {
        customer.shoppingHistory[orderIndex].deliveryMedia = {};
      }

      const base64Data = req.file.buffer.toString("base64");

      customer.shoppingHistory[orderIndex].deliveryMedia.entrancePhoto = {
        photoId: `ENTRANCE_${Date.now()}`,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        fileSize: req.file.size,
        base64Data: base64Data,
        uploadedAt: new Date(),
        uploadedBy: {
          driverId: driverId,
          driverName: driverName,
        },
        verificationStatus: "pending",
      };

      await customer.save();

      console.log(`✅ Entrance photo uploaded for order ${orderId}`);

      res.json({
        success: true,
        message: "Entrance photo uploaded successfully",
        photoId: `ENTRANCE_${Date.now()}`,
      });
    } catch (error) {
      console.error("Error uploading entrance photo:", error);
      res.status(500).json({ error: "Failed to upload entrance photo" });
    }
  }
);

// 4. Upload RECEIPT IN HAND PHOTO (MANDATORY)
router.post(
  "/upload-receipt-in-hand/:orderId",
  upload.single("receiptInHandPhoto"),
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { driverId, driverName } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: "No photo uploaded" });
      }

      console.log(`📸 Uploading receipt-in-hand photo for order ${orderId}`);

      const customer = await Customer.findOne({
        "shoppingHistory.orderId": orderId,
      });

      if (!customer) {
        return res.status(404).json({ error: "Order not found" });
      }

      const orderIndex = customer.shoppingHistory.findIndex(
        (o) => o.orderId === orderId
      );

      if (!customer.shoppingHistory[orderIndex].deliveryMedia) {
        customer.shoppingHistory[orderIndex].deliveryMedia = {};
      }

      const base64Data = req.file.buffer.toString("base64");

      customer.shoppingHistory[orderIndex].deliveryMedia.receiptInHandPhoto = {
        photoId: `RECEIPT_HAND_${Date.now()}`,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        fileSize: req.file.size,
        base64Data: base64Data,
        uploadedAt: new Date(),
        uploadedBy: {
          driverId: driverId,
          driverName: driverName,
        },
        verificationStatus: "pending",
      };

      await customer.save();

      console.log(`✅ Receipt-in-hand photo uploaded for order ${orderId}`);

      res.json({
        success: true,
        message: "Receipt-in-hand photo uploaded successfully",
        photoId: `RECEIPT_HAND_${Date.now()}`,
      });
    } catch (error) {
      console.error("Error uploading receipt-in-hand photo:", error);
      res.status(500).json({ error: "Failed to upload receipt-in-hand photo" });
    }
  }
);

// 5. Upload RECEIPT CLOSE-UP PHOTO (MANDATORY)
router.post(
  "/upload-receipt-closeup/:orderId",
  upload.single("receiptCloseUpPhoto"),
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { driverId, driverName } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: "No photo uploaded" });
      }

      console.log(`📸 Uploading receipt close-up photo for order ${orderId}`);

      const customer = await Customer.findOne({
        "shoppingHistory.orderId": orderId,
      });

      if (!customer) {
        return res.status(404).json({ error: "Order not found" });
      }

      const orderIndex = customer.shoppingHistory.findIndex(
        (o) => o.orderId === orderId
      );

      if (!customer.shoppingHistory[orderIndex].deliveryMedia) {
        customer.shoppingHistory[orderIndex].deliveryMedia = {};
      }

      const base64Data = req.file.buffer.toString("base64");

      customer.shoppingHistory[orderIndex].deliveryMedia.receiptCloseUpPhoto = {
        photoId: `RECEIPT_CLOSEUP_${Date.now()}`,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        fileSize: req.file.size,
        base64Data: base64Data,
        uploadedAt: new Date(),
        uploadedBy: {
          driverId: driverId,
          driverName: driverName,
        },
        verificationStatus: "pending",
      };

      await customer.save();

      console.log(`✅ Receipt close-up photo uploaded for order ${orderId}`);

      res.json({
        success: true,
        message: "Receipt close-up photo uploaded successfully",
        photoId: `RECEIPT_CLOSEUP_${Date.now()}`,
      });
    } catch (error) {
      console.error("Error uploading receipt close-up photo:", error);
      res
        .status(500)
        .json({ error: "Failed to upload receipt close-up photo" });
    }
  }
);

// 6. Upload RECEIPT NEXT TO FACE PHOTO (MANDATORY)
router.post(
  "/upload-receipt-next-to-face/:orderId",
  upload.single("receiptNextToFacePhoto"),
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const { driverId, driverName } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: "No photo uploaded" });
      }

      console.log(
        `📸 Uploading receipt-next-to-face photo for order ${orderId}`
      );

      const customer = await Customer.findOne({
        "shoppingHistory.orderId": orderId,
      });

      if (!customer) {
        return res.status(404).json({ error: "Order not found" });
      }

      const orderIndex = customer.shoppingHistory.findIndex(
        (o) => o.orderId === orderId
      );

      if (!customer.shoppingHistory[orderIndex].deliveryMedia) {
        customer.shoppingHistory[orderIndex].deliveryMedia = {};
      }

      const base64Data = req.file.buffer.toString("base64");

      customer.shoppingHistory[
        orderIndex
      ].deliveryMedia.receiptNextToFacePhoto = {
        photoId: `RECEIPT_FACE_${Date.now()}`,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        fileSize: req.file.size,
        base64Data: base64Data,
        uploadedAt: new Date(),
        uploadedBy: {
          driverId: driverId,
          driverName: driverName,
        },
        verificationStatus: "pending",
      };

      await customer.save();

      console.log(
        `✅ Receipt-next-to-face photo uploaded for order ${orderId}`
      );

      res.json({
        success: true,
        message: "Receipt-next-to-face photo uploaded successfully",
        photoId: `RECEIPT_FACE_${Date.now()}`,
      });
    } catch (error) {
      console.error("Error uploading receipt-next-to-face photo:", error);
      res
        .status(500)
        .json({ error: "Failed to upload receipt-next-to-face photo" });
    }
  }
);

// Mark customer has complaints
router.post("/mark-has-complaints/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { hasComplaints, complaintDescription } = req.body;

    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Order not found" });
    }

    const orderIndex = customer.shoppingHistory.findIndex(
      (o) => o.orderId === orderId
    );

    if (!customer.shoppingHistory[orderIndex].deliveryMedia) {
      customer.shoppingHistory[orderIndex].deliveryMedia = {};
    }

    customer.shoppingHistory[orderIndex].deliveryMedia.hasCustomerComplaints =
      hasComplaints;
    customer.shoppingHistory[orderIndex].deliveryMedia.complaintDescription =
      complaintDescription || "";

    await customer.save();

    res.json({
      success: true,
      message: "Complaint status updated",
      hasComplaints: hasComplaints,
    });
  } catch (error) {
    console.error("Error marking complaints:", error);
    res.status(500).json({ error: "Failed to mark complaints" });
  }
});

// Complete delivery - ONLY with ALL required media
router.post("/complete-delivery/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const {
      driverId,
      driverName,
      customerConfirmed,
      deliveryNotes,
      customerSatisfaction,
    } = req.body;

    console.log(`🎉 Attempting to complete delivery for order ${orderId}`);

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

    // ✅ CRITICAL: Check ALL required media is uploaded
    const media = order.deliveryMedia || {};

    // Check mandatory items
    if (!media.deliveryVideo || !media.deliveryVideo.base64Data) {
      return res.status(400).json({
        error: "❌ DELIVERY VIDEO REQUIRED",
        details: "You must upload the delivery video before completing",
      });
    }

    if (!media.entrancePhoto || !media.entrancePhoto.base64Data) {
      return res.status(400).json({
        error: "❌ ENTRANCE PHOTO REQUIRED",
        details: "You must upload the entrance photo before completing",
      });
    }

    if (!media.receiptInHandPhoto || !media.receiptInHandPhoto.base64Data) {
      return res.status(400).json({
        error: "❌ RECEIPT IN HAND PHOTO REQUIRED",
        details:
          "You must upload the photo of person holding receipt before completing",
      });
    }

    if (!media.receiptCloseUpPhoto || !media.receiptCloseUpPhoto.base64Data) {
      return res.status(400).json({
        error: "❌ RECEIPT CLOSE-UP PHOTO REQUIRED",
        details: "You must upload the receipt close-up photo before completing",
      });
    }

    if (
      !media.receiptNextToFacePhoto ||
      !media.receiptNextToFacePhoto.base64Data
    ) {
      return res.status(400).json({
        error: "❌ RECEIPT NEXT TO FACE PHOTO REQUIRED",
        details:
          "You must upload the receipt next to face photo before completing",
      });
    }

    // If customer has complaints, complaint video is required
    if (media.hasCustomerComplaints) {
      if (!media.complaintVideo || !media.complaintVideo.base64Data) {
        return res.status(400).json({
          error: "❌ COMPLAINT VIDEO REQUIRED",
          details:
            "Customer has complaints - you must upload the complaint video before completing",
        });
      }
    }

    if (!customerConfirmed) {
      return res.status(400).json({
        error: "❌ CUSTOMER CONFIRMATION REQUIRED",
        details: "Customer must confirm receipt of delivery",
      });
    }

    console.log(`✅ All media checks passed for order ${orderId}`);

    // Mark all media as uploaded
    customer.shoppingHistory[orderIndex].deliveryMedia.allMediaUploaded = true;
    customer.shoppingHistory[orderIndex].deliveryMedia.uploadCompletedAt =
      new Date();

    // Update order status to "order-complete"
    customer.shoppingHistory[orderIndex].status = "order-complete";
    customer.shoppingHistory[orderIndex].deliveredAt = new Date();
    customer.shoppingHistory[orderIndex].deliveredBy = {
      driverId: driverId,
      driverName: driverName,
    };
    customer.shoppingHistory[orderIndex].customerConfirmed =
      Boolean(customerConfirmed);
    customer.shoppingHistory[orderIndex].deliveryNotes = deliveryNotes || "";
    customer.shoppingHistory[orderIndex].customerSatisfaction =
      customerSatisfaction || 5;

    await customer.save();

    console.log(`✅ Order ${orderId} marked as order-complete`);

    // Update DeliveryTracking
    const tracking = await DeliveryTracking.findOne({ orderId: orderId });
    if (tracking) {
      tracking.workflowStatus.delivered.completed = true;
      tracking.workflowStatus.delivered.completedAt = new Date();
      tracking.workflowStatus.delivered.deliveredBy = {
        employeeId: driverId,
        employeeName: driverName,
      };
      tracking.currentStatus = "order-complete";
      await tracking.save();
    }

    console.log(`🎉 Order ${orderId} COMPLETED with all media!`);

    res.json({
      success: true,
      message: `Order ${orderId} delivered successfully with all required media`,
      deliveredAt: new Date(),
      newStatus: "order-complete",
      mediaUploaded: {
        deliveryVideo: true,
        entrancePhoto: true,
        receiptInHand: true,
        receiptCloseUp: true,
        receiptNextToFace: true,
        complaintVideo: media.hasCustomerComplaints ? true : "not required",
      },
    });
  } catch (error) {
    console.error("Error completing delivery:", error);
    res.status(500).json({ error: "Failed to complete delivery" });
  }
});

// Get stats
router.get("/stats", async (req, res) => {
  try {
    const { driverId } = req.query;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const customers = await Customer.find({
      "shoppingHistory.status": {
        $in: ["on-way", "order-complete"],
      },
    }).lean();

    let stats = {
      totalDeliveries: 0,
      completed: 0,
      inProgress: 0,
      todayDeliveries: 0,
    };

    for (let customer of customers) {
      for (let order of customer.shoppingHistory) {
        if (driverId) {
          const orderDriverId =
            order.routeStartedBy?.driverId || order.deliveredBy?.driverId;
          if (orderDriverId !== driverId) {
            continue;
          }
        }

        if (order.status === "on-way") {
          stats.totalDeliveries++;
          stats.inProgress++;

          if (order.routeStartedAt && new Date(order.routeStartedAt) >= today) {
            stats.todayDeliveries++;
          }
        } else if (order.status === "order-complete") {
          stats.totalDeliveries++;
          stats.completed++;

          if (order.deliveredAt && new Date(order.deliveredAt) >= today) {
            stats.todayDeliveries++;
          }
        }
      }
    }

    res.json(stats);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Get order details
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
      arrivedAt: order.arrivedAt,
      deliveryMedia: order.deliveryMedia || {},
      deliveredAt: order.deliveredAt,
      customerConfirmed: order.customerConfirmed,
    };

    res.json(orderDetails);
  } catch (error) {
    console.error("Error fetching order details:", error);
    res.status(500).json({ error: "Failed to fetch order details" });
  }
});

module.exports = router;
