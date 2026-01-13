const express = require("express");
const router = express.Router();
const ChatbotMonitor = require("../models/ChatbotMonitor");

// GET /api/chatbot-monitor/stats - Get monitoring statistics
// IMPORTANT: This must come BEFORE /:id routes to prevent "stats" being caught as an ID
router.get("/stats", async (req, res) => {
  try {
    const totalMonitors = await ChatbotMonitor.countDocuments();
    const activeMonitors = await ChatbotMonitor.countDocuments({ isActive: true });
    const totalMessages = await ChatbotMonitor.aggregate([
      { $group: { _id: null, total: { $sum: "$messageCount" } } },
    ]);

    res.json({
      success: true,
      stats: {
        totalMonitors,
        activeMonitors,
        totalMessagesSent: totalMessages[0]?.total || 0,
        isMonitoringActive: activeMonitors > 0,
      },
    });
  } catch (error) {
    console.error("Error fetching monitor stats:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching statistics",
      error: error.message,
    });
  }
});

// PUT /api/chatbot-monitor/toggle-all - Toggle all monitors on/off
// IMPORTANT: This must come BEFORE /:id routes
router.put("/toggle-all", async (req, res) => {
  try {
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "isActive must be a boolean",
      });
    }

    const result = await ChatbotMonitor.updateMany({}, { isActive });

    console.log(`🔄 All chatbot monitors set to: ${isActive ? "ACTIVE" : "INACTIVE"}`);

    res.json({
      success: true,
      message: `All monitors ${isActive ? "enabled" : "disabled"}`,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error toggling all monitors:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling monitors",
      error: error.message,
    });
  }
});

// GET /api/chatbot-monitor - Get all monitor numbers
router.get("/", async (req, res) => {
  try {
    const monitors = await ChatbotMonitor.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      monitors,
      count: monitors.length,
      activeCount: monitors.filter((m) => m.isActive).length,
    });
  } catch (error) {
    console.error("Error fetching chatbot monitors:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching monitor numbers",
      error: error.message,
    });
  }
});

// POST /api/chatbot-monitor - Add new monitor number
router.post("/", async (req, res) => {
  try {
    const { phoneNumber, countryCode, label } = req.body;

    // Validate required fields
    if (!phoneNumber || !countryCode) {
      return res.status(400).json({
        success: false,
        message: "Phone number and country code are required",
      });
    }

    // Validate country code
    const validCountryCodes = ["+92", "+62", "+46"];
    if (!validCountryCodes.includes(countryCode)) {
      return res.status(400).json({
        success: false,
        message: `Invalid country code. Must be one of: ${validCountryCodes.join(", ")}`,
      });
    }

    // Get country name from code
    const countryMap = {
      "+92": "Pakistan",
      "+62": "Indonesia",
      "+46": "Sweden",
    };

    // Clean phone number (remove spaces, dashes, etc.)
    const cleanNumber = phoneNumber.replace(/[\s\-\(\)]/g, "");
    
    // Build full number with country code
    const fullNumber = cleanNumber.startsWith(countryCode.replace("+", ""))
      ? cleanNumber
      : countryCode.replace("+", "") + cleanNumber.replace(/^0+/, "");

    // Check if number already exists
    const existing = await ChatbotMonitor.findOne({ phoneNumber: fullNumber });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "This phone number is already registered as a monitor",
      });
    }

    // Create new monitor
    const monitor = new ChatbotMonitor({
      phoneNumber: fullNumber,
      countryCode,
      country: countryMap[countryCode],
      label: label || "",
      isActive: true,
    });

    await monitor.save();

    console.log(`✅ New chatbot monitor added: ${fullNumber} (${countryMap[countryCode]})`);

    res.status(201).json({
      success: true,
      message: "Monitor number added successfully",
      monitor,
    });
  } catch (error) {
    console.error("Error adding chatbot monitor:", error);
    res.status(500).json({
      success: false,
      message: "Error adding monitor number",
      error: error.message,
    });
  }
});

// PUT /api/chatbot-monitor/:id - Update monitor (toggle active, edit label)
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive, label } = req.body;

    const monitor = await ChatbotMonitor.findById(id);
    if (!monitor) {
      return res.status(404).json({
        success: false,
        message: "Monitor not found",
      });
    }

    // Update fields if provided
    if (typeof isActive === "boolean") {
      monitor.isActive = isActive;
    }
    if (typeof label === "string") {
      monitor.label = label;
    }

    await monitor.save();

    console.log(`📝 Chatbot monitor updated: ${monitor.phoneNumber} (active: ${monitor.isActive})`);

    res.json({
      success: true,
      message: "Monitor updated successfully",
      monitor,
    });
  } catch (error) {
    console.error("Error updating chatbot monitor:", error);
    res.status(500).json({
      success: false,
      message: "Error updating monitor",
      error: error.message,
    });
  }
});

// DELETE /api/chatbot-monitor/:id - Remove monitor number
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const monitor = await ChatbotMonitor.findByIdAndDelete(id);
    if (!monitor) {
      return res.status(404).json({
        success: false,
        message: "Monitor not found",
      });
    }

    console.log(`🗑️ Chatbot monitor removed: ${monitor.phoneNumber}`);

    res.json({
      success: true,
      message: "Monitor removed successfully",
    });
  } catch (error) {
    console.error("Error deleting chatbot monitor:", error);
    res.status(500).json({
      success: false,
      message: "Error removing monitor",
      error: error.message,
    });
  }
});

module.exports = router;
