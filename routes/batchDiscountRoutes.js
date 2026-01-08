const express = require("express");
const router = express.Router();
const BatchDiscount = require("../models/BatchDiscount");
const DiscountEligibility = require("../models/DiscountEligibility");
const Product = require("../models/Product");

/**
 * Batch Discount Routes
 * Manages batch discount allocation and eligibility checking
 */

// ─────────────────────────────────────────────────────────────────
// 1) CREATE BATCH DISCOUNT
// ─────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const {
      discountCategory,
      productId,
      discountPrice,
      originalPrice,
      categories // Array of category strings if multiple selected
    } = req.body;

    // Validate required fields
    if (!discountPrice || !originalPrice) {
      return res.status(400).json({
        success: false,
        message: "Discount price and original price are required"
      });
    }

    // Calculate discount percentage
    const discountPercentage = ((originalPrice - discountPrice) / originalPrice) * 100;

    // Get the product
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found"
      });
    }

    // Handle multiple categories or single category
    const categoriesToProcess = categories || [discountCategory];
    const createdBatches = [];

    for (const category of categoriesToProcess) {
      // Generate batch number
      const batchNumber = await BatchDiscount.generateBatchNumber();

      // Create batch discount
      const batchDiscount = new BatchDiscount({
        batchNumber,
        discountCategory: category,
        displayName: BatchDiscount.getCategoryInfo(category)?.displayName || category,
        products: [{
          productId: product._id,
          productCode: product.productId,
          productName: product.productName
        }],
        discountPrice,
        discountPercentage: Math.round(discountPercentage * 100) / 100,
        originalPrice,
        createdBy: req.body.createdBy || "Admin"
      });

      await batchDiscount.save();

      // Add to product's batchDiscounts array
      product.batchDiscounts.push({
        category,
        batchNumber,
        discountPrice,
        discountPercentage: Math.round(discountPercentage * 100) / 100,
        originalPriceAtCreation: originalPrice,
        isActive: true
      });

      createdBatches.push(batchDiscount);
    }

    await product.save();

    res.status(201).json({
      success: true,
      message: `Created ${createdBatches.length} batch discount(s)`,
      data: createdBatches,
      product: {
        _id: product._id,
        productId: product.productId,
        batchDiscounts: product.batchDiscounts
      }
    });
  } catch (err) {
    console.error("Error creating batch discount:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 2) GET ALL BATCH DISCOUNTS
// ─────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { category, isActive } = req.query;
    
    let query = {};
    if (category) query.discountCategory = category;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const batches = await BatchDiscount.find(query)
      .sort({ createdAt: -1 })
      .populate('products.productId', 'productName productId NormalPrice Stock');

    // Get analytics summary
    const summary = {
      total: batches.length,
      active: batches.filter(b => b.isActive).length,
      byCategory: {}
    };

    const categories = [
      'foremen', 'foremen_commission', 'referral_3_days',
      'new_customer_referred', 'new_customer', 'shopping_30m',
      'shopping_100m_60d', 'everyone'
    ];

    categories.forEach(cat => {
      const catBatches = batches.filter(b => b.discountCategory === cat);
      summary.byCategory[cat] = {
        count: catBatches.length,
        totalProducts: catBatches.reduce((sum, b) => sum + b.products.length, 0)
      };
    });

    res.json({
      success: true,
      count: batches.length,
      summary,
      data: batches
    });
  } catch (err) {
    console.error("Error fetching batch discounts:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 3) GET BATCH DISCOUNTS BY CATEGORY
// ─────────────────────────────────────────────────────────────────
router.get("/category/:category", async (req, res) => {
  try {
    const { category } = req.params;
    
    const categoryInfo = BatchDiscount.getCategoryInfo(category);
    if (!categoryInfo) {
      return res.status(400).json({
        success: false,
        message: "Invalid category"
      });
    }

    const batches = await BatchDiscount.find({
      discountCategory: category,
      isActive: true
    }).populate('products.productId', 'productName productId NormalPrice Stock masterImage');

    res.json({
      success: true,
      category,
      categoryInfo,
      count: batches.length,
      data: batches
    });
  } catch (err) {
    console.error("Error fetching category batches:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 4) GET ALL CATEGORY INFO
// ─────────────────────────────────────────────────────────────────
router.get("/categories/info", async (req, res) => {
  try {
    const categories = [
      'foremen', 'foremen_commission', 'referral_3_days',
      'new_customer_referred', 'new_customer', 'shopping_30m',
      'shopping_100m_60d', 'everyone'
    ];

    const categoryData = await Promise.all(categories.map(async (cat) => {
      const info = BatchDiscount.getCategoryInfo(cat);
      const count = await BatchDiscount.countDocuments({ 
        discountCategory: cat, 
        isActive: true 
      });
      const productCount = await BatchDiscount.aggregate([
        { $match: { discountCategory: cat, isActive: true } },
        { $unwind: '$products' },
        { $count: 'total' }
      ]);

      return {
        category: cat,
        ...info,
        activeBatches: count,
        totalProducts: productCount[0]?.total || 0
      };
    }));

    res.json({
      success: true,
      data: categoryData
    });
  } catch (err) {
    console.error("Error fetching category info:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 4.5) GET ELIGIBLE CUSTOMERS BY CATEGORY
// ─────────────────────────────────────────────────────────────────
router.get("/categories/eligible-customers", async (req, res) => {
  try {
    const { category } = req.query;
    const Customer = require("../models/customer");
    
    const categories = category 
      ? [category]
      : ['foremen', 'foremen_commission', 'referral_3_days', 'new_customer_referred', 'new_customer', 'shopping_30m', 'shopping_100m_60d', 'everyone'];

    const result = {};

    for (const cat of categories) {
      // Find all eligibility records where this category is active
      const eligibleRecords = await DiscountEligibility.find({
        'eligibleCategories': {
          $elemMatch: {
            category: cat,
            isActive: true
          }
        }
      }).select('phoneNumber customerName customerId').lean();

      // Also get customer details for matching phone numbers
      const phoneNumbers = eligibleRecords.map(r => r.phoneNumber);
      const customers = await Customer.find({
        phoneNumber: { $in: phoneNumbers }
      }).select('phoneNumber name email businessName totalSpent ordersCount').lean();

      // Merge data
      const customerMap = {};
      customers.forEach(c => {
        customerMap[c.phoneNumber] = c;
      });

      result[cat] = eligibleRecords.map(record => ({
        phoneNumber: record.phoneNumber,
        customerName: record.customerName || customerMap[record.phoneNumber]?.name || 'Unknown',
        customerId: record.customerId,
        email: customerMap[record.phoneNumber]?.email || null,
        businessName: customerMap[record.phoneNumber]?.businessName || null,
        totalSpent: customerMap[record.phoneNumber]?.totalSpent || 0,
        ordersCount: customerMap[record.phoneNumber]?.ordersCount || 0
      }));
    }

    res.json({
      success: true,
      data: result,
      counts: Object.fromEntries(
        Object.entries(result).map(([k, v]) => [k, v.length])
      )
    });
  } catch (err) {
    console.error("Error fetching eligible customers:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 5) GET ELIGIBLE DISCOUNTS FOR CUSTOMER
// ─────────────────────────────────────────────────────────────────
router.get("/eligible/:phoneNumber", async (req, res) => {
  try {
    const { phoneNumber } = req.params;

    // Find or create eligibility record
    let eligibility = await DiscountEligibility.findOne({ phoneNumber });
    
    if (!eligibility) {
      // Create new eligibility with everyone category
      eligibility = new DiscountEligibility({
        phoneNumber,
        accountCreatedAt: new Date()
      });
      await eligibility.save();
    }

    // Update eligibility calculations
    eligibility.updateEligibility();
    await eligibility.save();

    // Get eligible categories
    const eligibleCategories = eligibility.eligibleCategories
      .filter(e => e.isActive)
      .map(e => e.category);

    // Find products in those categories
    const eligibleProducts = await BatchDiscount.find({
      discountCategory: { $in: eligibleCategories },
      isActive: true
    }).populate('products.productId', 'productName productId NormalPrice Stock masterImage');

    // Group by category
    const productsByCategory = {};
    eligibleCategories.forEach(cat => {
      const categoryInfo = BatchDiscount.getCategoryInfo(cat);
      const catProducts = eligibleProducts
        .filter(b => b.discountCategory === cat)
        .flatMap(b => b.products.map(p => ({
          ...p.productId?.toObject(),
          batchNumber: b.batchNumber,
          discountPrice: b.discountPrice,
          discountPercentage: b.discountPercentage
        })));

      productsByCategory[cat] = {
        displayName: categoryInfo?.displayName || cat,
        description: categoryInfo?.description || '',
        productCount: catProducts.length,
        products: catProducts
      };
    });

    res.json({
      success: true,
      phoneNumber,
      eligibleCategories,
      productsByCategory,
      eligibilityDetails: eligibility.eligibleCategories
    });
  } catch (err) {
    console.error("Error checking eligibility:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 6) UPDATE BATCH DISCOUNT
// ─────────────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Recalculate percentage if prices changed
    if (updates.discountPrice && updates.originalPrice) {
      updates.discountPercentage = 
        ((updates.originalPrice - updates.discountPrice) / updates.originalPrice) * 100;
      updates.discountPercentage = Math.round(updates.discountPercentage * 100) / 100;
    }

    const batch = await BatchDiscount.findByIdAndUpdate(
      id,
      { ...updates, updatedAt: new Date() },
      { new: true }
    );

    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch discount not found"
      });
    }

    res.json({
      success: true,
      message: "Batch discount updated",
      data: batch
    });
  } catch (err) {
    console.error("Error updating batch discount:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 7) DELETE BATCH DISCOUNT
// ─────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const batch = await BatchDiscount.findById(id);
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch discount not found"
      });
    }

    // Remove from products
    for (const prod of batch.products) {
      await Product.findByIdAndUpdate(prod.productId, {
        $pull: { batchDiscounts: { batchNumber: batch.batchNumber } }
      });
    }

    await batch.deleteOne();

    res.json({
      success: true,
      message: "Batch discount deleted"
    });
  } catch (err) {
    console.error("Error deleting batch discount:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 8) ADD PRODUCTS TO EXISTING BATCH
// ─────────────────────────────────────────────────────────────────
router.post("/:id/products", async (req, res) => {
  try {
    const { id } = req.params;
    const { productIds } = req.body;

    const batch = await BatchDiscount.findById(id);
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: "Batch discount not found"
      });
    }

    const addedProducts = [];
    for (const productId of productIds) {
      const product = await Product.findById(productId);
      if (product) {
        // Add to batch
        batch.products.push({
          productId: product._id,
          productCode: product.productId,
          productName: product.productName
        });

        // Add to product
        product.batchDiscounts.push({
          category: batch.discountCategory,
          batchNumber: batch.batchNumber,
          discountPrice: batch.discountPrice,
          discountPercentage: batch.discountPercentage,
          originalPriceAtCreation: batch.originalPrice,
          isActive: true
        });

        await product.save();
        addedProducts.push(product.productId);
      }
    }

    await batch.save();

    res.json({
      success: true,
      message: `Added ${addedProducts.length} products to batch`,
      addedProducts
    });
  } catch (err) {
    console.error("Error adding products to batch:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 9) ANALYTICS ENDPOINT
// ─────────────────────────────────────────────────────────────────
router.get("/analytics/summary", async (req, res) => {
  try {
    const categories = [
      'foremen', 'foremen_commission', 'referral_3_days',
      'new_customer_referred', 'new_customer', 'shopping_30m',
      'shopping_100m_60d', 'everyone'
    ];

    // Get eligibility counts
    const eligibilityCounts = {};
    for (const cat of categories) {
      const count = await DiscountEligibility.countDocuments({
        'eligibleCategories.category': cat,
        'eligibleCategories.isActive': true
      });
      eligibilityCounts[cat] = count;
    }

    // Get usage statistics
    const usageStats = await DiscountEligibility.aggregate([
      { $unwind: '$discountsUsed' },
      { $group: {
        _id: '$discountsUsed.category',
        usageCount: { $sum: 1 },
        totalSaved: { $sum: '$discountsUsed.savedAmount' }
      }}
    ]);

    const usageByCategory = {};
    usageStats.forEach(stat => {
      usageByCategory[stat._id] = {
        used: stat.usageCount,
        totalSaved: stat.totalSaved
      };
    });

    // Combine data
    const analytics = categories.map(cat => {
      const info = BatchDiscount.getCategoryInfo(cat);
      const eligible = eligibilityCounts[cat] || 0;
      const usage = usageByCategory[cat] || { used: 0, totalSaved: 0 };
      const usagePercentage = eligible > 0 ? Math.round((usage.used / eligible) * 100) : 0;

      return {
        category: cat,
        displayName: info?.displayName || cat,
        eligible,
        used: usage.used,
        usagePercentage,
        totalSaved: usage.totalSaved
      };
    });

    res.json({
      success: true,
      data: {
        eligibilityCounts,
        analytics,
        summary: {
          totalEligible: Object.values(eligibilityCounts).reduce((a, b) => a + b, 0),
          totalUsed: usageStats.reduce((sum, s) => sum + s.usageCount, 0),
          totalSaved: usageStats.reduce((sum, s) => sum + s.totalSaved, 0)
        }
      }
    });
  } catch (err) {
    console.error("Error fetching analytics:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────
// 10) UPDATE CUSTOMER ELIGIBILITY
// ─────────────────────────────────────────────────────────────────
router.put("/eligibility/:phoneNumber", async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const updates = req.body;

    let eligibility = await DiscountEligibility.findOne({ phoneNumber });
    
    if (!eligibility) {
      eligibility = new DiscountEligibility({ phoneNumber });
    }

    // Update fields
    Object.assign(eligibility, updates);
    
    // Recalculate eligibility
    eligibility.updateEligibility();
    
    await eligibility.save();

    res.json({
      success: true,
      message: "Eligibility updated",
      data: eligibility
    });
  } catch (err) {
    console.error("Error updating eligibility:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message
    });
  }
});

module.exports = router;
