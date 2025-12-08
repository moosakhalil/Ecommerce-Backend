const express = require('express');
const router = express.Router();
const VehicleTemplate = require('../models/VehicleTemplate');

// GET /api/vehicle-templates - List all templates
router.get('/', async (req, res) => {
  try {
    const { type } = req.query;
    
    let query = {};
    
    if (type) {
      query.vehicleType = type;
    }
    
    const templates = await VehicleTemplate.find(query).sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: templates,
      count: templates.length,
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch templates',
      error: error.message,
    });
  }
});

// GET /api/vehicle-templates/:id - Get single template
router.get('/:id', async (req, res) => {
  try {
    const template = await VehicleTemplate.findById(req.params.id);
    
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Template not found',
      });
    }
    
    res.json({
      success: true,
      data: template,
    });
  } catch (error) {
    console.error('Error fetching template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch template',
      error: error.message,
    });
  }
});

// POST /api/vehicle-templates - Create new template
router.post('/', async (req, res) => {
  try {
    const templateData = {
      vehicleType: req.body.vehicleType,
      weightMaxKg: req.body.weightMaxKg,
      loadLimitPercent: req.body.loadLimitPercent || 80,
      maxPackageLength: req.body.maxPackageLength,
    };
    
    // Add truck-specific fields
    if (req.body.vehicleType === 'truck') {
      templateData.truckTypeName = req.body.truckTypeName;
      
      // Handle dimensions
      if (req.body.dimensions) {
        templateData.dimensions = {
          heightCm: req.body.dimensions.heightCm,
          widthCm: req.body.dimensions.widthCm,
          lengthCm: req.body.dimensions.lengthCm,
        };
      } else {
        templateData.dimensions = {
          heightCm: req.body.heightCm || req.body['dimensions[heightCm]'],
          widthCm: req.body.widthCm || req.body['dimensions[widthCm]'],
          lengthCm: req.body.lengthCm || req.body['dimensions[lengthCm]'],
        };
      }
    }
    
    // Add scooter-specific fields
    if (req.body.vehicleType === 'scooter') {
      templateData.scooterTypeName = req.body.scooterTypeName;
      templateData.maxPackages = req.body.maxPackages;
    }
    
    // Check if template with same specifications already exists
    const existingTemplate = await VehicleTemplate.findOne({
      vehicleType: templateData.vehicleType,
      weightMaxKg: templateData.weightMaxKg,
      ...(templateData.truckTypeName && { truckTypeName: templateData.truckTypeName }),
      ...(templateData.scooterTypeName && { scooterTypeName: templateData.scooterTypeName }),
    });
    
    if (existingTemplate) {
      // Return existing template instead of creating duplicate
      return res.status(200).json({
        success: true,
        message: 'Template already exists, reusing existing template',
        data: existingTemplate,
        reused: true,
      });
    }
    
    console.log('Creating template with data:', JSON.stringify(templateData, null, 2));
    
    const template = new VehicleTemplate(templateData);
    await template.save();
    
    console.log('Template created successfully:', template._id);
    
    res.status(201).json({
      success: true,
      message: 'Template created successfully',
      data: template,
      reused: false,
    });
  } catch (error) {
    console.error('Error creating template:', error);
    console.error('Error details:', error.message);
    if (error.errors) {
      console.error('Validation errors:', error.errors);
    }
    
    res.status(400).json({
      success: false,
      message: 'Failed to create template',
      error: error.message,
      errors: error.errors ? Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message
      })) : undefined
    });
  }
});

module.exports = router;
