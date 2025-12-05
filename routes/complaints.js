const express = require("express");
const router = express.Router();
const Complaint = require("../models/Complaint");
const Customer = require("../models/customer");

// Submit a new complaint from driver
router.post("/submit", async (req, res) => {
  try {
    const {
      orderId,
      customerId,
      customerName,
      customerPhone,
      driverInfo,
      problemTypes,
      mediaAttachments,
      customerWantsToDo,
      itemReturn,
      solutionCustomerAskingFor,
      additionalNotes,
      deliveryLocation,
      orderValue,
    } = req.body;

    console.log("📝 Submitting complaint for order:", orderId);

    // Validate required fields
    if (
      !orderId ||
      !customerId ||
      !driverInfo ||
      !problemTypes ||
      problemTypes.length === 0
    ) {
      return res.status(400).json({
        error:
          "Missing required fields: orderId, customerId, driverInfo, and problemTypes are required",
      });
    }

    // Create new complaint
    const complaint = new Complaint({
      orderId,
      customerId,
      customerName,
      customerPhone,
      driverInfo,
      problemTypes,
      mediaAttachments: mediaAttachments || [],
      customerWantsToDo: customerWantsToDo || [],
      itemReturn,
      solutionCustomerAskingFor: solutionCustomerAskingFor || [],
      additionalNotes,
      deliveryLocation,
      orderValue: orderValue || 0,
      status: "submitted",
      submittedAt: new Date(),
    });

    const savedComplaint = await complaint.save();

    console.log(
      "✅ Complaint submitted successfully:",
      savedComplaint.complaintId
    );

    // Update customer order with complaint reference
    try {
      const customer = await Customer.findById(customerId);
      if (customer) {
        const orderIndex = customer.shoppingHistory.findIndex(
          (order) => order.orderId === orderId
        );

        if (orderIndex !== -1) {
          // Add complaint to order complaints array
          if (!customer.shoppingHistory[orderIndex].complaints) {
            customer.shoppingHistory[orderIndex].complaints = [];
          }

          customer.shoppingHistory[orderIndex].complaints.push({
            complaintId: savedComplaint.complaintId,
            issueTypes: problemTypes,
            additionalDetails: additionalNotes,
            reportedBy: {
              driverId: driverInfo.driverId,
              driverName: driverInfo.driverName,
            },
            reportedAt: new Date(),
            status: "open",
          });

          // Update order status to indicate complaint
          customer.shoppingHistory[orderIndex].status = "complain-order";

          await customer.save();
          console.log("✅ Updated customer order with complaint reference");
        }
      }
    } catch (customerUpdateError) {
      console.error("⚠️ Failed to update customer order:", customerUpdateError);
      // Don't fail the complaint submission if customer update fails
    }

    res.status(201).json({
      success: true,
      message: "Complaint submitted successfully",
      complaintId: savedComplaint.complaintId,
      complaint: savedComplaint,
    });
  } catch (error) {
    console.error("❌ Error submitting complaint:", error);
    res.status(500).json({
      error: "Failed to submit complaint",
      details: error.message,
    });
  }
});

// Get all complaints for management dashboard
router.get("/management", async (req, res) => {
  try {
    const {
      status,
      priority,
      dateFrom,
      dateTo,
      page = 1,
      limit = 50,
    } = req.query;

    console.log("📊 Fetching complaints for management dashboard");

    const filters = {};
    if (status && status !== "all") filters.status = status;
    if (priority) filters.priority = priority;
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;

    const complaints = await Complaint.getComplaintsForManagement(filters);

    // Paginate results
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedComplaints = complaints.slice(startIndex, endIndex);

    const stats = await Complaint.getDashboardStats();

    console.log(`✅ Retrieved ${complaints.length} complaints for management`);

    res.json({
      success: true,
      complaints: paginatedComplaints,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(complaints.length / limit),
        totalComplaints: complaints.length,
        hasNextPage: endIndex < complaints.length,
        hasPrevPage: page > 1,
      },
      stats,
    });
  } catch (error) {
    console.error("❌ Error fetching complaints for management:", error);
    res.status(500).json({
      error: "Failed to fetch complaints",
      details: error.message,
    });
  }
});

// Get dashboard statistics
router.get("/stats", async (req, res) => {
  try {
    console.log("📊 Fetching complaint dashboard statistics");

    const stats = await Complaint.getDashboardStats();

    // Additional stats
    const recentComplaints = await Complaint.find()
      .sort({ submittedAt: -1 })
      .limit(5)
      .populate("customerId", "name phoneNumber")
      .lean();

    const highPriorityCount = await Complaint.countDocuments({
      priority: { $in: ["high", "urgent"] },
      status: { $in: ["submitted", "under_review", "in_progress"] },
    });

    console.log("✅ Retrieved complaint statistics");

    res.json({
      success: true,
      stats: {
        ...stats,
        highPriorityActive: highPriorityCount,
      },
      recentComplaints,
    });
  } catch (error) {
    console.error("❌ Error fetching complaint statistics:", error);
    res.status(500).json({
      error: "Failed to fetch statistics",
      details: error.message,
    });
  }
});

