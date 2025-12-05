const express = require("express");
const router = express.Router();
const Vendor = require("../models/Vendor");
const Customer = require("../models/customer");
const Product = require("../models/Product");
const Area = require("../models/Areas"); // Add Area model

// ===== VENDOR MANAGEMENT ROUTES =====

// Get all vendors with filtering and pagination
router.get("/", async (req, res) => {
  try {
    const {
      productId,
      status,
      area,
      city,
      rating,
      sortBy = "name",
      order = "asc",
      page = 1,
      limit = 20,
      search,
    } = req.query;

    console.log(`📊 Fetching vendors with filters:`, req.query);

    let query = { isActive: true };

    // Apply filters
    if (productId && productId !== "All Products") {
      query["availableProducts.productId"] = productId;
      query["availableProducts.isActive"] = true;
    }

    if (status && status !== "All Statuses") {
      query.status = status;
    }

    if (area) {
      query["serviceAreas.areaName"] = new RegExp(area, "i");
    }

    if (city) {
      query["location.city"] = new RegExp(city, "i");
    }

    if (rating) {
      query["responseMetrics.rating"] = { $gte: parseFloat(rating) };
    }

    // Search functionality
    if (search) {
      query.$or = [
        { name: new RegExp(search, "i") },
        { phone: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
        { "location.city": new RegExp(search, "i") },
        { "serviceAreas.areaName": new RegExp(search, "i") },
      ];
    }

    // Build sort object
    const sortObject = {};
    if (sortBy === "responseTime") {
      sortObject["responseMetrics.averageResponseTime"] =
        order === "desc" ? -1 : 1;
    } else if (sortBy === "rating") {
      sortObject["responseMetrics.rating"] = order === "desc" ? -1 : 1;
    } else if (sortBy === "orders") {
      sortObject["responseMetrics.totalOrders"] = order === "desc" ? -1 : 1;
    } else {
      sortObject[sortBy] = order === "desc" ? -1 : 1;
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Execute query with product details populated
    const vendors = await Vendor.find(query)
      .sort(sortObject)
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // Get total count for pagination
    const totalVendors = await Vendor.countDocuments(query);

    console.log(
      `✅ Retrieved ${vendors.length} vendors (Total: ${totalVendors})`
    );

    res.json({
      success: true,
      vendors,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalVendors / parseInt(limit)),
        totalVendors,
        hasNext: skip + vendors.length < totalVendors,
        hasPrev: page > 1,
        limit: parseInt(limit),
      },
      filters: {
        productId,
        status,
        area,
        city,
        rating,
        search,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching vendors:", error);
    res.status(500).json({
      error: "Failed to fetch vendors",
      details: error.message,
    });
  }
});

// Get vendors by product
router.get("/by-product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const { status = "Available" } = req.query;

    console.log(
      `📊 Fetching vendors for product: ${productId} with status: ${status}`
    );

    const vendors = await Vendor.findVendorsForProducts([productId]);

    // Filter by status if specified
    const filteredVendors =
      status === "All"
        ? vendors
        : vendors.filter((vendor) => vendor.status === status);

    console.log(
      `✅ Found ${filteredVendors.length} vendors for product ${productId}`
    );

    res.json({
      success: true,
      vendors: filteredVendors,
      productId,
      count: filteredVendors.length,
    });
  } catch (error) {
    console.error("❌ Error fetching vendors by product:", error);
    res.status(500).json({
      error: "Failed to fetch vendors by product",
      details: error.message,
    });
  }
});

// Get all available areas for service area selection
router.get("/available-areas", async (req, res) => {
  try {
    console.log("🗺️ Fetching available areas...");

    const areas = await Area.find({
      isActive: true,
    })
      .select("name displayName truckPrice scooterPrice")
      .sort({ displayName: 1 })
      .lean();

    console.log(`✅ Found ${areas.length} available areas`);

    res.json({
      success: true,
      areas,
      count: areas.length,
    });
  } catch (error) {
    console.error("❌ Error fetching available areas:", error);
    res.status(500).json({
      error: "Failed to fetch available areas",
      details: error.message,
    });
  }
});
// Get all available products for vendor selection
router.get("/available-products", async (req, res) => {
  try {
    console.log("📦 Fetching available products...");

    const products = await Product.find({
      visibility: "Public",
      Stock: { $gt: 0 },
    })
      .select(
        "productId productName categories subCategories NormalPrice Stock"
      )
      .sort({ productName: 1 })
      .lean();

    console.log(`✅ Found ${products.length} available products`);

    res.json({
      success: true,
      products,
      count: products.length,
    });
  } catch (error) {
    console.error("❌ Error fetching available products:", error);
    res.status(500).json({
      error: "Failed to fetch available products",
      details: error.message,
    });
  }
});

// Get vendor statistics and analytics
router.get("/stats", async (req, res) => {
  try {
    console.log("📊 Calculating vendor statistics...");

    // Get basic vendor stats
    const basicStats = await Vendor.getVendorStats();

    // Get product-wise vendor distribution
    const productStats = await Vendor.getProductStats();

    // Get area coverage stats
    const areaStats = await Vendor.getAreaCoverage();

    // Get performance metrics
    const performanceStats = await Vendor.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          averageResponseTime: { $avg: "$responseMetrics.averageResponseTime" },
          averageRating: { $avg: "$responseMetrics.rating" },
          totalCompletedOrders: { $sum: "$responseMetrics.completedOrders" },
          totalCancelledOrders: { $sum: "$responseMetrics.cancelledOrders" },
          topRatedCount: {
            $sum: { $cond: [{ $gte: ["$responseMetrics.rating", 4.5] }, 1, 0] },
          },
        },
      },
    ]);

    // Get recent activity
    const recentVendors = await Vendor.find({ isActive: true })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("name status createdAt responseMetrics.rating")
      .lean();

    const stats = {
      overview: basicStats[0] || {
        totalVendors: 0,
        activeVendors: 0,
        offlineVendors: 0,
        averageRating: 0,
        totalOrders: 0,
      },
      productDistribution: productStats,
      areaDistribution: areaStats,
      performance: performanceStats[0] || {
        averageResponseTime: 0,
        averageRating: 0,
        totalCompletedOrders: 0,
        totalCancelledOrders: 0,
        topRatedCount: 0,
      },
      recentActivity: recentVendors,
    };

    console.log("✅ Vendor statistics calculated successfully");

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error("❌ Error fetching vendor stats:", error);
    res.status(500).json({
      error: "Failed to fetch vendor statistics",
      details: error.message,
    });
  }
});

