// routes/support.js
const express = require("express");
const router = express.Router();
const Customer = require("../models/customer"); // Adjust path as needed

// Helper function to calculate average resolution time
const calculateAvgResolutionTime = (tickets) => {
  const resolvedTickets = tickets.filter(
    (t) => t.status === "resolved" && t.resolvedAt
  );
  if (resolvedTickets.length === 0) return "0h";

  const totalTime = resolvedTickets.reduce((sum, ticket) => {
    const created = new Date(ticket.createdAt);
    const resolved = new Date(ticket.resolvedAt);
    return sum + (resolved - created);
  }, 0);

  const avgHours = Math.round(
    totalTime / (resolvedTickets.length * 1000 * 60 * 60)
  );
  return `${avgHours}h`;
};

// Helper function to format customer data
const formatCustomerData = (customer) => ({
  customerId: customer._id,
  customerName: customer.name,
  customerPhone: customer.phoneNumber[0],
  customerEmail: customer.contextData?.email || null,
});

// GET /api/support/dashboard - Main dashboard data
router.get("/dashboard", async (req, res) => {
  try {
    // Get all customers with support data
    const customers = await Customer.find({
      $or: [
        { "supportTickets.0": { $exists: true } },
        { "complaints.0": { $exists: true } },
        { "paymentIssues.0": { $exists: true } },
        { "addressChangeHistory.0": { $exists: true } },
      ],
    });

    // Flatten all support tickets with customer info
    const allTickets = [];
    const allComplaints = [];
    const allPaymentIssues = [];
    const allAddressChanges = [];
    const allFaqInteractions = [];
    const allSupportMedia = [];

    customers.forEach((customer) => {
      const customerInfo = formatCustomerData(customer);

      // Process support tickets
      if (customer.supportTickets) {
        customer.supportTickets.forEach((ticket) => {
          allTickets.push({
            ...ticket.toObject(),
            ...customerInfo,
          });
        });
      }

      // Process complaints
      if (customer.complaints) {
        customer.complaints.forEach((complaint) => {
          allComplaints.push({
            ...complaint.toObject(),
            ...customerInfo,
          });
        });
      }

      // Process payment issues
      if (customer.paymentIssues) {
        customer.paymentIssues.forEach((issue) => {
          allPaymentIssues.push({
            ...issue.toObject(),
            ...customerInfo,
          });
        });
      }

      // Process address changes
      if (customer.addressChangeHistory) {
        customer.addressChangeHistory.forEach((change) => {
          allAddressChanges.push({
            ...change.toObject(),
            ...customerInfo,
          });
        });
      }

      // Process FAQ interactions
      if (customer.faqInteractions) {
        customer.faqInteractions.forEach((faq) => {
          allFaqInteractions.push({
            ...faq.toObject(),
            ...customerInfo,
          });
        });
      }

      // Process support media
      if (customer.supportMedia) {
        customer.supportMedia.forEach((media) => {
          allSupportMedia.push({
            ...media.toObject(),
            ...customerInfo,
          });
        });
      }
    });

    // Calculate overview statistics
    const overview = {
      totalTickets: allTickets.length,
      openTickets: allTickets.filter((t) => t.status === "open").length,
      resolvedTickets: allTickets.filter((t) => t.status === "resolved").length,
      avgResolutionTime: calculateAvgResolutionTime(allTickets),
      customerSatisfaction: 4.2, // This could be calculated from feedback if available
    };

    res.json({
      tickets: allTickets.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      ),
      complaints: allComplaints.sort(
        (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
      ),
      paymentIssues: allPaymentIssues.sort(
        (a, b) => new Date(b.reportedAt) - new Date(a.reportedAt)
      ),
      addressChanges: allAddressChanges.sort(
        (a, b) => new Date(b.requestedAt) - new Date(a.requestedAt)
      ),
      faqInteractions: allFaqInteractions.sort(
        (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
      ),
      supportMedia: allSupportMedia.sort(
        (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)
      ),
      overview,
    });
  } catch (error) {
    console.error("Error fetching support dashboard:", error);
    res.status(500).json({ error: "Failed to fetch support data" });
  }
});

// GET /api/support/tickets - Get all support tickets
router.get("/tickets", async (req, res) => {
  try {
    const { status, priority, type, page = 1, limit = 50 } = req.query;

    const customers = await Customer.find({
      "supportTickets.0": { $exists: true },
    });

    let allTickets = [];
    customers.forEach((customer) => {
      const customerInfo = formatCustomerData(customer);
      if (customer.supportTickets) {
        customer.supportTickets.forEach((ticket) => {
          allTickets.push({
            ...ticket.toObject(),
            ...customerInfo,
          });
        });
      }
    });

    // Apply filters
    if (status && status !== "all") {
      allTickets = allTickets.filter((t) => t.status === status);
    }
    if (priority && priority !== "all") {
      allTickets = allTickets.filter((t) => t.priority === priority);
    }
    if (type && type !== "all") {
      allTickets = allTickets.filter((t) => t.type === type);
    }

    // Sort by creation date (newest first)
    allTickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedTickets = allTickets.slice(startIndex, endIndex);

    res.json({
      tickets: paginatedTickets,
      totalCount: allTickets.length,
      page: parseInt(page),
      totalPages: Math.ceil(allTickets.length / limit),
    });
  } catch (error) {
    console.error("Error fetching tickets:", error);
    res.status(500).json({ error: "Failed to fetch tickets" });
  }
});

// GET /api/support/tickets/:ticketId - Get specific ticket details
router.get("/tickets/:ticketId", async (req, res) => {
  try {
    const { ticketId } = req.params;

    const customer = await Customer.findOne({
      "supportTickets.ticketId": ticketId,
    });
    if (!customer) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const ticket = customer.supportTickets.find((t) => t.ticketId === ticketId);
    const customerInfo = formatCustomerData(customer);

    res.json({
      ...ticket.toObject(),
      ...customerInfo,
    });
  } catch (error) {
    console.error("Error fetching ticket details:", error);
    res.status(500).json({ error: "Failed to fetch ticket details" });
  }
});

// PUT /api/support/tickets/:ticketId/status - Update ticket status
router.put("/tickets/:ticketId/status", async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status } = req.body;

    const customer = await Customer.findOne({
      "supportTickets.ticketId": ticketId,
    });
    if (!customer) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const ticket = customer.supportTickets.find((t) => t.ticketId === ticketId);
    ticket.status = status;
    ticket.lastUpdated = new Date();

    if (status === "resolved") {
      ticket.resolvedAt = new Date();
    }

    await customer.save();

    res.json({ message: "Ticket status updated successfully", ticket });
  } catch (error) {
    console.error("Error updating ticket status:", error);
    res.status(500).json({ error: "Failed to update ticket status" });
  }
});

