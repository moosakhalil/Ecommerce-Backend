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

// ==================== DELIVERY FEES ====================

// Update delivery fees for an area
router.patch('/areas/:id/fees', async (req, res) => {
  try {
    const { scooterPrice, truckPrice } = req.body;
    
    const updateData = {};
    if (scooterPrice !== undefined) updateData.scooterPrice = Number(scooterPrice);
    if (truckPrice !== undefined) updateData.truckPrice = Number(truckPrice);
    
    const area = await AreaB.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).populate({
      path: 'regencyId',
      populate: {
        path: 'largerStateId',
        populate: { path: 'islandId', select: 'name' }
      }
    });
    
    if (!area) {
      return res.status(404).json({ message: 'Area not found' });
    }
    
    res.json(area);
  } catch (error) {
    res.status(500).json({ message: 'Error updating delivery fees', error: error.message });
  }
});

// Bulk update delivery fees
router.patch('/areas/bulk-fees', async (req, res) => {
  try {
    const { updates } = req.body; // Array of { areaId, scooterPrice, truckPrice }
    
    if (!Array.isArray(updates)) {
      return res.status(400).json({ message: 'Updates must be an array' });
    }
    
    const results = [];
    for (const update of updates) {
      const updateData = {};
      if (update.scooterPrice !== undefined) updateData.scooterPrice = Number(update.scooterPrice);
      if (update.truckPrice !== undefined) updateData.truckPrice = Number(update.truckPrice);
      
      const area = await AreaB.findByIdAndUpdate(
        update.areaId,
        updateData,
        { new: true }
      );
      if (area) results.push(area);
    }
    
    res.json({ message: `Updated ${results.length} areas`, data: results });
  } catch (error) {
    res.status(500).json({ message: 'Error bulk updating fees', error: error.message });
  }
});

// ==================== EXCEL UPLOAD ====================
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Configure multer for Excel file uploads
const excelStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads', 'excel');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `areas-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const excelUpload = multer({
  storage: excelStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Upload Excel and import areas
router.post('/upload-excel', excelUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Read Excel file
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    // Stats
    const stats = {
      islands: { created: 0, existing: 0 },
      states: { created: 0, existing: 0 },
      regencies: { created: 0, existing: 0 },
      areas: { created: 0, updated: 0, skipped: 0 }
    };

    // Helper function to find column value by partial/flexible match
    const getColumnValue = (row, ...possibleNames) => {
      const keys = Object.keys(row);
      for (const name of possibleNames) {
        const lowerName = name.toLowerCase();
        
        // 1. Exact & Case-insensitive check
        for (const key of keys) {
          if (key.toLowerCase() === lowerName) return row[key];
        }

        // 2. Partial match (key contains the name)
        for (const key of keys) {
          if (key.toLowerCase().includes(lowerName)) return row[key];
        }
      }
      return '';
    };

    // Process each row
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      // Extract data with flexible column matching
      // We list specific typos and general terms to catch variations
      const islandName = getColumnValue(row, 'Island', 'Islnd', 'isl').toString().trim();
      const stateName = getColumnValue(row, 'larger state', 'Larger State', 'state', 'larger').toString().trim();
      const regencyName = getColumnValue(row, 'Regency', 'regency', 'kabupaten').toString().trim();
      const areaName = getColumnValue(row, 'Area', 'area', 'kecamatan').toString().trim();
      // 'dispay nalk' from screenshot, 'display name', 'area name'
      const displayName = getColumnValue(row, 'Area name', 'display', 'dispay', 'nama').toString().trim();
      
      const scooterPrice = Number(getColumnValue(row, 'scooter', 'motor') || 0);
      const truckPrice = Number(getColumnValue(row, 'truck', 'truk', 'mobil') || 0);

      // Debug log for first few rows
      if (i < 3) {
        console.log(`Row ${i+1} parsed: Island="${islandName}", Area="${areaName}", Scooter=${scooterPrice}`);
      }

      if (!islandName || !stateName || !regencyName || !areaName) {
        stats.areas.skipped++;
        continue;
      }

      try {
        // 1. Find or create Island
        let island = await Island.findOne({ name: { $regex: new RegExp(`^${islandName}$`, 'i') } });
        if (!island) {
          island = await Island.create({ name: islandName });
          stats.islands.created++;
        } else {
          stats.islands.existing++;
        }

        // 2. Find or create LargerState
        let state = await LargerState.findOne({ 
          name: { $regex: new RegExp(`^${stateName}$`, 'i') },
          islandId: island._id 
        });
        if (!state) {
          state = await LargerState.create({ name: stateName, islandId: island._id });
          stats.states.created++;
        } else {
          stats.states.existing++;
        }

        // 3. Find or create Regency
        let regency = await Regency.findOne({ 
          name: { $regex: new RegExp(`^${regencyName}$`, 'i') },
          largerStateId: state._id 
        });
        if (!regency) {
          regency = await Regency.create({ name: regencyName, largerStateId: state._id });
          stats.regencies.created++;
        } else {
          stats.regencies.existing++;
        }

        // 4. Find or create/update AreaB
        let area = await AreaB.findOne({ 
          name: { $regex: new RegExp(`^${areaName}$`, 'i') },
          regencyId: regency._id 
        });
        if (!area) {
          area = await AreaB.create({ 
            name: areaName, 
            displayName: displayName || areaName,
            regencyId: regency._id,
            scooterPrice,
            truckPrice
          });
          stats.areas.created++;
        } else {
          // Update existing area
          area.displayName = displayName || area.displayName;
          area.scooterPrice = scooterPrice;
          area.truckPrice = truckPrice;
          await area.save();
          stats.areas.updated++;
        }
      } catch (rowError) {
        stats.areas.skipped++;
      }
    }

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: 'Excel file imported successfully',
      stats: {
        totalRows: data.length,
        islands: stats.islands,
        states: stats.states,
        regencies: stats.regencies,
        areas: stats.areas
      }
    });
  } catch (error) {
    // Clean up file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ message: 'Error importing Excel file', error: error.message });
  }
});

module.exports = router;

