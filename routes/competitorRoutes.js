const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Competitor = require('../models/Competitor');
const Product = require('../models/Product');

// Configure multer for competitor image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads/competitors');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
  }
});

// Upload fields for competitor photos
const uploadFields = upload.fields([
  { name: 'photoLocation', maxCount: 1 },
  { name: 'photoShopFar', maxCount: 1 },
  { name: 'photoShopClose', maxCount: 1 },
  { name: 'photoStreetLeft', maxCount: 1 },
  { name: 'photoStreetRight', maxCount: 1 }
]);

// Generate next competitor ID
router.get('/generate-id', async (req, res) => {
  try {
    const competitorId = await Competitor.generateCompetitorId();
    res.json({ competitorId });
  } catch (error) {
    console.error('Error generating competitor ID:', error);
    res.status(500).json({ message: 'Error generating competitor ID', error: error.message });
  }
});

// Search products for adding to competitor - MUST be before /:id route
router.get('/products/search', async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const products = await Product.find({
      $or: [
        { productName: { $regex: query, $options: 'i' } },
        { brand: { $regex: query, $options: 'i' } },
        { productId: { $regex: query, $options: 'i' } }
      ]
    })
    .select('productName brand productId price images')
    .limit(20);

    res.json(products);
  } catch (error) {
    console.error('Error searching products:', error);
    res.status(500).json({ message: 'Error searching products', error: error.message });
  }
});

// Get all competitors
router.get('/', async (req, res) => {
  try {
    const competitors = await Competitor.find()
      .populate('products.productId', 'productName brand productId')
      .sort({ createdAt: -1 });
    res.json(competitors);
  } catch (error) {
    console.error('Error fetching competitors:', error);
    res.status(500).json({ message: 'Error fetching competitors', error: error.message });
  }
});

// Get single competitor by ID
router.get('/:id', async (req, res) => {
  try {
    const competitor = await Competitor.findById(req.params.id)
      .populate('products.productId', 'productName brand productId price images');
    
    if (!competitor) {
      return res.status(404).json({ message: 'Competitor not found' });
    }
    
    res.json(competitor);
  } catch (error) {
    console.error('Error fetching competitor:', error);
    res.status(500).json({ message: 'Error fetching competitor', error: error.message });
  }
});

// Create new competitor
router.post('/', uploadFields, async (req, res) => {
  try {
    const {
      competitorId,
      name,
      googleMapsLocation,
      phoneNumber,
      shopSize,
      geo1,
      geo2,
      geo3
    } = req.body;

    if (!name) {
      return res.status(400).json({ message: 'Competitor name is required' });
    }

    // Generate ID if not provided
    const finalCompetitorId = competitorId || await Competitor.generateCompetitorId();

    // Get file paths from uploaded files
    const files = req.files || {};
    const getFilePath = (fieldName) => {
      if (files[fieldName] && files[fieldName][0]) {
        return `/uploads/competitors/${files[fieldName][0].filename}`;
      }
      return '';
    };

    const competitor = new Competitor({
      competitorId: finalCompetitorId,
      name,
      googleMapsLocation: googleMapsLocation || '',
      phoneNumber: phoneNumber || '',
      shopSize: shopSize || 'small',
      geo1: geo1 || '',
      geo2: geo2 || '',
      geo3: geo3 || '',
      photoLocation: getFilePath('photoLocation'),
      photoShopFar: getFilePath('photoShopFar'),
      photoShopClose: getFilePath('photoShopClose'),
      photoStreetLeft: getFilePath('photoStreetLeft'),
      photoStreetRight: getFilePath('photoStreetRight'),
      products: []
    });

    const savedCompetitor = await competitor.save();
    res.status(201).json(savedCompetitor);
  } catch (error) {
    console.error('Error creating competitor:', error);
    res.status(500).json({ message: 'Error creating competitor', error: error.message });
  }
});