// PUT /api/support/tickets/:ticketId/priority - Update ticket priority
router.put("/tickets/:ticketId/priority", async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { priority } = req.body;

    const customer = await Customer.findOne({
      "supportTickets.ticketId": ticketId,
    });
    if (!customer) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const ticket = customer.supportTickets.find((t) => t.ticketId === ticketId);
    ticket.priority = priority;
    ticket.lastUpdated = new Date();

    await customer.save();

    res.json({ message: "Ticket priority updated successfully", ticket });
  } catch (error) {
    console.error("Error updating ticket priority:", error);
    res.status(500).json({ error: "Failed to update ticket priority" });
  }
});

// POST /api/support/tickets/:ticketId/notes - Add notes to ticket
router.post("/tickets/:ticketId/notes", async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { notes } = req.body;

    const customer = await Customer.findOne({
      "supportTickets.ticketId": ticketId,
    });
    if (!customer) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const ticket = customer.supportTickets.find((t) => t.ticketId === ticketId);
    ticket.agentNotes = notes;
    ticket.lastUpdated = new Date();

    await customer.save();

    res.json({ message: "Notes added successfully", ticket });
  } catch (error) {
    console.error("Error adding notes:", error);
    res.status(500).json({ error: "Failed to add notes" });
  }
});

