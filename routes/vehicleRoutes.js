const express = require('express');
const router = express.Router();
const Vehicle = require('../models/Vehicle');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for vehicle image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/vehicles');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `vehicle-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
});

const uploadFields = upload.fields([
  { name: 'stnkPhoto', maxCount: 1 },
  { name: 'bpkbPhoto', maxCount: 1 },
  { name: 'stnkIconPhoto', maxCount: 1 },
  { name: 'codecPhoto', maxCount: 1 },
]);

// GET /api/vehicles - List all vehicles with filters
router.get('/', async (req, res) => {
  try {
    const { type, status, search } = req.query;
    
    let query = {};
    
    if (type) {
      query.vehicleType = type;
    }
    
    if (status) {
      query.status = status;
    } else {
      // Default: only show active and maintenance vehicles (exclude incomplete)
      query.status = { $in: ['active', 'maintenance', 'inactive'] };
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { numberPlate: { $regex: search, $options: 'i' } },
      ];
    }
    
    const vehicles = await Vehicle.find(query).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: vehicles,
      count: vehicles.length,
    });
  } catch (error) {
    console.error('Error fetching vehicles:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicles',
      error: error.message,
    });
  }
});

// GET /api/vehicles/:id - Get single vehicle
router.get('/:id', async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }
    
    res.json({
      success: true,
      data: vehicle,
    });
  } catch (error) {
    console.error('Error fetching vehicle:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch vehicle',
      error: error.message,
    });
  }
});

// POST /api/vehicles - Create new vehicle
router.post('/', uploadFields, async (req, res) => {
  try {
    const vehicleData = {
      name: req.body.name,
      numberPlate: req.body.numberPlate,
      status: req.body.status || 'active',
    };
    
    // If templateId is provided, fetch template and copy specifications
    if (req.body.templateId) {
      const VehicleTemplate = require('../models/VehicleTemplate');
      const template = await VehicleTemplate.findById(req.body.templateId);
      
      if (!template) {
        return res.status(404).json({
          success: false,
          message: 'Template not found',
        });
      }
      
      // Copy template specifications to vehicle
      vehicleData.templateId = template._id;
      vehicleData.vehicleType = template.vehicleType;
      vehicleData.weightMaxKg = template.weightMaxKg;
      vehicleData.maxPackageLength = template.maxPackageLength;
      vehicleData.loadLimitPercent = template.loadLimitPercent;
      
      if (template.vehicleType === 'truck') {
        vehicleData.truckTypeName = template.truckTypeName;
        vehicleData.dimensions = {
          heightCm: template.dimensions.heightCm,
          widthCm: template.dimensions.widthCm,
          lengthCm: template.dimensions.lengthCm,
        };
      } else if (template.vehicleType === 'scooter') {
        vehicleData.scooterTypeName = template.scooterTypeName;
        vehicleData.maxPackages = template.maxPackages;
      }
    } else {
      // Legacy support: accept specifications directly (for backward compatibility)
      vehicleData.vehicleType = req.body.vehicleType;
      vehicleData.weightMaxKg = req.body.weightMaxKg;
      vehicleData.loadLimitPercent = req.body.loadLimitPercent || 80;
      
      // Add dimension fields for truck
      if (req.body.vehicleType === 'truck') {
        vehicleData.truckTypeName = req.body.truckTypeName;
        vehicleData.maxPackageLength = req.body.maxPackageLength;
        
        // Handle dimensions object or separate fields
        if (req.body.dimensions) {
          vehicleData.dimensions = {
            heightCm: req.body.dimensions.heightCm,
            widthCm: req.body.dimensions.widthCm,
            lengthCm: req.body.dimensions.lengthCm,
          };
        } else {
          vehicleData.dimensions = {
            heightCm: req.body.heightCm || req.body['dimensions[heightCm]'],
            widthCm: req.body.widthCm || req.body['dimensions[widthCm]'],
            lengthCm: req.body.lengthCm || req.body['dimensions[lengthCm]'],
          };
        }
      }
      
      // Add scooter-specific fields
      if (req.body.vehicleType === 'scooter') {
        vehicleData.scooterTypeName = req.body.scooterTypeName;
        vehicleData.maxPackages = req.body.maxPackages;
        vehicleData.maxPackageLength = req.body.maxPackageLength || 100;
      }
    }
    
    // Optional fields
    if (req.body.fuelType) vehicleData.fuelType = req.body.fuelType;
    if (req.body.transmission) vehicleData.transmission = req.body.transmission;
    if (req.body.yearModel) vehicleData.yearModel = req.body.yearModel;
    if (req.body.engineSizeCc) vehicleData.engineSizeCc = req.body.engineSizeCc;
    if (req.body.odometerKm) vehicleData.odometerKm = req.body.odometerKm;
    if (req.body.serviceDueDate) vehicleData.serviceDueDate = req.body.serviceDueDate;
    if (req.body.insuranceExpiryDate) vehicleData.insuranceExpiryDate = req.body.insuranceExpiryDate;
    if (req.body.chassisNumber) vehicleData.chassisNumber = req.body.chassisNumber;
    
    // Handle image uploads
    vehicleData.images = {};
    if (req.files) {
      if (req.files.stnkPhoto) {
        vehicleData.images.stnkPhoto = `/uploads/vehicles/${req.files.stnkPhoto[0].filename}`;
      }
      if (req.files.bpkbPhoto) {
        vehicleData.images.bpkbPhoto = `/uploads/vehicles/${req.files.bpkbPhoto[0].filename}`;
      }
      if (req.files.stnkIconPhoto) {
        vehicleData.images.stnkIconPhoto = `/uploads/vehicles/${req.files.stnkIconPhoto[0].filename}`;
      }
      if (req.files.codecPhoto) {
        vehicleData.images.codecPhoto = `/uploads/vehicles/${req.files.codecPhoto[0].filename}`;
      }
    }
    
    // Set audit fields
    vehicleData.createdBy = req.body.createdBy || 'admin';
    
    console.log('Creating vehicle with data:', JSON.stringify(vehicleData, null, 2));
    
    const vehicle = new Vehicle(vehicleData);
    await vehicle.save();
    
    console.log('Vehicle created successfully:', vehicle._id);
    
    res.status(201).json({
      success: true,
      message: 'Vehicle created successfully',
      data: vehicle,
    });
  } catch (error) {
    console.error('Error creating vehicle:', error);
    console.error('Error details:', error.message);
    if (error.errors) {
      console.error('Validation errors:', error.errors);
    }
    
    // Handle duplicate number plate error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Number plate already exists',
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message
      }));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: validationErrors,
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to create vehicle',
      error: error.message,
    });
  }
});