// Create new vendor
router.post("/", async (req, res) => {
  try {
    const vendorData = req.body;

    console.log("📝 Creating new vendor:", vendorData.name);

    // Validate required fields
    const requiredFields = ["name", "phone"];
    for (const field of requiredFields) {
      if (!vendorData[field]) {
        return res.status(400).json({
          error: `${field} is required`,
        });
      }
    }

    // Check for duplicate phone number
    const existingVendor = await Vendor.findOne({
      phone: vendorData.phone,
      isActive: true,
    });

    if (existingVendor) {
      return res.status(409).json({
        error: "Vendor with this phone number already exists",
      });
    }

    // Validate products if provided
    if (
      vendorData.availableProducts &&
      vendorData.availableProducts.length > 0
    ) {
      const productIds = vendorData.availableProducts.map((p) => p.productId);
      const existingProducts = await Product.find({
        productId: { $in: productIds },
      })
        .select("productId productName")
        .lean();

      // Enrich product data with names
      vendorData.availableProducts = vendorData.availableProducts.map(
        (vendorProduct) => {
          const productDetails = existingProducts.find(
            (p) => p.productId === vendorProduct.productId
          );
          return {
            ...vendorProduct,
            productName: productDetails
              ? productDetails.productName
              : vendorProduct.productName,
          };
        }
      );
    }

    const vendor = new Vendor(vendorData);
    await vendor.save();

    console.log(`✅ Created vendor: ${vendor.name} (${vendor.vendorId})`);

    res.status(201).json({
      success: true,
      message: "Vendor created successfully",
      vendor,
    });
  } catch (error) {
    console.error("❌ Error creating vendor:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        error: "Vendor with this information already exists",
      });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        error: "Validation error",
        details: Object.values(error.errors).map((e) => e.message),
      });
    }

    res.status(500).json({
      error: "Failed to create vendor",
      details: error.message,
    });
  }
});