// Update competitor
router.put('/:id', uploadFields, async (req, res) => {
  try {
    const {
      name,
      googleMapsLocation,
      phoneNumber,
      shopSize,
      geo1,
      geo2,
      geo3
    } = req.body;

    const updateData = {
      name,
      googleMapsLocation,
      phoneNumber,
      shopSize,
      geo1,
      geo2,
      geo3
    };

    // Update file paths if new files uploaded
    const files = req.files || {};
    if (files.photoLocation && files.photoLocation[0]) {
      updateData.photoLocation = `/uploads/competitors/${files.photoLocation[0].filename}`;
    }
    if (files.photoShopFar && files.photoShopFar[0]) {
      updateData.photoShopFar = `/uploads/competitors/${files.photoShopFar[0].filename}`;
    }
    if (files.photoShopClose && files.photoShopClose[0]) {
      updateData.photoShopClose = `/uploads/competitors/${files.photoShopClose[0].filename}`;
    }
    if (files.photoStreetLeft && files.photoStreetLeft[0]) {
      updateData.photoStreetLeft = `/uploads/competitors/${files.photoStreetLeft[0].filename}`;
    }
    if (files.photoStreetRight && files.photoStreetRight[0]) {
      updateData.photoStreetRight = `/uploads/competitors/${files.photoStreetRight[0].filename}`;
    }

    const competitor = await Competitor.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!competitor) {
      return res.status(404).json({ message: 'Competitor not found' });
    }

    res.json(competitor);
  } catch (error) {
    console.error('Error updating competitor:', error);
    res.status(500).json({ message: 'Error updating competitor', error: error.message });
  }
});

// Delete competitor
router.delete('/:id', async (req, res) => {
  try {
    const competitor = await Competitor.findByIdAndDelete(req.params.id);
    
    if (!competitor) {
      return res.status(404).json({ message: 'Competitor not found' });
    }

    res.json({ message: 'Competitor deleted successfully' });
  } catch (error) {
    console.error('Error deleting competitor:', error);
    res.status(500).json({ message: 'Error deleting competitor', error: error.message });
  }
});

// Add product to competitor
router.post('/:id/products', async (req, res) => {
  try {
    const { productId, price, date } = req.body;

    if (!productId || price === undefined) {
      return res.status(400).json({ message: 'Product ID and price are required' });
    }

    // Verify product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const competitor = await Competitor.findById(req.params.id);
    if (!competitor) {
      return res.status(404).json({ message: 'Competitor not found' });
    }

    // Check if product already added
    const existingProduct = competitor.products.find(
      p => p.productId.toString() === productId
    );

    if (existingProduct) {
      // Update price and date if product exists
      existingProduct.price = price;
      existingProduct.date = date || Date.now();
      existingProduct.addedAt = Date.now();
    } else {
      // Add new product
      competitor.products.push({
        productId,
        price,
        date: date || Date.now(),
        addedAt: Date.now()
      });
    }

    await competitor.save();
    
    // Return populated competitor
    const updatedCompetitor = await Competitor.findById(req.params.id)
      .populate('products.productId', 'productName brand productId price images');

    res.json(updatedCompetitor);
  } catch (error) {
    console.error('Error adding product to competitor:', error);
    res.status(500).json({ message: 'Error adding product to competitor', error: error.message });
  }
});

// Remove product from competitor
router.delete('/:id/products/:productId', async (req, res) => {
  try {
    const competitor = await Competitor.findById(req.params.id);
    
    if (!competitor) {
      return res.status(404).json({ message: 'Competitor not found' });
    }

    competitor.products = competitor.products.filter(
      p => p.productId.toString() !== req.params.productId
    );

    await competitor.save();

    const updatedCompetitor = await Competitor.findById(req.params.id)
      .populate('products.productId', 'productName brand productId price images');

    res.json(updatedCompetitor);
  } catch (error) {
    console.error('Error removing product from competitor:', error);
    res.status(500).json({ message: 'Error removing product from competitor', error: error.message });
  }
});

module.exports = router;