// GET /api/support/complaints - Get all complaints
router.get("/complaints", async (req, res) => {
  try {
    const customers = await Customer.find({
      "complaints.0": { $exists: true },
    });

    let allComplaints = [];
    customers.forEach((customer) => {
      const customerInfo = formatCustomerData(customer);
      if (customer.complaints) {
        customer.complaints.forEach((complaint) => {
          allComplaints.push({
            ...complaint.toObject(),
            ...customerInfo,
          });
        });
      }
    });

    // Sort by submission date (newest first)
    allComplaints.sort(
      (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
    );

    res.json({ complaints: allComplaints });
  } catch (error) {
    console.error("Error fetching complaints:", error);
    res.status(500).json({ error: "Failed to fetch complaints" });
  }
});

// GET /api/support/payment-issues - Get all payment issues
router.get("/payment-issues", async (req, res) => {
  try {
    const customers = await Customer.find({
      "paymentIssues.0": { $exists: true },
    });

    let allPaymentIssues = [];
    customers.forEach((customer) => {
      const customerInfo = formatCustomerData(customer);
      if (customer.paymentIssues) {
        customer.paymentIssues.forEach((issue) => {
          allPaymentIssues.push({
            ...issue.toObject(),
            ...customerInfo,
          });
        });
      }
    });

    // Sort by report date (newest first)
    allPaymentIssues.sort(
      (a, b) => new Date(b.reportedAt) - new Date(a.reportedAt)
    );

    res.json({ paymentIssues: allPaymentIssues });
  } catch (error) {
    console.error("Error fetching payment issues:", error);
    res.status(500).json({ error: "Failed to fetch payment issues" });
  }
});

// PUT /api/support/payment-issues/:issueId/status - Update payment issue status
router.put("/payment-issues/:issueId/status", async (req, res) => {
  try {
    const { issueId } = req.params;
    const { status } = req.body;

    const customer = await Customer.findOne({
      "paymentIssues.issueId": issueId,
    });
    if (!customer) {
      return res.status(404).json({ error: "Payment issue not found" });
    }

    const issue = customer.paymentIssues.find((i) => i.issueId === issueId);
    issue.status = status;

    if (status === "resolved") {
      issue.resolvedAt = new Date();
    }

    await customer.save();

    res.json({ message: "Payment issue status updated successfully", issue });
  } catch (error) {
    console.error("Error updating payment issue status:", error);
    res.status(500).json({ error: "Failed to update payment issue status" });
  }
});

// GET /api/support/address-changes - Get all address change requests
router.get("/address-changes", async (req, res) => {
  try {
    const customers = await Customer.find({
      "addressChangeHistory.0": { $exists: true },
    });

    let allAddressChanges = [];
    customers.forEach((customer) => {
      const customerInfo = formatCustomerData(customer);
      if (customer.addressChangeHistory) {
        customer.addressChangeHistory.forEach((change) => {
          allAddressChanges.push({
            ...change.toObject(),
            ...customerInfo,
          });
        });
      }
    });

    // Sort by request date (newest first)
    allAddressChanges.sort(
      (a, b) => new Date(b.requestedAt) - new Date(a.requestedAt)
    );

    res.json({ addressChanges: allAddressChanges });
  } catch (error) {
    console.error("Error fetching address changes:", error);
    res.status(500).json({ error: "Failed to fetch address changes" });
  }
});

// PUT /api/support/address-changes/:orderId/approve - Approve address change
router.put("/address-changes/:orderId/approve", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { extraCharges = 0 } = req.body;

    const customer = await Customer.findOne({
      "addressChangeHistory.orderId": orderId,
    });
    if (!customer) {
      return res
        .status(404)
        .json({ error: "Address change request not found" });
    }

    const changeRequest = customer.addressChangeHistory.find(
      (c) => c.orderId === orderId
    );
    changeRequest.status = "approved";
    changeRequest.extraCharges = extraCharges;
    changeRequest.approvedAt = new Date();

    await customer.save();

    res.json({
      message: "Address change approved successfully",
      changeRequest,
    });
  } catch (error) {
    console.error("Error approving address change:", error);
    res.status(500).json({ error: "Failed to approve address change" });
  }
});

// PUT /api/support/address-changes/:orderId/reject - Reject address change
router.put("/address-changes/:orderId/reject", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { reason } = req.body;

    const customer = await Customer.findOne({
      "addressChangeHistory.orderId": orderId,
    });
    if (!customer) {
      return res
        .status(404)
        .json({ error: "Address change request not found" });
    }

    const changeRequest = customer.addressChangeHistory.find(
      (c) => c.orderId === orderId
    );
    changeRequest.status = "rejected";
    changeRequest.rejectionReason = reason;

    await customer.save();

    res.json({
      message: "Address change rejected successfully",
      changeRequest,
    });
  } catch (error) {
    console.error("Error rejecting address change:", error);
    res.status(500).json({ error: "Failed to reject address change" });
  }
});