// Update vendor
router.put("/:vendorId", async (req, res) => {
  try {
    const { vendorId } = req.params;
    const updateData = req.body;

    console.log(`📝 Updating vendor: ${vendorId}`);

    // Remove fields that shouldn't be updated directly
    delete updateData.vendorId;
    delete updateData._id;
    delete updateData.createdAt;

    const vendor = await Vendor.findOneAndUpdate(
      { vendorId: vendorId },
      { ...updateData, lastUpdated: new Date() },
      { new: true, runValidators: true }
    );

    if (!vendor) {
      return res.status(404).json({
        error: "Vendor not found",
      });
    }

    console.log(`✅ Updated vendor: ${vendor.name} (${vendor.vendorId})`);

    res.json({
      success: true,
      message: "Vendor updated successfully",
      vendor,
    });
  } catch (error) {
    console.error("❌ Error updating vendor:", error);

    if (error.name === "ValidationError") {
      return res.status(400).json({
        error: "Validation error",
        details: Object.values(error.errors).map((e) => e.message),
      });
    }

    res.status(500).json({
      error: "Failed to update vendor",
      details: error.message,
    });
  }
});

// Add product to vendor
router.post("/:vendorId/products", async (req, res) => {
  try {
    const { vendorId } = req.params;
    const productData = req.body;

    console.log(`📝 Adding product to vendor: ${vendorId}`);

    const vendor = await Vendor.findOne({ vendorId: vendorId });

    if (!vendor) {
      return res.status(404).json({
        error: "Vendor not found",
      });
    }

    // Validate product exists
    const product = await Product.findOne({ productId: productData.productId });
    if (!product) {
      return res.status(404).json({
        error: "Product not found",
      });
    }

    // Add product name to data
    productData.productName = product.productName;

    await vendor.addProduct(productData);

    console.log(`✅ Added ${product.productName} to vendor: ${vendor.name}`);

    res.json({
      success: true,
      message: "Product added successfully",
      vendor,
    });
  } catch (error) {
    console.error("❌ Error adding product:", error);
    res.status(500).json({
      error: "Failed to add product",
      details: error.message,
    });
  }
});