// Get specific complaint details
router.get("/:complaintId", async (req, res) => {
  try {
    const { complaintId } = req.params;

    console.log(`🔍 Fetching complaint details: ${complaintId}`);

    const complaint = await Complaint.findOne({ complaintId })
      .populate("customerId", "name phoneNumber addresses")
      .lean();

    if (!complaint) {
      return res.status(404).json({
        error: "Complaint not found",
      });
    }

    console.log("✅ Retrieved complaint details");

    res.json({
      success: true,
      complaint,
    });
  } catch (error) {
    console.error("❌ Error fetching complaint details:", error);
    res.status(500).json({
      error: "Failed to fetch complaint details",
      details: error.message,
    });
  }
});

// Update complaint status
router.put("/:complaintId/status", async (req, res) => {
  try {
    const { complaintId } = req.params;
    const { status, staffInfo, notes, resolutionDetails } = req.body;

    console.log(`📝 Updating complaint status: ${complaintId} -> ${status}`);

    const complaint = await Complaint.findOne({ complaintId });

    if (!complaint) {
      return res.status(404).json({
        error: "Complaint not found",
      });
    }

    // Update status using the schema method
    await complaint.updateStatus(status, staffInfo, notes);

    // Add resolution details if provided
    if (resolutionDetails && (status === "resolved" || status === "closed")) {
      complaint.resolution.resolutionDetails = resolutionDetails;
      await complaint.save();
    }

    console.log("✅ Complaint status updated successfully");

    res.json({
      success: true,
      message: "Complaint status updated successfully",
      complaint,
    });
  } catch (error) {
    console.error("❌ Error updating complaint status:", error);
    res.status(500).json({
      error: "Failed to update complaint status",
      details: error.message,
    });
  }
});

// Add manager note to complaint
router.post("/:complaintId/notes", async (req, res) => {
  try {
    const { complaintId } = req.params;
    const { note, staffInfo } = req.body;

    console.log(`📝 Adding note to complaint: ${complaintId}`);

    const complaint = await Complaint.findOne({ complaintId });

    if (!complaint) {
      return res.status(404).json({
        error: "Complaint not found",
      });
    }

    await complaint.addManagerNote(note, staffInfo);

    console.log("✅ Note added to complaint successfully");

    res.json({
      success: true,
      message: "Note added successfully",
      complaint,
    });
  } catch (error) {
    console.error("❌ Error adding note to complaint:", error);
    res.status(500).json({
      error: "Failed to add note",
      details: error.message,
    });
  }
});

// Get complaints by driver
router.get("/driver/:driverId", async (req, res) => {
  try {
    const { driverId } = req.params;
    const { status, limit = 20 } = req.query;

    console.log(`🚛 Fetching complaints for driver: ${driverId}`);

    const query = { "driverInfo.driverId": driverId };
    if (status) query.status = status;

    const complaints = await Complaint.find(query)
      .sort({ submittedAt: -1 })
      .limit(parseInt(limit))
      .populate("customerId", "name phoneNumber")
      .lean();

    console.log(`✅ Retrieved ${complaints.length} complaints for driver`);

    res.json({
      success: true,
      complaints,
      count: complaints.length,
    });
  } catch (error) {
    console.error("❌ Error fetching driver complaints:", error);
    res.status(500).json({
      error: "Failed to fetch driver complaints",
      details: error.message,
    });
  }
});

// Get complaints by order
router.get("/order/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    console.log(`📦 Fetching complaints for order: ${orderId}`);

    const complaints = await Complaint.find({ orderId })
      .sort({ submittedAt: -1 })
      .populate("customerId", "name phoneNumber")
      .lean();

    console.log(`✅ Retrieved ${complaints.length} complaints for order`);

    res.json({
      success: true,
      complaints,
      count: complaints.length,
    });
  } catch (error) {
    console.error("❌ Error fetching order complaints:", error);
    res.status(500).json({
      error: "Failed to fetch order complaints",
      details: error.message,
    });
  }
});

// Upload additional media to existing complaint
router.post("/:complaintId/media", async (req, res) => {
  try {
    const { complaintId } = req.params;
    const { mediaAttachments } = req.body;

    console.log(`📎 Adding media to complaint: ${complaintId}`);

    const complaint = await Complaint.findOne({ complaintId });

    if (!complaint) {
      return res.status(404).json({
        error: "Complaint not found",
      });
    }

    // Add new media attachments
    if (mediaAttachments && mediaAttachments.length > 0) {
      complaint.mediaAttachments.push(...mediaAttachments);
      complaint.lastUpdated = new Date();
      await complaint.save();
    }

    console.log("✅ Media added to complaint successfully");

    res.json({
      success: true,
      message: "Media added successfully",
      mediaCount: complaint.mediaAttachments.length,
    });
  } catch (error) {
    console.error("❌ Error adding media to complaint:", error);
    res.status(500).json({
      error: "Failed to add media",
      details: error.message,
    });
  }
});

// Delete complaint (soft delete by setting status to closed)
router.delete("/:complaintId", async (req, res) => {
  try {
    const { complaintId } = req.params;
    const { staffInfo, reason } = req.body;

    console.log(`🗑️ Deleting complaint: ${complaintId}`);

    const complaint = await Complaint.findOne({ complaintId });

    if (!complaint) {
      return res.status(404).json({
        error: "Complaint not found",
      });
    }

    await complaint.updateStatus(
      "closed",
      staffInfo,
      `Complaint deleted: ${reason}`
    );

    console.log("✅ Complaint deleted successfully");

    res.json({
      success: true,
      message: "Complaint deleted successfully",
    });
  } catch (error) {
    console.error("❌ Error deleting complaint:", error);
    res.status(500).json({
      error: "Failed to delete complaint",
      details: error.message,
    });
  }
});

module.exports = router;
