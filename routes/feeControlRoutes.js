const express = require("express");
const router = express.Router();
const { ReasonCode, FeeControl } = require("../models/FeeControl");

// =====================
// REASON CODE ROUTES
// =====================

// Get all reason codes
router.get("/reason-codes", async (req, res) => {
  try {
    const reasonCodes = await ReasonCode.find().sort({ createdAt: -1 });
    res.json({ success: true, reasonCodes });
  } catch (error) {
    console.error("Error fetching reason codes:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get active reason codes only (for dropdowns)
router.get("/reason-codes/active", async (req, res) => {
  try {
    const reasonCodes = await ReasonCode.find({ isActive: true }).sort({ code: 1 });
    res.json({ success: true, reasonCodes });
  } catch (error) {
    console.error("Error fetching active reason codes:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create reason code
router.post("/reason-codes", async (req, res) => {
  try {
    const { code, description, category } = req.body;
    
    // Check if code already exists
    const existing = await ReasonCode.findOne({ code: code.toUpperCase() });
    if (existing) {
      return res.status(400).json({ success: false, message: "Reason code already exists" });
    }
    
    const reasonCode = new ReasonCode({
      code: code.toUpperCase(),
      description,
      category: category || 'other'
    });
    
    await reasonCode.save();
    res.json({ success: true, reasonCode, message: "Reason code created successfully" });
  } catch (error) {
    console.error("Error creating reason code:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update reason code
router.put("/reason-codes/:id", async (req, res) => {
  try {
    const { code, description, category, isActive } = req.body;
    
    const reasonCode = await ReasonCode.findByIdAndUpdate(
      req.params.id,
      { 
        code: code?.toUpperCase(), 
        description, 
        category, 
        isActive 
      },
      { new: true }
    );
    
    if (!reasonCode) {
      return res.status(404).json({ success: false, message: "Reason code not found" });
    }
    
    res.json({ success: true, reasonCode, message: "Reason code updated successfully" });
  } catch (error) {
    console.error("Error updating reason code:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete reason code
router.delete("/reason-codes/:id", async (req, res) => {
  try {
    const reasonCode = await ReasonCode.findByIdAndDelete(req.params.id);
    
    if (!reasonCode) {
      return res.status(404).json({ success: false, message: "Reason code not found" });
    }
    
    res.json({ success: true, message: "Reason code deleted successfully" });
  } catch (error) {
    console.error("Error deleting reason code:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// =====================
// FEE CONTROL ROUTES
// =====================

// Get all fee entries (for display in table)
router.get("/fees", async (req, res) => {
  try {
    const feeControls = await FeeControl.find()
      .populate('fees.reasonCode')
      .sort({ createdAt: -1 });
    res.json({ success: true, feeControls });
  } catch (error) {
    console.error("Error fetching fees:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get fee control by order/bill
router.get("/fees/by-order/:orderId", async (req, res) => {
  try {
    const feeControl = await FeeControl.findOne({ orderId: req.params.orderId })
      .populate('fees.reasonCode');
    
    if (!feeControl) {
      return res.status(404).json({ success: false, message: "Fee control not found for this order" });
    }
    
    res.json({ success: true, feeControl });
  } catch (error) {
    console.error("Error fetching fee control:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get fee control by bill number
router.get("/fees/by-bill/:billNumber", async (req, res) => {
  try {
    const feeControl = await FeeControl.findOne({ billNumber: req.params.billNumber })
      .populate('fees.reasonCode');
    
    if (!feeControl) {
      return res.status(404).json({ success: false, message: "Fee control not found for this bill" });
    }
    
    res.json({ success: true, feeControl });
  } catch (error) {
    console.error("Error fetching fee control:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create or update fee control
router.post("/fees", async (req, res) => {
  try {
    const { 
      orderId, 
      billNumber, 
      priceAfterTax, 
      taxAmount, 
      taxDeadline,
      fees,
      deliveryFee
    } = req.body;
    
    let feeControl = await FeeControl.findOne({ 
      $or: [{ orderId }, { billNumber }] 
    });
    
    if (feeControl) {
      // Update existing
      feeControl.priceAfterTax = priceAfterTax || feeControl.priceAfterTax;
      feeControl.taxAmount = taxAmount || feeControl.taxAmount;
      feeControl.taxDeadline = taxDeadline || feeControl.taxDeadline;
      feeControl.deliveryFee = deliveryFee || feeControl.deliveryFee;
      if (fees) feeControl.fees = fees;
    } else {
      // Create new
      feeControl = new FeeControl({
        orderId,
        billNumber,
        priceAfterTax: priceAfterTax || 0,
        taxAmount: taxAmount || 0,
        taxDeadline,
        fees: fees || [],
        deliveryFee: deliveryFee || 0
      });
    }
    
    await feeControl.save();
    res.json({ success: true, feeControl, message: "Fee control saved successfully" });
  } catch (error) {
    console.error("Error saving fee control:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add a single fee entry
router.post("/fees/:feeControlId/add-fee", async (req, res) => {
  try {
    const { feeType, amount, reasonCode, reasonText, note } = req.body;
    
    const feeControl = await FeeControl.findById(req.params.feeControlId);
    if (!feeControl) {
      return res.status(404).json({ success: false, message: "Fee control not found" });
    }
    
    feeControl.fees.push({
      feeType,
      amount,
      reasonCode,
      reasonText,
      note,
      appliedAt: new Date()
    });
    
    await feeControl.save();
    res.json({ success: true, feeControl, message: "Fee added successfully" });
  } catch (error) {
    console.error("Error adding fee:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create standalone fee entry (for the demo table)
router.post("/fees/standalone", async (req, res) => {
  try {
    const { feeType, amount, reasonCodeId, reasonText, note, billNumber } = req.body;
    
    // Find or create a fee control for demo purposes
    let feeControl = await FeeControl.findOne({ billNumber: billNumber || 'DEMO-001' });
    
    if (!feeControl) {
      feeControl = new FeeControl({
        billNumber: billNumber || 'DEMO-001',
        priceAfterTax: 0,
        fees: []
      });
    }
    
    feeControl.fees.push({
      feeType,
      amount: parseFloat(amount) || 0,
      reasonCode: reasonCodeId || null,
      reasonText,
      note,
      appliedAt: new Date()
    });
    
    await feeControl.save();
    
    // Populate and return
    await feeControl.populate('fees.reasonCode');
    
    res.json({ success: true, feeControl, message: "Fee entry added successfully" });
  } catch (error) {
    console.error("Error creating standalone fee:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all standalone fees for demo
router.get("/fees/standalone/all", async (req, res) => {
  try {
    const feeControl = await FeeControl.findOne({ billNumber: 'DEMO-001' })
      .populate('fees.reasonCode');
    
    if (!feeControl) {
      return res.json({ success: true, fees: [] });
    }
    
    res.json({ success: true, fees: feeControl.fees, feeControlId: feeControl._id });
  } catch (error) {
    console.error("Error fetching standalone fees:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete a fee entry
router.delete("/fees/:feeControlId/fee/:feeId", async (req, res) => {
  try {
    const feeControl = await FeeControl.findById(req.params.feeControlId);
    if (!feeControl) {
      return res.status(404).json({ success: false, message: "Fee control not found" });
    }
    
    feeControl.fees = feeControl.fees.filter(
      fee => fee._id.toString() !== req.params.feeId
    );
    
    await feeControl.save();
    res.json({ success: true, message: "Fee deleted successfully" });
  } catch (error) {
    console.error("Error deleting fee:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update wallet approval
router.put("/fees/:id/wallet-approval", async (req, res) => {
  try {
    const { approved, amount } = req.body;
    
    const feeControl = await FeeControl.findByIdAndUpdate(
      req.params.id,
      { 
        'walletBalanceUsed.approved': approved,
        'walletBalanceUsed.amount': amount,
        'walletBalanceUsed.approvedAt': approved ? new Date() : null
      },
      { new: true }
    );
    
    if (!feeControl) {
      return res.status(404).json({ success: false, message: "Fee control not found" });
    }
    
    res.json({ success: true, feeControl, message: "Wallet approval updated" });
  } catch (error) {
    console.error("Error updating wallet approval:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
