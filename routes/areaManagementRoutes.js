const express = require('express');
const router = express.Router();
const { Island, LargerState, Regency, AreaB } = require('../models/AreaManagement');

// ==================== ISLANDS ====================

// Get all islands
router.get('/islands', async (req, res) => {
  try {
    const islands = await Island.find().sort({ name: 1 });
    res.json(islands);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching islands', error: error.message });
  }
});

// Create island
router.post('/islands', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Island name is required' });
    
    const island = new Island({ name });
    await island.save();
    res.status(201).json(island);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Island already exists' });
    }
    res.status(500).json({ message: 'Error creating island', error: error.message });
  }
});

// ==================== LARGER STATES ====================

// Get all larger states (optionally filter by island)
router.get('/larger-states', async (req, res) => {
  try {
    const { islandId } = req.query;
    const filter = islandId ? { islandId } : {};
    const states = await LargerState.find(filter).populate('islandId', 'name').sort({ name: 1 });
    res.json(states);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching larger states', error: error.message });
  }
});

// Create larger state
router.post('/larger-states', async (req, res) => {
  try {
    const { name, islandId } = req.body;
    if (!name || !islandId) {
      return res.status(400).json({ message: 'Name and Island ID are required' });
    }
    
    const state = new LargerState({ name, islandId });
    await state.save();
    const populated = await LargerState.findById(state._id).populate('islandId', 'name');
    res.status(201).json(populated);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Larger State already exists in this Island' });
    }
    res.status(500).json({ message: 'Error creating larger state', error: error.message });
  }
});

// ==================== REGENCIES ====================

// Get all regencies (optionally filter by larger state)
router.get('/regencies', async (req, res) => {
  try {
    const { largerStateId } = req.query;
    const filter = largerStateId ? { largerStateId } : {};
    const regencies = await Regency.find(filter)
      .populate({
        path: 'largerStateId',
        populate: { path: 'islandId', select: 'name' }
      })
      .sort({ name: 1 });
    res.json(regencies);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching regencies', error: error.message });
  }
});

// Create regency
router.post('/regencies', async (req, res) => {
  try {
    const { name, largerStateId } = req.body;
    if (!name || !largerStateId) {
      return res.status(400).json({ message: 'Name and Larger State ID are required' });
    }
    
    const regency = new Regency({ name, largerStateId });
    await regency.save();
    const populated = await Regency.findById(regency._id)
      .populate({
        path: 'largerStateId',
        populate: { path: 'islandId', select: 'name' }
      });
    res.status(201).json(populated);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Regency already exists in this Larger State' });
    }
    res.status(500).json({ message: 'Error creating regency', error: error.message });
  }
});

// ==================== AREAS ====================

// Get all areas (optionally filter by regency)
router.get('/areas', async (req, res) => {
  try {
    const { regencyId } = req.query;
    const filter = regencyId ? { regencyId } : {};
    const areas = await AreaB.find(filter)
      .populate({
        path: 'regencyId',
        populate: {
          path: 'largerStateId',
          populate: { path: 'islandId', select: 'name' }
        }
      })
      .sort({ createdAt: -1 });
    res.json(areas);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching areas', error: error.message });
  }
});

// Create area
router.post('/areas', async (req, res) => {
  try {
    const { name, displayName, regencyId } = req.body;
    if (!name || !regencyId) {
      return res.status(400).json({ message: 'Name and Regency ID are required' });
    }
    
    const area = new AreaB({ name, displayName: displayName || '', regencyId });
    await area.save();
    const populated = await AreaB.findById(area._id)
      .populate({
        path: 'regencyId',
        populate: {
          path: 'largerStateId',
          populate: { path: 'islandId', select: 'name' }
        }
      });
    res.status(201).json(populated);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Area already exists in this Regency' });
    }
    res.status(500).json({ message: 'Error creating area', error: error.message });
  }
});

// Delete area
router.delete('/areas/:id', async (req, res) => {
  try {
    const area = await AreaB.findByIdAndDelete(req.params.id);
    if (!area) {
      return res.status(404).json({ message: 'AreaB not found' });
    }
    res.json({ message: 'AreaB deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting area', error: error.message });
  }
});

// Get full hierarchy (for display table)
router.get('/full-hierarchy', async (req, res) => {
  try {
    const areas = await AreaB.find()
      .populate({
        path: 'regencyId',
        populate: {
          path: 'largerStateId',
          populate: { path: 'islandId', select: 'name' }
        }
      })
      .sort({ createdAt: -1 });
    res.json(areas);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching hierarchy', error: error.message });
  }
});

module.exports = router;