// PUT /api/vehicles/:id - Update vehicle
router.put('/:id', uploadFields, async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }
    
    // Update basic fields
    if (req.body.name) vehicle.name = req.body.name;
    if (req.body.vehicleType) vehicle.vehicleType = req.body.vehicleType;
    if (req.body.weightMaxKg) vehicle.weightMaxKg = req.body.weightMaxKg;
    if (req.body.loadLimitPercent !== undefined) vehicle.loadLimitPercent = req.body.loadLimitPercent;
    if (req.body.numberPlate) vehicle.numberPlate = req.body.numberPlate;
    if (req.body.status) vehicle.status = req.body.status;
    
    // Update dimensions for truck
    if (req.body.vehicleType === 'truck' || vehicle.vehicleType === 'truck') {
      if (!vehicle.dimensions) vehicle.dimensions = {};
      if (req.body.heightCm) vehicle.dimensions.heightCm = req.body.heightCm;
      if (req.body.widthCm) vehicle.dimensions.widthCm = req.body.widthCm;
      if (req.body.lengthCm) vehicle.dimensions.lengthCm = req.body.lengthCm;
    }
    
    // Update scooter fields
    if (req.body.vehicleType === 'scooter' || vehicle.vehicleType === 'scooter') {
      if (req.body.maxPackages) vehicle.maxPackages = req.body.maxPackages;
      if (req.body.volumeCapacityLiters) vehicle.volumeCapacityLiters = req.body.volumeCapacityLiters;
    }
    
    // Update optional fields
    if (req.body.fuelType) vehicle.fuelType = req.body.fuelType;
    if (req.body.transmission) vehicle.transmission = req.body.transmission;
    if (req.body.yearModel) vehicle.yearModel = req.body.yearModel;
    if (req.body.engineSizeCc) vehicle.engineSizeCc = req.body.engineSizeCc;
    if (req.body.odometerKm !== undefined) vehicle.odometerKm = req.body.odometerKm;
    if (req.body.serviceDueDate) vehicle.serviceDueDate = req.body.serviceDueDate;
    if (req.body.insuranceExpiryDate) vehicle.insuranceExpiryDate = req.body.insuranceExpiryDate;
    if (req.body.chassisNumber) vehicle.chassisNumber = req.body.chassisNumber;
    
    // Handle image uploads
    if (req.files) {
      if (!vehicle.images) vehicle.images = {};
      
      if (req.files.stnkPhoto) {
        vehicle.images.stnkPhoto = `/uploads/vehicles/${req.files.stnkPhoto[0].filename}`;
      }
      if (req.files.bpkbPhoto) {
        vehicle.images.bpkbPhoto = `/uploads/vehicles/${req.files.bpkbPhoto[0].filename}`;
      }
      if (req.files.stnkIconPhoto) {
        vehicle.images.stnkIconPhoto = `/uploads/vehicles/${req.files.stnkIconPhoto[0].filename}`;
      }
      if (req.files.codecPhoto) {
        vehicle.images.codecPhoto = `/uploads/vehicles/${req.files.codecPhoto[0].filename}`;
      }
    }
    
    vehicle.updatedBy = req.body.updatedBy || 'admin';
    
    await vehicle.save();
    
    res.json({
      success: true,
      message: 'Vehicle updated successfully',
      data: vehicle,
    });
  } catch (error) {
    console.error('Error updating vehicle:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Number plate already exists',
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to update vehicle',
      error: error.message,
    });
  }
});

// DELETE /api/vehicles/:id - Delete vehicle from database
router.delete('/:id', async (req, res) => {
  try {
    const vehicle = await Vehicle.findByIdAndDelete(req.params.id);
    
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }
    
    console.log('Vehicle deleted from database:', vehicle._id);
    
    res.json({
      success: true,
      message: 'Vehicle deleted successfully',
      data: vehicle,
    });
  } catch (error) {
    console.error('Error deleting vehicle:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete vehicle',
      error: error.message,
    });
  }
});

// PATCH /api/vehicles/:id/status - Update vehicle status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['active', 'maintenance', 'inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status value',
      });
    }
    
    const vehicle = await Vehicle.findByIdAndUpdate(
      req.params.id,
      { 
        status,
        updatedBy: req.body.updatedBy || 'admin'
      },
      { new: true }
    );
    
    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }
    
    res.json({
      success: true,
      message: 'Vehicle status updated successfully',
      data: vehicle,
    });
  } catch (error) {
    console.error('Error updating vehicle status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update vehicle status',
      error: error.message,
    });
  }
});

module.exports = router;