// GET /api/support/media/:mediaId/download - Download media file
router.get("/media/:mediaId/download", async (req, res) => {
  try {
    const { mediaId } = req.params;

    // Search for media in support tickets
    const customerWithTicket = await Customer.findOne({
      "supportTickets.mediaAttachments.mediaId": mediaId,
    });

    let mediaData = null;
    let filename = "media_file";

    if (customerWithTicket) {
      // Find the specific media in support tickets
      customerWithTicket.supportTickets.forEach((ticket) => {
        if (ticket.mediaAttachments) {
          const media = ticket.mediaAttachments.find(
            (m) => m.mediaId === mediaId
          );
          if (media) {
            mediaData = media;
            filename = media.filename || `ticket_media_${mediaId}`;
          }
        }
      });
    }

    // If not found in tickets, search in complaints
    if (!mediaData) {
      const customerWithComplaint = await Customer.findOne({
        "complaints.mediaAttachments.mediaId": mediaId,
      });

      if (customerWithComplaint) {
        customerWithComplaint.complaints.forEach((complaint) => {
          if (complaint.mediaAttachments) {
            const media = complaint.mediaAttachments.find(
              (m) => m.mediaId === mediaId
            );
            if (media) {
              mediaData = media;
              filename = media.filename || `complaint_media_${mediaId}`;
            }
          }
        });
      }
    }

    // If not found in complaints, search in support media
    if (!mediaData) {
      const customerWithSupportMedia = await Customer.findOne({
        "supportMedia.mediaId": mediaId,
      });

      if (customerWithSupportMedia) {
        const media = customerWithSupportMedia.supportMedia.find(
          (m) => m.mediaId === mediaId
        );
        if (media) {
          mediaData = media;
          filename = media.filename || `support_media_${mediaId}`;
        }
      }
    }

    // If not found in support media, search in payment issues
    if (!mediaData) {
      const customerWithPayment = await Customer.findOne({
        "paymentIssues.paymentScreenshot.mediaId": mediaId,
      });

      if (customerWithPayment) {
        customerWithPayment.paymentIssues.forEach((issue) => {
          if (
            issue.paymentScreenshot &&
            issue.paymentScreenshot.mediaId === mediaId
          ) {
            mediaData = issue.paymentScreenshot;
            filename = "payment_screenshot";
          }
        });
      }
    }

    if (!mediaData || !mediaData.base64Data) {
      return res.status(404).json({ error: "Media file not found" });
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(mediaData.base64Data, "base64");

    // Set appropriate headers
    res.setHeader(
      "Content-Type",
      mediaData.mimetype || "application/octet-stream"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", buffer.length);

    res.send(buffer);
  } catch (error) {
    console.error("Error downloading media:", error);
    res.status(500).json({ error: "Failed to download media" });
  }
});

// GET /api/support/media/:mediaId/view - View media file in browser
router.get("/media/:mediaId/view", async (req, res) => {
  try {
    const { mediaId } = req.params;

    // Search for media across all collections (similar to download route)
    let mediaData = null;

    // Search in support tickets
    const customerWithTicket = await Customer.findOne({
      "supportTickets.mediaAttachments.mediaId": mediaId,
    });

    if (customerWithTicket) {
      customerWithTicket.supportTickets.forEach((ticket) => {
        if (ticket.mediaAttachments) {
          const media = ticket.mediaAttachments.find(
            (m) => m.mediaId === mediaId
          );
          if (media) mediaData = media;
        }
      });
    }

    // Search in complaints if not found
    if (!mediaData) {
      const customerWithComplaint = await Customer.findOne({
        "complaints.mediaAttachments.mediaId": mediaId,
      });

      if (customerWithComplaint) {
        customerWithComplaint.complaints.forEach((complaint) => {
          if (complaint.mediaAttachments) {
            const media = complaint.mediaAttachments.find(
              (m) => m.mediaId === mediaId
            );
            if (media) mediaData = media;
          }
        });
      }
    }

    if (!mediaData || !mediaData.base64Data) {
      return res.status(404).json({ error: "Media file not found" });
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(mediaData.base64Data, "base64");

    // Set appropriate headers for viewing
    res.setHeader(
      "Content-Type",
      mediaData.mimetype || "application/octet-stream"
    );
    res.setHeader("Content-Length", buffer.length);

    res.send(buffer);
  } catch (error) {
    console.error("Error viewing media:", error);
    res.status(500).json({ error: "Failed to view media" });
  }
});

// GET /api/support/analytics - Get support analytics
router.get("/analytics", async (req, res) => {
  try {
    const { timeframe = "30d" } = req.query;

    // Calculate date range based on timeframe
    const now = new Date();
    let startDate;

    switch (timeframe) {
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30d":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const customers = await Customer.find({
      $or: [
        { "supportTickets.createdAt": { $gte: startDate } },
        { "complaints.submittedAt": { $gte: startDate } },
        { "paymentIssues.reportedAt": { $gte: startDate } },
      ],
    });

    // Analyze tickets by type
    const ticketTypeAnalysis = {};
    const ticketStatusAnalysis = {};
    const ticketPriorityAnalysis = {};
    const dailyTicketCounts = {};

    customers.forEach((customer) => {
      if (customer.supportTickets) {
        customer.supportTickets
          .filter((t) => new Date(t.createdAt) >= startDate)
          .forEach((ticket) => {
            // Type analysis
            ticketTypeAnalysis[ticket.type] =
              (ticketTypeAnalysis[ticket.type] || 0) + 1;

            // Status analysis
            ticketStatusAnalysis[ticket.status] =
              (ticketStatusAnalysis[ticket.status] || 0) + 1;

            // Priority analysis
            ticketPriorityAnalysis[ticket.priority] =
              (ticketPriorityAnalysis[ticket.priority] || 0) + 1;

            // Daily counts
            const dateKey = new Date(ticket.createdAt)
              .toISOString()
              .split("T")[0];
            dailyTicketCounts[dateKey] = (dailyTicketCounts[dateKey] || 0) + 1;
          });
      }
    });

    // Calculate response times
    const allTickets = [];
    customers.forEach((customer) => {
      if (customer.supportTickets) {
        customer.supportTickets
          .filter((t) => new Date(t.createdAt) >= startDate)
          .forEach((ticket) => allTickets.push(ticket));
      }
    });

    const avgResponseTime = calculateAvgResolutionTime(allTickets);
    const resolutionRate =
      allTickets.length > 0
        ? (
            (allTickets.filter((t) => t.status === "resolved").length /
              allTickets.length) *
            100
          ).toFixed(1)
        : 0;

    res.json({
      timeframe,
      totalTickets: allTickets.length,
      avgResponseTime,
      resolutionRate: parseFloat(resolutionRate),
      ticketTypeAnalysis,
      ticketStatusAnalysis,
      ticketPriorityAnalysis,
      dailyTicketCounts,
      topIssues: Object.entries(ticketTypeAnalysis)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([type, count]) => ({ type, count })),
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// GET /api/support/customers/:customerId - Get customer support history
router.get("/customers/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const customerInfo = formatCustomerData(customer);

    res.json({
      customer: customerInfo,
      supportTickets: customer.supportTickets || [],
      complaints: customer.complaints || [],
      paymentIssues: customer.paymentIssues || [],
      addressChangeHistory: customer.addressChangeHistory || [],
      faqInteractions: customer.faqInteractions || [],
      supportInteractionHistory: customer.supportInteractionHistory || [],
      supportPreferences: customer.supportPreferences || {},
    });
  } catch (error) {
    console.error("Error fetching customer support history:", error);
    res.status(500).json({ error: "Failed to fetch customer support history" });
  }
});

// POST /api/support/customers/:customerId/call-log - Log a call with customer
router.post("/customers/:customerId/call-log", async (req, res) => {
  try {
    const { customerId } = req.params;
    const { duration, notes, outcome, agentId } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // Add call log to support interaction history
    if (!customer.supportInteractionHistory) {
      customer.supportInteractionHistory = [];
    }

    customer.supportInteractionHistory.push({
      sessionId: `CALL_${Date.now()}`,
      startTime: new Date(),
      endTime: new Date(Date.now() + duration * 1000),
      category: "phone_call",
      agentInvolved: true,
      totalMessages: 1,
      lastAction: "phone_call_completed",
      lastActionTime: new Date(),
      callDetails: {
        duration,
        notes,
        outcome,
        agentId,
      },
    });

    await customer.save();

    res.json({ message: "Call logged successfully" });
  } catch (error) {
    console.error("Error logging call:", error);
    res.status(500).json({ error: "Failed to log call" });
  }
});

// GET /api/support/export - Export support data
router.get("/export", async (req, res) => {
  try {
    const { type = "tickets", format = "json" } = req.query;

    let data = [];
    const customers = await Customer.find({});

    switch (type) {
      case "tickets":
        customers.forEach((customer) => {
          const customerInfo = formatCustomerData(customer);
          if (customer.supportTickets) {
            customer.supportTickets.forEach((ticket) => {
              data.push({
                ...ticket.toObject(),
                ...customerInfo,
              });
            });
          }
        });
        break;

      case "complaints":
        customers.forEach((customer) => {
          const customerInfo = formatCustomerData(customer);
          if (customer.complaints) {
            customer.complaints.forEach((complaint) => {
              data.push({
                ...complaint.toObject(),
                ...customerInfo,
              });
            });
          }
        });
        break;

      case "payment-issues":
        customers.forEach((customer) => {
          const customerInfo = formatCustomerData(customer);
          if (customer.paymentIssues) {
            customer.paymentIssues.forEach((issue) => {
              data.push({
                ...issue.toObject(),
                ...customerInfo,
              });
            });
          }
        });
        break;
    }

    if (format === "csv") {
      // Convert to CSV format
      const csv = convertToCSV(data);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${type}_export.csv"`
      );
      res.send(csv);
    } else {
      // Return JSON
      res.json({ data, exportedAt: new Date(), totalRecords: data.length });
    }
  } catch (error) {
    console.error("Error exporting data:", error);
    res.status(500).json({ error: "Failed to export data" });
  }
});

// Helper function to convert JSON to CSV
function convertToCSV(data) {
  if (data.length === 0) return "";

  const headers = Object.keys(data[0]);
  const csvRows = [];

  // Add header row
  csvRows.push(headers.join(","));

  // Add data rows
  data.forEach((row) => {
    const values = headers.map((header) => {
      const value = row[header];
      return typeof value === "string"
        ? `"${value.replace(/"/g, '""')}"`
        : value;
    });
    csvRows.push(values.join(","));
  });

  return csvRows.join("\n");
}

// GET /api/support/search - Search across all support data
router.get("/search", async (req, res) => {
  try {
    const { q, type = "all" } = req.query;

    if (!q || q.trim().length < 2) {
      return res
        .status(400)
        .json({ error: "Search query must be at least 2 characters" });
    }

    const searchTerm = q.trim().toLowerCase();
    const searchResults = {
      tickets: [],
      complaints: [],
      paymentIssues: [],
      customers: [],
    };

    // Search in customer names and phone numbers
    const customers = await Customer.find({
      $or: [
        { name: { $regex: searchTerm, $options: "i" } },
        {
          phoneNumber: { $regex: searchTerm.replace(/\D/g, ""), $options: "i" },
        },
      ],
    });

    customers.forEach((customer) => {
      const customerInfo = formatCustomerData(customer);
      searchResults.customers.push(customerInfo);

      // Search in tickets if type allows
      if ((type === "all" || type === "tickets") && customer.supportTickets) {
        customer.supportTickets.forEach((ticket) => {
          if (
            ticket.ticketId.toLowerCase().includes(searchTerm) ||
            ticket.issueDetails?.toLowerCase().includes(searchTerm) ||
            ticket.orderId?.toLowerCase().includes(searchTerm)
          ) {
            searchResults.tickets.push({
              ...ticket.toObject(),
              ...customerInfo,
            });
          }
        });
      }

      // Search in complaints
      if ((type === "all" || type === "complaints") && customer.complaints) {
        customer.complaints.forEach((complaint) => {
          if (
            complaint.complaintId.toLowerCase().includes(searchTerm) ||
            complaint.textSummary?.toLowerCase().includes(searchTerm) ||
            complaint.orderId?.toLowerCase().includes(searchTerm)
          ) {
            searchResults.complaints.push({
              ...complaint.toObject(),
              ...customerInfo,
            });
          }
        });
      }

      // Search in payment issues
      if (
        (type === "all" || type === "payment-issues") &&
        customer.paymentIssues
      ) {
        customer.paymentIssues.forEach((issue) => {
          if (
            issue.issueId.toLowerCase().includes(searchTerm) ||
            issue.description?.toLowerCase().includes(searchTerm) ||
            issue.orderId?.toLowerCase().includes(searchTerm)
          ) {
            searchResults.paymentIssues.push({
              ...issue.toObject(),
              ...customerInfo,
            });
          }
        });
      }
    });

    const totalResults =
      searchResults.tickets.length +
      searchResults.complaints.length +
      searchResults.paymentIssues.length +
      searchResults.customers.length;

    res.json({
      query: q,
      totalResults,
      results: searchResults,
    });
  } catch (error) {
    console.error("Error performing search:", error);
    res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;
