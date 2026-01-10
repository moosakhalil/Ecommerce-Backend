// routes/triggerManagement.js
const express = require("express");
const router = express.Router();
const TriggerConfiguration = require("../models/TriggerConfiguration");
const Customer = require("../models/customer");

// GET /api/triggers - List all triggers with pagination and filtering
router.get("/", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      type,
      status,
      search,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    // Build query
    const query = {};

    if (type && type !== "all") {
      query.triggerType = type;
    }

    if (status === "active") {
      query.isActive = true;
    } else if (status === "inactive") {
      query.isActive = false;
    }

    if (search) {
      query.$or = [
        { triggerName: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    // Execute query with pagination
    const triggers = await TriggerConfiguration.find(query)
      .sort({ [sortBy]: sortOrder === "desc" ? -1 : 1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await TriggerConfiguration.countDocuments(query);

    res.json({
      success: true,
      data: triggers,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching triggers:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching triggers",
      error: error.message,
    });
  }
});

// GET /api/triggers/stats - Get overall trigger statistics
router.get("/stats", async (req, res) => {
  try {
    const totalTriggers = await TriggerConfiguration.countDocuments();
    const activeTriggers = await TriggerConfiguration.countDocuments({
      isActive: true,
    });

    const stats = await TriggerConfiguration.aggregate([
      {
        $group: {
          _id: null,
          totalExecutions: { $sum: "$executionStats.totalExecutions" },
          totalSuccess: { $sum: "$executionStats.successCount" },
          totalFailures: { $sum: "$executionStats.failureCount" },
        },
      },
    ]);

    const statsData = stats[0] || {
      totalExecutions: 0,
      totalSuccess: 0,
      totalFailures: 0,
    };

    const successRate =
      statsData.totalExecutions > 0
        ? ((statsData.totalSuccess / statsData.totalExecutions) * 100).toFixed(
            2
          )
        : 0;

    res.json({
      success: true,
      data: {
        totalTriggers,
        activeTriggers,
        inactiveTriggers: totalTriggers - activeTriggers,
        totalExecutions: statsData.totalExecutions,
        totalSuccess: statsData.totalSuccess,
        totalFailures: statsData.totalFailures,
        successRate: parseFloat(successRate),
      },
    });
  } catch (error) {
    console.error("Error fetching trigger stats:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching trigger stats",
      error: error.message,
    });
  }
});

// GET /api/triggers/:id - Get specific trigger
router.get("/:id", async (req, res) => {
  try {
    const trigger = await TriggerConfiguration.findById(req.params.id);

    if (!trigger) {
      return res.status(404).json({
        success: false,
        message: "Trigger not found",
      });
    }

    res.json({
      success: true,
      data: trigger,
    });
  } catch (error) {
    console.error("Error fetching trigger:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching trigger",
      error: error.message,
    });
  }
});

// POST /api/triggers - Create new trigger
router.post("/", async (req, res) => {
  try {
    const {
      triggerName,
      triggerType,
      description,
      isNew,
      configuration,
      createdBy,
    } = req.body;

    // Validate required fields
    if (!triggerName || !triggerType || !description || !configuration) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Check for duplicate trigger name
    const existing = await TriggerConfiguration.findOne({ triggerName });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Trigger with this name already exists",
      });
    }

    // Create new trigger
    const trigger = new TriggerConfiguration({
      triggerName,
      triggerType,
      description,
      isNew: isNew || false,
      configuration,
      createdBy: createdBy || { staffId: "admin", staffName: "Administrator" },
    });

    await trigger.save();

    res.status(201).json({
      success: true,
      message: "Trigger created successfully",
      data: trigger,
    });
  } catch (error) {
    console.error("Error creating trigger:", error);
    res.status(500).json({
      success: false,
      message: "Error creating trigger",
      error: error.message,
    });
  }
});

// PUT /api/triggers/:id - Update trigger
router.put("/:id", async (req, res) => {
  try {
    const {
      triggerName,
      description,
      configuration,
      isActive,
      updatedBy,
    } = req.body;

    const trigger = await TriggerConfiguration.findById(req.params.id);

    if (!trigger) {
      return res.status(404).json({
        success: false,
        message: "Trigger not found",
      });
    }

    // Update fields
    if (triggerName) trigger.triggerName = triggerName;
    if (description) trigger.description = description;
    if (configuration) trigger.configuration = { ...trigger.configuration, ...configuration };
    if (typeof isActive !== "undefined") trigger.isActive = isActive;
    if (updatedBy) trigger.updatedBy = updatedBy;

    await trigger.save();

    res.json({
      success: true,
      message: "Trigger updated successfully",
      data: trigger,
    });
  } catch (error) {
    console.error("Error updating trigger:", error);
    res.status(500).json({
      success: false,
      message: "Error updating trigger",
      error: error.message,
    });
  }
});