// In /routes/vendors.js - fix the addServiceArea endpoint
router.post("/:vendorId/service-areas", async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { areaId, deliveryCharge, estimatedDeliveryTime } = req.body;

    console.log(`📝 Adding service area to vendor: ${vendorId}`);

    const vendor = await Vendor.findOne({ vendorId: vendorId });

    if (!vendor) {
      return res.status(404).json({
        error: "Vendor not found",
      });
    }

    // Validate area exists
    const area = await Area.findById(areaId);
    if (!area) {
      return res.status(404).json({
        error: "Area not found",
      });
    }

    // FIXED: Use 'area' field instead of 'areaId'
    const areaData = {
      area: area.displayName, // This matches the vendor schema
      areaName: area.displayName,
      deliveryCharge: deliveryCharge || 0,
      estimatedDeliveryTime: estimatedDeliveryTime || "Same day",
      isActive: true,
    };

    await vendor.addServiceArea(areaData);

    console.log(
      `✅ Added service area ${area.displayName} to vendor: ${vendor.name}`
    );

    res.json({
      success: true,
      message: "Service area added successfully",
      vendor,
    });
  } catch (error) {
    console.error("❌ Error adding service area:", error);
    res.status(500).json({
      error: "Failed to add service area",
      details: error.message,
    });
  }
});
// Get products by type with simple filtering
router.get("/products/by-type", async (req, res) => {
  try {
    const {
      productType,
      search,
      category,
      subCategory,
      brand,
      inStock,
      page = 1,
      limit = 50,
    } = req.query;

    console.log("🔍 Filtering products by type:", req.query);

    let query = { visibility: "Public" };

    // Product type filter (Parent, Child, Normal)
    if (productType && productType !== "All") {
      query.productType = productType;
    }

    // Search by product ID or name
    if (search) {
      query.$or = [
        { productId: { $regex: search, $options: "i" } },
        { productName: { $regex: search, $options: "i" } },
      ];
    }

    // Category filter
    if (category && category !== "All Categories") {
      query.categories = category;
    }

    // Sub-category filter
    if (subCategory && subCategory !== "All Sub-Categories") {
      query.subCategories = subCategory;
    }

    // Brand filter
    if (brand && brand !== "All Brands") {
      query.brand = brand;
    }

    // Stock availability
    if (inStock === "true") {
      query.Stock = { $gt: 0 };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get filtered products
    const products = await Product.find(query)
      .select(
        "productId productName productType categories subCategories NormalPrice Stock brand parentProduct varianceName"
      )
      .sort({ productName: 1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    const totalProducts = await Product.countDocuments(query);

    console.log(`✅ Found ${products.length} products of type ${productType}`);

    res.json({
      success: true,
      products,
      total: totalProducts,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalProducts / parseInt(limit)),
        totalProducts,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("❌ Error filtering products by type:", error);
    res.status(500).json({
      error: "Failed to filter products",
      details: error.message,
    });
  }
});

// Get filter options for the current product type
router.get("/products/filter-options", async (req, res) => {
  try {
    const { productType } = req.query;

    let query = { visibility: "Public" };
    if (productType && productType !== "All") {
      query.productType = productType;
    }

    const categories = await Product.distinct("categories", query);
    const subCategories = await Product.distinct("subCategories", query);
    const brands = await Product.distinct("brand", query);

    res.json({
      success: true,
      categories: categories.filter(Boolean).sort(),
      subCategories: subCategories.filter(Boolean).sort(),
      brands: brands.filter(Boolean).sort(),
    });
  } catch (error) {
    console.error("❌ Error fetching filter options:", error);
    res.status(500).json({
      error: "Failed to fetch filter options",
      details: error.message,
    });
  }
});

// Toggle vendor status (Available/Offline)
router.patch("/:vendorId/status", async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { status } = req.body;

    console.log(`📝 Updating vendor status: ${vendorId} -> ${status}`);

    if (!["Available", "Offline", "Busy"].includes(status)) {
      return res.status(400).json({
        error: "Invalid status. Must be Available, Offline, or Busy",
      });
    }

    const vendor = await Vendor.findOneAndUpdate(
      { vendorId: vendorId },
      { status: status, lastUpdated: new Date() },
      { new: true }
    );

    if (!vendor) {
      return res.status(404).json({
        error: "Vendor not found",
      });
    }

    console.log(`✅ Updated vendor status: ${vendor.name} -> ${status}`);

    res.json({
      success: true,
      message: `Vendor status updated to ${status}`,
      vendor,
    });
  } catch (error) {
    console.error("❌ Error updating vendor status:", error);
    res.status(500).json({
      error: "Failed to update vendor status",
      details: error.message,
    });
  }
});

// Delete vendor (soft delete)
router.delete("/:vendorId", async (req, res) => {
  try {
    const { vendorId } = req.params;

    console.log(`🗑️ Deleting vendor: ${vendorId}`);

    const vendor = await Vendor.findOneAndUpdate(
      { vendorId: vendorId },
      { isActive: false, lastUpdated: new Date() },
      { new: true }
    );

    if (!vendor) {
      return res.status(404).json({
        error: "Vendor not found",
      });
    }

    console.log(`✅ Deleted vendor: ${vendor.name} (${vendor.vendorId})`);

    res.json({
      success: true,
      message: "Vendor deleted successfully",
      vendor,
    });
  } catch (error) {
    console.error("❌ Error deleting vendor:", error);
    res.status(500).json({
      error: "Failed to delete vendor",
      details: error.message,
    });
  }
});

// ===== ORDER MANAGEMENT ROUTES =====

// Get all orders (from customer schema) with vendor assignments
router.get("/orders/all", async (req, res) => {
  try {
    const {
      status,
      vendorId,
      area,
      customerId,
      dateFrom,
      dateTo,
      sortBy = "orderDate",
      order = "desc",
      page = 1,
      limit = 20,
      search,
    } = req.query;

    console.log("📦 Fetching all orders with vendor assignments:", req.query);

    // Get all customers with orders
    const customers = await Customer.find({
      "shoppingHistory.0": { $exists: true },
    })
      .select("name phoneNumber shoppingHistory")
      .lean();

    let allOrders = [];

    // Extract all orders from customers
    for (const customer of customers) {
      for (const order of customer.shoppingHistory) {
        // Find assigned vendor if any by checking delivery area against vendor service areas
        let assignedVendor = null;
        if (order.deliveryAddress?.area) {
          // First, validate that the delivery area exists in our Area model
          const validArea = await Area.findOne({
            $or: [
              { name: order.deliveryAddress.area.toLowerCase() },
              {
                displayName: {
                  $regex: new RegExp(order.deliveryAddress.area, "i"),
                },
              },
            ],
            isActive: true,
          });

          if (validArea) {
            // Find vendors that can service this area
            const vendors = await Vendor.find({
              status: "Available",
              isActive: true,
              "serviceAreas.areaName": {
                $regex: new RegExp(validArea.displayName, "i"),
              },
              "serviceAreas.isActive": true,
            }).limit(1);

            if (vendors.length > 0) {
              assignedVendor = vendors[0];
            }
          }
        }

        allOrders.push({
          customerId: customer._id,
          customerName: customer.name,
          customerPhone: customer.phoneNumber[0] || "",
          orderId: order.orderId,
          items: order.items,
          totalAmount: order.totalAmount,
          status: order.status,
          orderDate: order.orderDate,
          deliveryAddress: order.deliveryAddress,
          deliveryArea: order.deliveryAddress?.area,
          paymentMethod: order.paymentMethod,
          assignedVendor: assignedVendor
            ? {
                vendorId: assignedVendor.vendorId,
                name: assignedVendor.name,
                phone: assignedVendor.phone,
              }
            : null,
        });
      }
    }

    // Apply filters
    if (status && status !== "All Statuses") {
      allOrders = allOrders.filter((order) => order.status === status);
    }

    if (vendorId) {
      allOrders = allOrders.filter(
        (order) =>
          order.assignedVendor && order.assignedVendor.vendorId === vendorId
      );
    }

    if (area) {
      allOrders = allOrders.filter(
        (order) =>
          order.deliveryArea &&
          order.deliveryArea.toLowerCase().includes(area.toLowerCase())
      );
    }

    if (customerId) {
      allOrders = allOrders.filter(
        (order) => order.customerId.toString() === customerId
      );
    }

    // Date range filter
    if (dateFrom || dateTo) {
      allOrders = allOrders.filter((order) => {
        const orderDate = new Date(order.orderDate);
        if (dateFrom && orderDate < new Date(dateFrom)) return false;
        if (dateTo && orderDate > new Date(dateTo)) return false;
        return true;
      });
    }

    // Search functionality
    if (search) {
      const searchLower = search.toLowerCase();
      allOrders = allOrders.filter(
        (order) =>
          order.orderId.toLowerCase().includes(searchLower) ||
          order.customerName.toLowerCase().includes(searchLower) ||
          order.customerPhone.includes(search) ||
          (order.assignedVendor &&
            order.assignedVendor.name.toLowerCase().includes(searchLower)) ||
          (order.deliveryArea &&
            order.deliveryArea.toLowerCase().includes(searchLower))
      );
    }

    // Sort orders
    allOrders.sort((a, b) => {
      let aValue, bValue;

      switch (sortBy) {
        case "amount":
          aValue = a.totalAmount || 0;
          bValue = b.totalAmount || 0;
          break;
        case "customer":
          aValue = a.customerName || "";
          bValue = b.customerName || "";
          break;
        case "vendor":
          aValue = a.assignedVendor ? a.assignedVendor.name : "";
          bValue = b.assignedVendor ? b.assignedVendor.name : "";
          break;
        case "orderDate":
        default:
          aValue = new Date(a.orderDate || 0);
          bValue = new Date(b.orderDate || 0);
          break;
      }

      if (order === "desc") {
        return bValue > aValue ? 1 : bValue < aValue ? -1 : 0;
      } else {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      }
    });

    // Pagination
    const totalOrders = allOrders.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedOrders = allOrders.slice(skip, skip + parseInt(limit));

    console.log(
      `✅ Retrieved ${paginatedOrders.length} orders (Total: ${totalOrders})`
    );

    res.json({
      success: true,
      orders: paginatedOrders,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalOrders / parseInt(limit)),
        totalOrders,
        hasNext: skip + paginatedOrders.length < totalOrders,
        hasPrev: page > 1,
        limit: parseInt(limit),
      },
      filters: {
        status,
        vendorId,
        area,
        customerId,
        dateFrom,
        dateTo,
        search,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    res.status(500).json({
      error: "Failed to fetch orders",
      details: error.message,
    });
  }
});

// Get order statistics
router.get("/orders/stats", async (req, res) => {
  try {
    console.log("📊 Calculating order statistics...");

    // Get all customers with orders
    const customers = await Customer.find({
      "shoppingHistory.0": { $exists: true },
    })
      .select("shoppingHistory")
      .lean();

    let orderStats = {
      total: 0,
      pending: 0,
      active: 0,
      delivered: 0,
      cancelled: 0,
      withVendor: 0,
      withoutVendor: 0,
    };

    let totalRevenue = 0;

    for (const customer of customers) {
      for (const order of customer.shoppingHistory) {
        orderStats.total++;
        totalRevenue += order.totalAmount || 0;

        // Check if order has vendor assigned by checking delivery area
        if (order.deliveryAddress?.area) {
          // Validate area exists in our system
          const validArea = await Area.findOne({
            $or: [
              { name: order.deliveryAddress.area.toLowerCase() },
              {
                displayName: {
                  $regex: new RegExp(order.deliveryAddress.area, "i"),
                },
              },
            ],
            isActive: true,
          });

          if (validArea) {
            const vendors = await Vendor.find({
              status: "Available",
              isActive: true,
              "serviceAreas.areaName": {
                $regex: new RegExp(validArea.displayName, "i"),
              },
              "serviceAreas.isActive": true,
            }).limit(1);

            if (vendors.length > 0) {
              orderStats.withVendor++;
            } else {
              orderStats.withoutVendor++;
            }
          } else {
            orderStats.withoutVendor++;
          }
        } else {
          orderStats.withoutVendor++;
        }

        // Categorize by status
        const status = order.status || "pending";
        if (status.includes("pending") || status.includes("not-paid")) {
          orderStats.pending++;
        } else if (
          status.includes("complete") ||
          status.includes("delivered")
        ) {
          orderStats.delivered++;
        } else if (status.includes("refund") || status.includes("cancel")) {
          orderStats.cancelled++;
        } else {
          orderStats.active++;
        }
      }
    }

    console.log("✅ Order statistics calculated successfully");

    res.json({
      success: true,
      stats: {
        ...orderStats,
        totalRevenue,
        averageOrderValue:
          orderStats.total > 0 ? totalRevenue / orderStats.total : 0,
      },
    });
  } catch (error) {
    console.error("❌ Error fetching order stats:", error);
    res.status(500).json({
      error: "Failed to fetch order statistics",
      details: error.message,
    });
  }
});

// Auto-assign orders to vendors based on area
router.post("/orders/auto-assign", async (req, res) => {
  try {
    console.log("🔄 Starting auto-assignment of orders to vendors...");

    // Get all customers with unassigned orders
    const customers = await Customer.find({
      "shoppingHistory.status": {
        $in: ["order-confirmed", "customer-confirmed", "picking-order"],
      },
    }).select("name phoneNumber shoppingHistory");

    let assignedCount = 0;
    let skippedCount = 0;

    for (const customer of customers) {
      for (const order of customer.shoppingHistory) {
        // Skip if order doesn't need assignment
        if (
          !["order-confirmed", "customer-confirmed", "picking-order"].includes(
            order.status
          )
        ) {
          continue;
        }

        // Skip if no delivery area
        if (!order.deliveryAddress?.area) {
          skippedCount++;
          continue;
        }

        // Validate that the delivery area exists in our Area model
        const validArea = await Area.findOne({
          $or: [
            { name: order.deliveryAddress.area.toLowerCase() },
            {
              displayName: {
                $regex: new RegExp(order.deliveryAddress.area, "i"),
              },
            },
          ],
          isActive: true,
        });

        if (!validArea) {
          skippedCount++;
          console.log(
            `⚠️ Invalid delivery area: ${order.deliveryAddress.area}`
          );
          continue;
        }

        // Find vendors for this validated area
        const productIds = order.items
          .map((item) => item.productId)
          .filter(Boolean);
        const vendors = await Vendor.find({
          status: "Available",
          isActive: true,
          "serviceAreas.areaName": {
            $regex: new RegExp(validArea.displayName, "i"),
          },
          "serviceAreas.isActive": true,
          ...(productIds.length > 0 && {
            "availableProducts.productId": { $in: productIds },
            "availableProducts.isActive": true,
          }),
        }).sort({ "responseMetrics.rating": -1 });

        if (vendors.length > 0) {
          // Assign to best vendor (first in sorted list)
          const selectedVendor = vendors[0];

          // Update vendor with assignment
          await selectedVendor.assignOrder({
            customerId: customer._id,
            orderId: order.orderId,
            customerName: customer.name,
            customerPhone: customer.phoneNumber[0] || "",
            orderStatus: order.status,
            deliveryArea: order.deliveryAddress.area,
            totalAmount: order.totalAmount,
            products: order.items.map((item) => ({
              productId: item.productId,
              productName: item.productName,
              quantity: item.quantity,
            })),
          });

          // Update order status in customer schema
          order.status = "allocated-driver";
          await customer.save();

          assignedCount++;
          console.log(
            `✅ Assigned order ${order.orderId} to vendor ${selectedVendor.name} for area ${validArea.displayName}`
          );
        } else {
          skippedCount++;
          console.log(
            `⚠️ No vendors found for validated area: ${validArea.displayName}`
          );
        }
      }
    }

    console.log(
      `✅ Auto-assignment completed: ${assignedCount} assigned, ${skippedCount} skipped`
    );

    res.json({
      success: true,
      message: "Auto-assignment completed",
      results: {
        assignedCount,
        skippedCount,
      },
    });
  } catch (error) {
    console.error("❌ Error in auto-assignment:", error);
    res.status(500).json({
      error: "Failed to auto-assign orders",
      details: error.message,
    });
  }
});

// Manually assign order to specific vendor
router.post("/orders/:orderId/assign", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { vendorId } = req.body;

    console.log(`📝 Manually assigning order ${orderId} to vendor ${vendorId}`);

    // Find the customer and order
    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({
        error: "Order not found",
      });
    }

    const order = customer.shoppingHistory.find((o) => o.orderId === orderId);
    if (!order) {
      return res.status(404).json({
        error: "Order not found in customer history",
      });
    }

    // Find the vendor
    const vendor = await Vendor.findOne({ vendorId: vendorId });
    if (!vendor) {
      return res.status(404).json({
        error: "Vendor not found",
      });
    }

    // Check if vendor can service the area (validate against Area model)
    if (order.deliveryAddress?.area) {
      const validArea = await Area.findOne({
        $or: [
          { name: order.deliveryAddress.area.toLowerCase() },
          {
            displayName: {
              $regex: new RegExp(order.deliveryAddress.area, "i"),
            },
          },
        ],
        isActive: true,
      });

      if (!validArea) {
        return res.status(400).json({
          error: `Invalid delivery area: ${order.deliveryAddress.area}`,
        });
      }

      if (!vendor.canServiceArea(validArea.displayName)) {
        return res.status(400).json({
          error: `Vendor does not service area: ${validArea.displayName}`,
        });
      }
    }

    // Assign order to vendor
    await vendor.assignOrder({
      customerId: customer._id,
      orderId: order.orderId,
      customerName: customer.name,
      customerPhone: customer.phoneNumber[0] || "",
      orderStatus: order.status,
      deliveryArea: order.deliveryAddress?.area,
      totalAmount: order.totalAmount,
      products: order.items.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
      })),
    });

    // Update order status
    order.status = "allocated-driver";
    await customer.save();

    console.log(
      `✅ Manually assigned order ${orderId} to vendor ${vendor.name}`
    );

    res.json({
      success: true,
      message: "Order assigned successfully",
      assignment: {
        orderId,
        vendorId: vendor.vendorId,
        vendorName: vendor.name,
      },
    });
  } catch (error) {
    console.error("❌ Error assigning order:", error);
    res.status(500).json({
      error: "Failed to assign order",
      details: error.message,
    });
  }
});

