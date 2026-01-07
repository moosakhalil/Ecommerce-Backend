const express = require('express');
const router = express.Router();
const TaxBracket = require('../models/TaxBracket');

// GET all tax brackets
router.get('/', async (req, res) => {
  try {
    const brackets = await TaxBracket.find().sort({ isSystemDefault: -1, createdAt: -1 });
    res.json({ success: true, data: brackets });
  } catch (error) {
    console.error('Error fetching tax brackets:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET active tax brackets only (for dropdowns)
router.get('/active', async (req, res) => {
  try {
    const brackets = await TaxBracket.find({ isActive: true }).sort({ isSystemDefault: -1, bracketName: 1 });
    res.json({ success: true, data: brackets });
  } catch (error) {
    console.error('Error fetching active tax brackets:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single tax bracket by ID
router.get('/:id', async (req, res) => {
  try {
    const bracket = await TaxBracket.findById(req.params.id);
    if (!bracket) {
      return res.status(404).json({ success: false, message: 'Tax bracket not found' });
    }
    res.json({ success: true, data: bracket });
  } catch (error) {
    console.error('Error fetching tax bracket:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create new tax bracket
router.post('/', async (req, res) => {
  try {
    const { bracketCode, bracketName, taxPercentage, description, isActive, applicableCategories } = req.body;
    
    // Validate required fields
    if (!bracketCode || !bracketName) {
      return res.status(400).json({ 
        success: false, 
        message: 'Bracket code and name are required' 
      });
    }

    // Check if bracket code already exists
    const existingBracket = await TaxBracket.findOne({ 
      bracketCode: bracketCode.toUpperCase() 
    });
    
    if (existingBracket) {
      return res.status(400).json({ 
        success: false, 
        message: 'A tax bracket with this code already exists' 
      });
    }

    const bracket = new TaxBracket({
      bracketCode: bracketCode.toUpperCase(),
      bracketName,
      taxPercentage: taxPercentage || 0,
      description: description || '',
      isActive: isActive !== undefined ? isActive : true,
      applicableCategories: applicableCategories || [],
      isSystemDefault: false
    });
    
    await bracket.save();
    res.status(201).json({ success: true, data: bracket, message: 'Tax bracket created successfully' });
  } catch (error) {
    console.error('Error creating tax bracket:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// PUT update tax bracket
router.put('/:id', async (req, res) => {
  try {
    const bracket = await TaxBracket.findById(req.params.id);
    
    if (!bracket) {
      return res.status(404).json({ success: false, message: 'Tax bracket not found' });
    }

    // Prevent editing system default brackets
    if (bracket.isSystemDefault) {
      return res.status(403).json({ 
        success: false, 
        message: 'System default tax brackets cannot be modified' 
      });
    }

    // Check if updated bracketCode conflicts with existing
    if (req.body.bracketCode && req.body.bracketCode.toUpperCase() !== bracket.bracketCode) {
      const existingBracket = await TaxBracket.findOne({ 
        bracketCode: req.body.bracketCode.toUpperCase(),
        _id: { $ne: req.params.id }
      });
      
      if (existingBracket) {
        return res.status(400).json({ 
          success: false, 
          message: 'A tax bracket with this code already exists' 
        });
      }
    }

    const updatedBracket = await TaxBracket.findByIdAndUpdate(
      req.params.id,
      { 
        ...req.body, 
        bracketCode: req.body.bracketCode ? req.body.bracketCode.toUpperCase() : bracket.bracketCode,
        updatedAt: Date.now() 
      },
      { new: true, runValidators: true }
    );
    
    res.json({ success: true, data: updatedBracket, message: 'Tax bracket updated successfully' });
  } catch (error) {
    console.error('Error updating tax bracket:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// DELETE tax bracket
router.delete('/:id', async (req, res) => {
  try {
    const bracket = await TaxBracket.findById(req.params.id);
    
    if (!bracket) {
      return res.status(404).json({ success: false, message: 'Tax bracket not found' });
    }

    // Prevent deleting system default brackets
    if (bracket.isSystemDefault) {
      return res.status(403).json({ 
        success: false, 
        message: 'System default tax brackets cannot be deleted' 
      });
    }

    await TaxBracket.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Tax bracket deleted successfully' });
  } catch (error) {
    console.error('Error deleting tax bracket:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Toggle active status
router.patch('/:id/toggle-status', async (req, res) => {
  try {
    const bracket = await TaxBracket.findById(req.params.id);
    
    if (!bracket) {
      return res.status(404).json({ success: false, message: 'Tax bracket not found' });
    }

    // Prevent toggling system default brackets
    if (bracket.isSystemDefault) {
      return res.status(403).json({ 
        success: false, 
        message: 'System default tax brackets cannot be deactivated' 
      });
    }

    bracket.isActive = !bracket.isActive;
    await bracket.save();
    
    res.json({ 
      success: true, 
      data: bracket, 
      message: `Tax bracket ${bracket.isActive ? 'activated' : 'deactivated'} successfully` 
    });
  } catch (error) {
    console.error('Error toggling tax bracket status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
