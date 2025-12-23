const express = require("express");
const router = express.Router();
const ProductTracking = require("../models/ProductTracking");
const Product = require("../models/Product");
const SupplierOrder = require("../models/SupplierOrder");

// ============================================
// DASHBOARD & STATISTICS
// ============================================

// GET tracking dashboard summary
router.get("/dashboard/summary", async (req, res) => {
  try {
    const summary = await ProductTracking.getTrackingSummary();
    
    // Get expiring soon (next 30 days)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    
    const expiringSoon = await ProductTracking.countDocuments({
      expiryDate: { $lte: thirtyDaysFromNow, $gte: new Date() },
      currentStatus: { $in: ["in_storage", "reserved", "allocated"] },
    });
    
    // Get today's deliveries
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const deliveredToday = await ProductTracking.countDocuments({
      deliveryDate: { $gte: today, $lt: tomorrow },
      currentStatus: "delivered",
    });
    
    // Get recent activity
    const recentActivity = await ProductTracking.find({})
      .sort({ updatedAt: -1 })
      .limit(10)
      .select("uti productName currentStatus currentLocation updatedAt");
    
    res.json({
      success: true,
      data: {
        summary,
        expiringSoon,
        deliveredToday,
        recentActivity,
      },
    });
  } catch (error) {
    console.error("Dashboard summary error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// PRODUCT TRACKING CRUD
// ============================================

// GET all tracking items with filters
router.get("/", async (req, res) => {
  try {
    const {
      status,
      productId,
      batchId,
      location,
      zone,
      supplierOrderNumber,
      customerOrderId,
      search,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const query = {};

    if (status) query.currentStatus = status;
    if (productId) query.productId = productId;
    if (batchId) query.batchId = batchId;
    if (zone) query["currentLocation.warehouseZone"] = zone;
    if (location) query["currentLocation.shelfLocation"] = { $regex: location, $options: "i" };
    if (supplierOrderNumber) query.supplierOrderNumber = supplierOrderNumber;
    if (customerOrderId) query.customerOrderId = customerOrderId;

    if (search) {
      query.$or = [
        { uti: { $regex: search, $options: "i" } },
        { productName: { $regex: search, $options: "i" } },
        { productId: { $regex: search, $options: "i" } },
        { batchId: { $regex: search, $options: "i" } },
        { serialNumber: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

    const [items, total] = await Promise.all([
      ProductTracking.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit))
        .select("-movementHistory -statusHistory -qualityChecks"),
      ProductTracking.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: items,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Get tracking items error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single tracking item by UTI
router.get("/uti/:uti", async (req, res) => {
  try {
    const item = await ProductTracking.findOne({ uti: req.params.uti })
      .populate("productRef", "productId productName category")
      .populate("supplierOrderRef", "orderNumber supplierName");

    if (!item) {
      return res.status(404).json({ success: false, message: "Tracking item not found" });
    }

    res.json({ success: true, data: item });
  } catch (error) {
    console.error("Get tracking item error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET single tracking item by ID
router.get("/:id", async (req, res) => {
  try {
    const item = await ProductTracking.findById(req.params.id)
      .populate("productRef", "productId productName category")
      .populate("supplierOrderRef", "orderNumber supplierName");

    if (!item) {
      return res.status(404).json({ success: false, message: "Tracking item not found" });
    }

    res.json({ success: true, data: item });
  } catch (error) {
    console.error("Get tracking item error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST create new tracking items (bulk create for receiving shipments)
router.post("/receive", async (req, res) => {
  try {
    const {
      productId,
      productName,
      productRef: providedProductRef,
      supplierOrderRef,
      supplierOrderNumber,
      supplierName,
      quantity,
      batchNumber,
      manufacturingDate,
      expiryDate,
      initialLocation,
      receivedBy,
    } = req.body;

    if (!productId || !quantity || quantity < 1) {
      return res.status(400).json({
        success: false,
        message: "Product ID and quantity are required",
      });
    }

    // Look up the product to get its ObjectId
    let productRef = providedProductRef;
    let finalProductName = productName;
    
    if (!productRef) {
      // Try to find product by productId
      const product = await Product.findOne({ productId: productId });
      if (product) {
        productRef = product._id;
        finalProductName = finalProductName || product.productName;
      } else {
        // If product doesn't exist, create tracking without productRef
        // (This makes the system more flexible for testing)
        console.warn(`Product with ID ${productId} not found. Creating tracking without productRef.`);
      }
    }

    // Generate batch ID (format: BYYMMDD)
    const today = new Date();
    const batchId = `B${today.getFullYear().toString().slice(-2)}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

    // Find existing units in this batch to get next unit number
    const existingCount = await ProductTracking.countDocuments({
      productId,
      batchId,
    });

    const createdItems = [];

    for (let i = 0; i < quantity; i++) {
      const unitNumber = existingCount + i + 1;
      const uti = ProductTracking.generateUTI(productId, batchId, unitNumber);

      const trackingData = {
        uti,
        qrCode: uti,
        productId,
        productName: finalProductName || productId,
        batchId,
        batchNumber,
        unitNumber,
        manufacturingDate,
        expiryDate,
        supplierOrderRef,
        supplierOrderNumber,
        supplierName,
        currentStatus: "received",
        currentLocation: {
          locationType: "warehouse",
          warehouseZone: initialLocation?.zone || "Receiving",
          shelfLocation: initialLocation?.shelf || "Dock",
          details: "Just received from supplier",
          lastUpdated: new Date(),
        },
        condition: "new",
        createdBy: receivedBy || "System",
        lastModifiedBy: receivedBy || "System",
        movementHistory: [
          {
            timestamp: new Date(),
            fromLocation: { type: "supplier", details: supplierName || "Supplier" },
            toLocation: { type: "warehouse", details: initialLocation?.zone || "Receiving Dock" },
            movedBy: receivedBy || "System",
            reason: "receiving",
            status: "received",
            notes: `Received from supplier order ${supplierOrderNumber || "N/A"}`,
          },
        ],
      };

      // Only add productRef if we found the product
      if (productRef) {
        trackingData.productRef = productRef;
      }

      const trackingItem = new ProductTracking(trackingData);

      await trackingItem.save();
      createdItems.push(trackingItem);
    }

    res.status(201).json({
      success: true,
      message: `Created ${createdItems.length} tracking items`,
      data: {
        batchId,
        items: createdItems.map((item) => ({
          uti: item.uti,
          unitNumber: item.unitNumber,
        })),
      },
    });
  } catch (error) {
    console.error("Receive items error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH update status and location
router.patch("/:id/status", async (req, res) => {
  try {
    const { status, location, changedBy, reason, notes } = req.body;

    const item = await ProductTracking.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: "Tracking item not found" });
    }

    // Update using instance method
    await item.updateStatusAndLocation(
      status,
      location || item.currentLocation,
      changedBy,
      reason,
      notes
    );

    res.json({ success: true, data: item });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH update location only (for moving items)
router.patch("/:id/move", async (req, res) => {
  try {
    const { zone, shelf, movedBy, reason, notes } = req.body;

    const item = await ProductTracking.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: "Tracking item not found" });
    }

    const newLocation = {
      locationType: "warehouse",
      warehouseZone: zone,
      shelfLocation: shelf,
      details: `${zone} - ${shelf}`,
      lastUpdated: new Date(),
    };

    // Add movement history
    item.movementHistory.push({
      timestamp: new Date(),
      fromLocation: {
        type: item.currentLocation.locationType,
        details: `${item.currentLocation.warehouseZone} - ${item.currentLocation.shelfLocation}`,
      },
      toLocation: {
        type: "warehouse",
        details: `${zone} - ${shelf}`,
      },
      movedBy: movedBy || "System",
      reason: reason || "storage",
      status: item.currentStatus,
      notes,
    });

    item.currentLocation = newLocation;
    item.lastModifiedBy = movedBy || "System";

    await item.save();

    res.json({ success: true, data: item });
  } catch (error) {
    console.error("Move item error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// BATCH MANAGEMENT
// ============================================

// GET all batches
router.get("/batches/list", async (req, res) => {
  try {
    const { productId, includeExpired } = req.query;

    const match = {};
    if (productId) match.productId = productId;
    if (!includeExpired) {
      match.expiryDate = { $gte: new Date() };
    }

    const batches = await ProductTracking.aggregate([
      { $match: match },
      {
        $group: {
          _id: { batchId: "$batchId", productId: "$productId" },
          productName: { $first: "$productName" },
          batchNumber: { $first: "$batchNumber" },
          manufacturingDate: { $first: "$manufacturingDate" },
          expiryDate: { $first: "$expiryDate" },
          receivedDate: { $first: "$receivedDate" },
          supplierName: { $first: "$supplierName" },
          totalUnits: { $sum: 1 },
          inStorage: {
            $sum: { $cond: [{ $eq: ["$currentStatus", "in_storage"] }, 1, 0] },
          },
          delivered: {
            $sum: { $cond: [{ $eq: ["$currentStatus", "delivered"] }, 1, 0] },
          },
          damaged: {
            $sum: { $cond: [{ $eq: ["$currentStatus", "damaged"] }, 1, 0] },
          },
        },
      },
      { $sort: { "_id.batchId": -1 } },
    ]);

    res.json({
      success: true,
      data: batches.map((b) => ({
        batchId: b._id.batchId,
        productId: b._id.productId,
        ...b,
      })),
    });
  } catch (error) {
    console.error("Get batches error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET expiring batches
router.get("/batches/expiring", async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + days);

    const expiringBatches = await ProductTracking.aggregate([
      {
        $match: {
          expiryDate: { $lte: futureDate, $gte: new Date() },
          currentStatus: { $in: ["in_storage", "reserved", "allocated"] },
        },
      },
      {
        $group: {
          _id: { batchId: "$batchId", productId: "$productId" },
          productName: { $first: "$productName" },
          expiryDate: { $first: "$expiryDate" },
          unitsAtRisk: { $sum: 1 },
        },
      },
      {
        $addFields: {
          daysUntilExpiry: {
            $divide: [{ $subtract: ["$expiryDate", new Date()] }, 1000 * 60 * 60 * 24],
          },
        },
      },
      { $sort: { expiryDate: 1 } },
    ]);

    res.json({ success: true, data: expiringBatches });
  } catch (error) {
    console.error("Get expiring batches error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// LOCATION MANAGEMENT
// ============================================

// GET locations with counts
router.get("/locations/summary", async (req, res) => {
  try {
    const locations = await ProductTracking.aggregate([
      {
        $match: {
          "currentLocation.locationType": "warehouse",
          currentStatus: { $in: ["in_storage", "reserved", "allocated"] },
        },
      },
      {
        $group: {
          _id: {
            zone: "$currentLocation.warehouseZone",
            shelf: "$currentLocation.shelfLocation",
          },
          count: { $sum: 1 },
          products: { $addToSet: "$productName" },
        },
      },
      { $sort: { "_id.zone": 1, "_id.shelf": 1 } },
    ]);

    // Group by zone
    const zonesSummary = await ProductTracking.aggregate([
      {
        $match: {
          "currentLocation.locationType": "warehouse",
          currentStatus: { $in: ["in_storage", "reserved", "allocated"] },
        },
      },
      {
        $group: {
          _id: "$currentLocation.warehouseZone",
          totalUnits: { $sum: 1 },
          shelfCount: { $addToSet: "$currentLocation.shelfLocation" },
        },
      },
      {
        $project: {
          zone: "$_id",
          totalUnits: 1,
          uniqueShelves: { $size: "$shelfCount" },
        },
      },
      { $sort: { zone: 1 } },
    ]);

    res.json({
      success: true,
      data: {
        zones: zonesSummary,
        locations,
      },
    });
  } catch (error) {
    console.error("Get locations error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// QUALITY CONTROL
// ============================================

// GET items pending quality check
router.get("/quality/pending", async (req, res) => {
  try {
    const pendingItems = await ProductTracking.find({
      currentStatus: "quality_check",
    })
      .sort({ createdAt: 1 })
      .select("uti productName productId batchId receivedDate currentLocation");

    // Also get recently received items without quality checks
    const noQualityCheck = await ProductTracking.find({
      currentStatus: "received",
      qualityChecks: { $size: 0 },
    })
      .sort({ receivedDate: 1 })
      .limit(50)
      .select("uti productName productId batchId receivedDate currentLocation");

    res.json({
      success: true,
      data: {
        inProgress: pendingItems,
        needsCheck: noQualityCheck,
        totalPending: pendingItems.length + noQualityCheck.length,
      },
    });
  } catch (error) {
    console.error("Get pending quality checks error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST add quality check
router.post("/:id/quality-check", async (req, res) => {
  try {
    const { status, condition, issues, notes, checkedBy, photos } = req.body;

    const item = await ProductTracking.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: "Tracking item not found" });
    }

    // Add quality check
    item.qualityChecks.push({
      checkDate: new Date(),
      checkedBy,
      status,
      condition,
      issues: issues || [],
      notes,
      photos: photos || [],
    });

    // Update item condition
    item.condition = condition;

    // Update status based on quality check result
    if (status === "passed") {
      item.currentStatus = "in_storage";
    } else if (status === "failed") {
      item.currentStatus = "damaged";
    }

    item.lastModifiedBy = checkedBy;
    await item.save();

    res.json({ success: true, data: item });
  } catch (error) {
    console.error("Add quality check error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET quality check history
router.get("/quality/history", async (req, res) => {
  try {
    const { days = 7, status } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const match = {
      "qualityChecks.checkDate": { $gte: startDate },
    };

    if (status) {
      match["qualityChecks.status"] = status;
    }

    const history = await ProductTracking.find(match)
      .sort({ "qualityChecks.checkDate": -1 })
      .limit(100)
      .select("uti productName productId batchId qualityChecks condition");

    res.json({ success: true, data: history });
  } catch (error) {
    console.error("Get quality history error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// REPORTS
// ============================================

// GET inventory report
router.get("/reports/inventory", async (req, res) => {
  try {
    const report = await ProductTracking.aggregate([
      {
        $group: {
          _id: "$productId",
          productName: { $first: "$productName" },
          totalUnits: { $sum: 1 },
          inStorage: {
            $sum: { $cond: [{ $eq: ["$currentStatus", "in_storage"] }, 1, 0] },
          },
          reserved: {
            $sum: { $cond: [{ $eq: ["$currentStatus", "reserved"] }, 1, 0] },
          },
          inTransit: {
            $sum: { $cond: [{ $eq: ["$currentStatus", "in_transit"] }, 1, 0] },
          },
          delivered: {
            $sum: { $cond: [{ $eq: ["$currentStatus", "delivered"] }, 1, 0] },
          },
          damaged: {
            $sum: { $cond: [{ $eq: ["$currentStatus", "damaged"] }, 1, 0] },
          },
        },
      },
      { $sort: { productName: 1 } },
    ]);

    res.json({ success: true, data: report });
  } catch (error) {
    console.error("Get inventory report error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET movement report
router.get("/reports/movements", async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const movements = await ProductTracking.aggregate([
      { $unwind: "$movementHistory" },
      { $match: { "movementHistory.timestamp": { $gte: startDate } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$movementHistory.timestamp" } },
            reason: "$movementHistory.reason",
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.date": -1, "_id.reason": 1 } },
    ]);

    res.json({ success: true, data: movements });
  } catch (error) {
    console.error("Get movement report error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// SEARCH
// ============================================

// Advanced search
router.post("/search", async (req, res) => {
  try {
    const {
      query,
      filters,
      dateRange,
      page = 1,
      limit = 20,
    } = req.body;

    const searchQuery = {};

    // Text search
    if (query) {
      searchQuery.$or = [
        { uti: { $regex: query, $options: "i" } },
        { productName: { $regex: query, $options: "i" } },
        { productId: { $regex: query, $options: "i" } },
        { batchId: { $regex: query, $options: "i" } },
        { serialNumber: { $regex: query, $options: "i" } },
        { supplierOrderNumber: { $regex: query, $options: "i" } },
        { customerOrderId: { $regex: query, $options: "i" } },
      ];
    }

    // Apply filters
    if (filters) {
      if (filters.status) searchQuery.currentStatus = filters.status;
      if (filters.productId) searchQuery.productId = filters.productId;
      if (filters.batchId) searchQuery.batchId = filters.batchId;
      if (filters.zone) searchQuery["currentLocation.warehouseZone"] = filters.zone;
      if (filters.condition) searchQuery.condition = filters.condition;
      if (filters.supplierName) searchQuery.supplierName = { $regex: filters.supplierName, $options: "i" };
    }

    // Date range
    if (dateRange) {
      if (dateRange.from) {
        searchQuery.createdAt = { $gte: new Date(dateRange.from) };
      }
      if (dateRange.to) {
        searchQuery.createdAt = { ...searchQuery.createdAt, $lte: new Date(dateRange.to) };
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [results, total] = await Promise.all([
      ProductTracking.find(searchQuery)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select("-movementHistory -statusHistory"),
      ProductTracking.countDocuments(searchQuery),
    ]);

    res.json({
      success: true,
      data: results,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ============================================
// SETTINGS / CONFIGURATION
// ============================================

// GET warehouse zones (static for now, can be made dynamic)
router.get("/config/zones", async (req, res) => {
  try {
    // Get unique zones from existing data
    const zones = await ProductTracking.distinct("currentLocation.warehouseZone");
    
    // Default zones if none exist
    const defaultZones = ["Zone A", "Zone B", "Zone C", "Receiving", "Packing Area", "Loading Dock"];
    const allZones = [...new Set([...zones, ...defaultZones])].filter(Boolean);

    res.json({ success: true, data: allZones });
  } catch (error) {
    console.error("Get zones error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET status options
router.get("/config/statuses", async (req, res) => {
  const statuses = [
    { value: "received", label: "Received", color: "#3b82f6" },
    { value: "in_storage", label: "In Storage", color: "#10b981" },
    { value: "reserved", label: "Reserved", color: "#f59e0b" },
    { value: "allocated", label: "Allocated", color: "#8b5cf6" },
    { value: "packed", label: "Packed", color: "#06b6d4" },
    { value: "loaded", label: "Loaded", color: "#6366f1" },
    { value: "in_transit", label: "In Transit", color: "#ec4899" },
    { value: "delivered", label: "Delivered", color: "#22c55e" },
    { value: "returned", label: "Returned", color: "#f97316" },
    { value: "damaged", label: "Damaged", color: "#ef4444" },
    { value: "lost", label: "Lost", color: "#dc2626" },
    { value: "disposed", label: "Disposed", color: "#6b7280" },
    { value: "quality_check", label: "Quality Check", color: "#a855f7" },
    { value: "recalled", label: "Recalled", color: "#b91c1c" },
  ];

  res.json({ success: true, data: statuses });
});

module.exports = router;
