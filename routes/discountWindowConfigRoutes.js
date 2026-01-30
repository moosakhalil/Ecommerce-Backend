const express = require("express");
const router = express.Router();
const DiscountWindowConfig = require("../models/DiscountWindowConfig");

/**
 * Discount Window Config Routes
 * API for managing discount window configurations (Page 74 - Discount Policies)
 */

// ─────────────────────────────────────────────────────────────────
// 1) GET ALL WINDOW CONFIGS
// ─────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    let configs = await DiscountWindowConfig.find().sort({ windowId: 1 });
    
    // If no configs exist, initialize defaults
    if (configs.length === 0) {
      await DiscountWindowConfig.initializeDefaults();
      configs = await DiscountWindowConfig.find().sort({ windowId: 1 });
    }
    
    res.json({
      success: true,
      message: "Window configs retrieved successfully",
      data: configs
    });
  } catch (err) {
    console.error("Error fetching window configs:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 2) GET SINGLE WINDOW CONFIG BY ID
// ─────────────────────────────────────────────────────────────────
router.get("/:windowId", async (req, res) => {
  try {
    const { windowId } = req.params;
    
    let config = await DiscountWindowConfig.findOne({ windowId });
    
    // If config doesn't exist, create with defaults
    if (!config) {
      const defaultConfig = DiscountWindowConfig.getDefaultConfig(windowId);
      config = new DiscountWindowConfig({
        windowId,
        ...defaultConfig
      });
      await config.save();
    }
    
    res.json({
      success: true,
      data: config
    });
  } catch (err) {
    console.error("Error fetching window config:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 3) UPDATE WINDOW CONFIG
// ─────────────────────────────────────────────────────────────────
router.put("/:windowId", async (req, res) => {
  try {
    const { windowId } = req.params;
    const updateData = req.body;
    
    // Remove fields that shouldn't be updated directly
    delete updateData._id;
    delete updateData.windowId;
    delete updateData.createdAt;
    
    // Add metadata
    updateData.updatedAt = new Date();
    updateData.updatedBy = req.body.updatedBy || 'admin';
    
    let config = await DiscountWindowConfig.findOneAndUpdate(
      { windowId },
      { $set: updateData },
      { new: true, upsert: true, runValidators: true }
    );
    
    console.log(`✅ Window config updated: ${windowId}`, updateData);
    
    res.json({
      success: true,
      message: `Window ${windowId} configuration updated successfully`,
      data: config
    });
  } catch (err) {
    console.error("Error updating window config:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 4) TOGGLE WINDOW ACTIVE STATUS
// ─────────────────────────────────────────────────────────────────
router.patch("/:windowId/toggle", async (req, res) => {
  try {
    const { windowId } = req.params;
    
    let config = await DiscountWindowConfig.findOne({ windowId });
    
    if (!config) {
      // Create with defaults if doesn't exist
      const defaultConfig = DiscountWindowConfig.getDefaultConfig(windowId);
      config = new DiscountWindowConfig({
        windowId,
        ...defaultConfig
      });
    }
    
    // Toggle the active status
    config.isActive = !config.isActive;
    config.updatedAt = new Date();
    await config.save();
    
    console.log(`🔄 Window ${windowId} toggled to: ${config.isActive ? 'ACTIVE' : 'INACTIVE'}`);
    
    res.json({
      success: true,
      message: `Window ${windowId} is now ${config.isActive ? 'active' : 'inactive'}`,
      data: config
    });
  } catch (err) {
    console.error("Error toggling window:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 5) INITIALIZE DEFAULT CONFIGS
// ─────────────────────────────────────────────────────────────────
router.post("/initialize", async (req, res) => {
  try {
    const results = await DiscountWindowConfig.initializeDefaults();
    
    res.json({
      success: true,
      message: "Default configurations initialized",
      data: results
    });
  } catch (err) {
    console.error("Error initializing configs:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 6) GET ACTIVE WINDOW CONFIG FOR ELIGIBILITY CHECKS
// Used by chatbot and eligibility system
// ─────────────────────────────────────────────────────────────────
router.get("/check/:windowId", async (req, res) => {
  try {
    const { windowId } = req.params;
    
    let config = await DiscountWindowConfig.findOne({ windowId });
    
    // Return defaults if no config exists
    if (!config) {
      const defaultConfig = DiscountWindowConfig.getDefaultConfig(windowId);
      return res.json({
        success: true,
        isActive: true,
        settings: defaultConfig,
        source: 'default'
      });
    }
    
    res.json({
      success: true,
      isActive: config.isActive,
      settings: config.getSettings(),
      source: 'database'
    });
  } catch (err) {
    console.error("Error checking window config:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 7) RESET WINDOW TO DEFAULTS
// ─────────────────────────────────────────────────────────────────
router.post("/:windowId/reset", async (req, res) => {
  try {
    const { windowId } = req.params;
    const defaultConfig = DiscountWindowConfig.getDefaultConfig(windowId);
    
    const config = await DiscountWindowConfig.findOneAndUpdate(
      { windowId },
      { 
        $set: {
          ...defaultConfig,
          updatedAt: new Date(),
          updatedBy: 'system-reset'
        }
      },
      { new: true, upsert: true }
    );
    
    res.json({
      success: true,
      message: `Window ${windowId} reset to defaults`,
      data: config
    });
  } catch (err) {
    console.error("Error resetting window:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

module.exports = router;