// POST /api/triggers/:id/toggle - Toggle trigger active status
router.post("/:id/toggle", async (req, res) => {
  try {
    const trigger = await TriggerConfiguration.findById(req.params.id);

    if (!trigger) {
      return res.status(404).json({
        success: false,
        message: "Trigger not found",
      });
    }

    trigger.isActive = !trigger.isActive;
    await trigger.save();

    res.json({
      success: true,
      message: `Trigger ${trigger.isActive ? "activated" : "deactivated"} successfully`,
      data: trigger,
    });
  } catch (error) {
    console.error("Error toggling trigger:", error);
    res.status(500).json({
      success: false,
      message: "Error toggling trigger",
      error: error.message,
    });
  }
});

// DELETE /api/triggers/:id - Delete trigger (soft delete)
router.delete("/:id", async (req, res) => {
  try {
    const trigger = await TriggerConfiguration.findByIdAndDelete(req.params.id);

    if (!trigger) {
      return res.status(404).json({
        success: false,
        message: "Trigger not found",
      });
    }

    res.json({
      success: true,
      message: "Trigger deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting trigger:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting trigger",
      error: error.message,
    });
  }
});

// GET /api/triggers/:id/analytics - Get trigger performance analytics
router.get("/:id/analytics", async (req, res) => {
  try {
    const { period = "last7days" } = req.query;
    const trigger = await TriggerConfiguration.findById(req.params.id);

    if (!trigger) {
      return res.status(404).json({
        success: false,
        message: "Trigger not found",
      });
    }

    // Calculate date range
    const now = new Date();
    let startDate;

    switch (period) {
      case "last7days":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "last30days":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "last90days":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(0); // All time
    }

    // Get execution history from customer trigger history
    const executions = await Customer.aggregate([
      { $unwind: "$triggerHistory" },
      {
        $match: {
          "triggerHistory.triggerId": req.params.id,
          "triggerHistory.executedAt": { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$triggerHistory.executedAt",
            },
          },
          count: { $sum: 1 },
          successful: {
            $sum: { $cond: ["$triggerHistory.messageSent", 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      success: true,
      data: {
        trigger: {
          name: trigger.triggerName,
          type: trigger.triggerType,
          isActive: trigger.isActive,
        },
        stats: trigger.executionStats,
        executionHistory: executions,
      },
    });
  } catch (error) {
    console.error("Error fetching trigger analytics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching trigger analytics",
      error: error.message,
    });
  }
});

// GET /api/triggers/execution-history - Get recent trigger executions
router.get("/execution/history", async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      triggerId,
      status,
      startDate,
      endDate,
    } = req.query;

    // Build aggregation pipeline
    const matchStage = {};

    if (triggerId) {
      matchStage["triggerHistory.triggerId"] = triggerId;
    }

    if (status === "success") {
      matchStage["triggerHistory.messageSent"] = true;
    } else if (status === "failed") {
      matchStage["triggerHistory.messageSent"] = false;
    }

    if (startDate || endDate) {
      matchStage["triggerHistory.executedAt"] = {};
      if (startDate)
        matchStage["triggerHistory.executedAt"].$gte = new Date(startDate);
      if (endDate)
        matchStage["triggerHistory.executedAt"].$lte = new Date(endDate);
    }

    const executions = await Customer.aggregate([
      { $unwind: "$triggerHistory" },
      { $match: matchStage },
      {
        $project: {
          triggerName: "$triggerHistory.triggerName",
          triggerType: "$triggerHistory.triggerType",
          customerName: "$name",
          customerPhone: { $arrayElemAt: ["$phoneNumber", 0] },
          executedAt: "$triggerHistory.executedAt",
          messageSent: "$triggerHistory.messageSent",
          messageDelivered: "$triggerHistory.messageDelivered",
          customerResponse: "$triggerHistory.customerResponse",
        },
      },
      { $sort: { executedAt: -1 } },
      { $skip: (parseInt(page) - 1) * parseInt(limit) },
      { $limit: parseInt(limit) },
    ]);

    // Get total count
    const totalPipeline = await Customer.aggregate([
      { $unwind: "$triggerHistory" },
      { $match: matchStage },
      { $count: "total" },
    ]);

    const total = totalPipeline[0]?.total || 0;

    res.json({
      success: true,
      data: executions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching execution history:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching execution history",
      error: error.message,
    });
  }
});

module.exports = router;