// Update order status and sync with vendor
router.patch("/orders/:orderId/status", async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, notes } = req.body;

    console.log(`📝 Updating order status: ${orderId} -> ${status}`);

    // Find the customer and order
    const customer = await Customer.findOne({
      "shoppingHistory.orderId": orderId,
    });

    if (!customer) {
      return res.status(404).json({
        error: "Order not found",
      });
    }

    const order = customer.shoppingHistory.find((o) => o.orderId === orderId);
    if (!order) {
      return res.status(404).json({
        error: "Order not found in customer history",
      });
    }

    // Update order status
    const oldStatus = order.status;
    order.status = status;
    await customer.save();

    // Update vendor assignment if exists
    const vendor = await Vendor.findOne({
      "assignedOrders.orderId": orderId,
    });

    if (vendor) {
      await vendor.updateOrderStatus(orderId, status);
    }

    console.log(
      `✅ Updated order status: ${orderId} from ${oldStatus} to ${status}`
    );

    res.json({
      success: true,
      message: "Order status updated successfully",
      order: {
        orderId,
        oldStatus,
        newStatus: status,
        vendorAssigned: !!vendor,
      },
    });
  } catch (error) {
    console.error("❌ Error updating order status:", error);
    res.status(500).json({
      error: "Failed to update order status",
      details: error.message,
    });
  }
});

// Get orders assigned to specific vendor
router.get("/:vendorId/orders", async (req, res) => {
  try {
    const { vendorId } = req.params;
    const {
      status,
      page = 1,
      limit = 20,
      sortBy = "assignedAt",
      order = "desc",
    } = req.query;

    console.log(`📦 Fetching orders for vendor: ${vendorId}`);

    const vendor = await Vendor.findOne({ vendorId: vendorId });
    if (!vendor) {
      return res.status(404).json({
        error: "Vendor not found",
      });
    }

    let orders = vendor.assignedOrders || [];

    // Apply status filter
    if (status && status !== "All") {
      orders = orders.filter((order) => order.orderStatus === status);
    }

    // Sort orders
    orders.sort((a, b) => {
      let aValue, bValue;

      switch (sortBy) {
        case "totalAmount":
          aValue = a.totalAmount || 0;
          bValue = b.totalAmount || 0;
          break;
        case "customerName":
          aValue = a.customerName || "";
          bValue = b.customerName || "";
          break;
        case "assignedAt":
        default:
          aValue = new Date(a.assignedAt);
          bValue = new Date(b.assignedAt);
          break;
      }

      if (order === "desc") {
        return bValue > aValue ? 1 : bValue < aValue ? -1 : 0;
      } else {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      }
    });

    // Pagination
    const totalOrders = orders.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedOrders = orders.slice(skip, skip + parseInt(limit));

    console.log(
      `✅ Retrieved ${paginatedOrders.length} orders for vendor: ${vendor.name}`
    );

    res.json({
      success: true,
      orders: paginatedOrders,
      vendor: {
        vendorId: vendor.vendorId,
        name: vendor.name,
        phone: vendor.phone,
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalOrders / parseInt(limit)),
        totalOrders,
        hasNext: skip + paginatedOrders.length < totalOrders,
        hasPrev: page > 1,
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("❌ Error fetching vendor orders:", error);
    res.status(500).json({
      error: "Failed to fetch vendor orders",
      details: error.message,
    });
  }
});

// Bulk operations for vendors
router.post("/bulk-update", async (req, res) => {
  try {
    const { vendorIds, updateData, operation } = req.body;

    console.log(
      `📝 Performing bulk ${operation} on ${vendorIds.length} vendors`
    );

    if (!vendorIds || !Array.isArray(vendorIds) || vendorIds.length === 0) {
      return res.status(400).json({
        error: "vendorIds array is required",
      });
    }

    let result;

    switch (operation) {
      case "status":
        if (
          !updateData.status ||
          !["Available", "Offline", "Busy"].includes(updateData.status)
        ) {
          return res.status(400).json({
            error: "Valid status is required for status update",
          });
        }

        result = await Vendor.updateMany(
          { vendorId: { $in: vendorIds } },
          {
            status: updateData.status,
            lastUpdated: new Date(),
          }
        );
        break;

      case "delete":
        result = await Vendor.updateMany(
          { vendorId: { $in: vendorIds } },
          {
            isActive: false,
            lastUpdated: new Date(),
          }
        );
        break;

      case "addProduct":
        if (!updateData.productId) {
          return res.status(400).json({
            error: "productId is required for adding products",
          });
        }

        // Get product details
        const product = await Product.findOne({
          productId: updateData.productId,
        });
        if (!product) {
          return res.status(404).json({
            error: "Product not found",
          });
        }

        result = await Vendor.updateMany(
          {
            vendorId: { $in: vendorIds },
            "availableProducts.productId": { $ne: updateData.productId },
          },
          {
            $push: {
              availableProducts: {
                productId: updateData.productId,
                productName: product.productName,
                isActive: true,
                pricing: updateData.pricing || { commission: 8 },
                availability: updateData.availability || {},
              },
            },
            lastUpdated: new Date(),
          }
        );
        break;

      default:
        return res.status(400).json({
          error: "Invalid operation. Supported: status, delete, addProduct",
        });
    }

    console.log(
      `✅ Bulk ${operation} completed. Modified: ${result.modifiedCount} vendors`
    );

    res.json({
      success: true,
      message: `Bulk ${operation} completed successfully`,
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
    });
  } catch (error) {
    console.error("❌ Error performing bulk operation:", error);
    res.status(500).json({
      error: "Failed to perform bulk operation",
      details: error.message,
    });
  }
});

module.exports = router;
