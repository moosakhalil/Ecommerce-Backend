const express = require("express");
const router = express.Router();
const VendorPreOrder = require("../models/vendorpreorder");
const ManagementSettings = require("../models/managementSettings");

// Get all vendor pre-orders with filtering and searching
router.get("/", async (req, res) => {
  try {
    const {
      status,
      search,
      sortBy = "name",
      order = "asc",
      page = 1,
      limit = 20,
      productId,
    } = req.query;

    let query = {};

    if (status && status !== "All Statuses") {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { "location.city": { $regex: search, $options: "i" } },
        { "location.area": { $regex: search, $options: "i" } },
      ];
    }

    // Filter by product availability
    if (productId) {
      query["availableProducts.productId"] = productId;
    }

    const sortOptions = {};
    sortOptions[sortBy] = order === "asc" ? 1 : -1;

    const vendors = await VendorPreOrder.find(query)
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await VendorPreOrder.countDocuments(query);

    res.json({
      vendors,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get vendor pre-order stats
router.get("/stats", async (req, res) => {
  try {
    const stats = await VendorPreOrder.aggregate([
      {
        $group: {
          _id: null,
          totalVendors: { $sum: 1 },
          activeVendors: {
            $sum: { $cond: [{ $eq: ["$status", "Available"] }, 1, 0] },
          },
          offlineVendors: {
            $sum: { $cond: [{ $eq: ["$status", "Offline"] }, 1, 0] },
          },
        },
      },
    ]);

    res.json({
      stats: stats[0] || {
        totalVendors: 0,
        activeVendors: 0,
        offlineVendors: 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get order stats for vendor pre-orders
router.get("/orders/stats", async (req, res) => {
  try {
    // This would typically connect to your orders collection
    // For now, returning mock data
    res.json({
      stats: {
        total: 0,
        pending: 0,
        active: 0,
        delivered: 0,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get products for vendor pre-order management with filtering
router.get("/products/by-type", async (req, res) => {
  try {
    const {
      productType = "All",
      search = "",
      category = "",
      subCategory = "",
      brand = "",
      inStock = false,
      page = 1,
      limit = 100,
    } = req.query;

    // This endpoint should connect to your products collection
    // For now, we'll return a basic response
    let query = {};

    if (productType !== "All") {
      query.productType = productType;
    }

    if (search) {
      query.$or = [
        { productName: { $regex: search, $options: "i" } },
        { productId: { $regex: search, $options: "i" } },
      ];
    }

    if (category) {
      query.categories = category;
    }

    if (subCategory) {
      query.subCategories = subCategory;
    }

    if (brand) {
      query.brand = brand;
    }

    if (inStock === "true") {
      query.Stock = { $gt: 0 };
    }

    // You should replace this with actual product fetching logic
    // const products = await Product.find(query).limit(limit * 1).skip((page - 1) * limit);

    res.json({
      products: [], // Replace with actual products
      totalPages: 1,
      currentPage: page,
      total: 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get filter options for products
router.get("/products/filter-options", async (req, res) => {
  try {
    const { productType } = req.query;

    // This should return actual filter options from your products collection
    res.json({
      categories: ["Construction", "Electrical", "Plumbing", "Tools"],
      subCategories: ["Pipes", "Wires", "Cement", "Steel"],
      brands: ["Brand A", "Brand B", "Brand C"],
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new vendor pre-order
router.post("/", async (req, res) => {
  try {
    const vendorData = req.body;

    // Generate a unique vendor ID
    vendorData.vendorId = `VPO-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const vendor = new VendorPreOrder(vendorData);
    await vendor.save();

    res.status(201).json(vendor);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update a vendor pre-order
router.put("/:vendorId", async (req, res) => {
  try {
    const vendor = await VendorPreOrder.findOneAndUpdate(
      { vendorId: req.params.vendorId },
      req.body,
      { new: true, runValidators: true }
    );

    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    res.json(vendor);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update vendor status
router.patch("/:vendorId/status", async (req, res) => {
  try {
    const { status } = req.body;

    const vendor = await VendorPreOrder.findOneAndUpdate(
      { vendorId: req.params.vendorId },
      { status },
      { new: true }
    );

    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    res.json(vendor);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Assign areas to vendor
router.patch("/:vendorId/areas", async (req, res) => {
  try {
    const { areas } = req.body;

    const vendor = await VendorPreOrder.findOneAndUpdate(
      { vendorId: req.params.vendorId },
      { assignedAreas: areas },
      { new: true }
    );

    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    res.json(vendor);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get vendors by area (for area assignment)
router.get("/by-area", async (req, res) => {
  try {
    const { emirate, city, area } = req.query;

    let query = { status: "Available" };

    if (emirate || city || area) {
      query["assignedAreas"] = {
        $elemMatch: {
          ...(emirate && { emirate }),
          ...(city && { city }),
          ...(area && { area }),
          isActive: true,
        },
      };
    }

    const vendors = await VendorPreOrder.find(query);

    res.json({ vendors });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a vendor pre-order
router.delete("/:vendorId", async (req, res) => {
  try {
    const vendor = await VendorPreOrder.findOneAndDelete({
      vendorId: req.params.vendorId,
    });

    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    res.json({ message: "Vendor deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Bulk operations
router.post("/bulk-update", async (req, res) => {
  try {
    const { vendorIds, updateData, operation } = req.body;

    let result;

    if (operation === "status") {
      result = await VendorPreOrder.updateMany(
        { vendorId: { $in: vendorIds } },
        { $set: { status: updateData.status } }
      );
    } else if (operation === "delete") {
      result = await VendorPreOrder.deleteMany({
        vendorId: { $in: vendorIds },
      });
    } else if (operation === "assign-areas") {
      result = await VendorPreOrder.updateMany(
        { vendorId: { $in: vendorIds } },
        { $set: { assignedAreas: updateData.areas } }
      );
    }

    res.json({ modifiedCount: result.modifiedCount || result.deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add area to vendor (POST)
router.post("/:vendorId/areas", async (req, res) => {
  try {
    const { areaId, deliveryCharge, estimatedDeliveryTime } = req.body;

    const vendor = await VendorPreOrder.findOne({
      vendorId: req.params.vendorId,
    });
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    // Check if area already assigned
    const existingArea = vendor.assignedAreas.find(
      (area) => area.areaId === areaId
    );
    if (existingArea) {
      return res
        .status(400)
        .json({ error: "Area already assigned to this vendor" });
    }

    vendor.assignedAreas.push({
      areaId,
      deliveryCharge: deliveryCharge || 0,
      estimatedDeliveryTime: estimatedDeliveryTime || "Same day",
      isActive: true,
    });

    await vendor.save();
    res.json(vendor);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Remove area from vendor (DELETE)
router.delete("/:vendorId/areas", async (req, res) => {
  try {
    const { areaName } = req.body;

    const vendor = await VendorPreOrder.findOne({
      vendorId: req.params.vendorId,
    });
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    vendor.assignedAreas = vendor.assignedAreas.filter(
      (area) => area.area !== areaName && area.areaId !== areaName
    );

    await vendor.save();
    res.json(vendor);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Toggle area status (PATCH)
router.patch("/:vendorId/areas/:areaIndex/toggle", async (req, res) => {
  try {
    const { vendorId, areaIndex } = req.params;

    const vendor = await VendorPreOrder.findOne({ vendorId });
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    if (areaIndex >= vendor.assignedAreas.length) {
      return res.status(400).json({ error: "Invalid area index" });
    }

    vendor.assignedAreas[areaIndex].isActive =
      !vendor.assignedAreas[areaIndex].isActive;
    await vendor.save();

    res.json(vendor);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get selected products - FIXED VERSION
router.get("/selected-products", async (req, res) => {
  try {
    const selectedProducts = await ManagementSettings.findOne({
      type: "selectedProducts",
    });

    if (!selectedProducts) {
      return res.json({
        products: [],
        assignments: {},
      });
    }

    // Convert Map to plain object if needed
    let assignments = selectedProducts.assignments || {};
    if (assignments instanceof Map) {
      assignments = Object.fromEntries(assignments);
    }

    console.log("Fetched from DB:", {
      products: selectedProducts.products?.length || 0,
      assignments: Object.keys(assignments).length,
      assignmentsData: assignments,
    });

    res.json({
      products: selectedProducts.products || [],
      assignments: assignments,
    });
  } catch (error) {
    console.error("Error fetching selected products:", error);
    res.status(500).json({ error: error.message });
  }
});
// Save selected products for management dashboard
router.post("/selected-products", async (req, res) => {
  try {
    const { products, assignments } = req.body;

    await ManagementSettings.findOneAndUpdate(
      { type: "selectedProducts" },
      {
        type: "selectedProducts",
        products: products || [],
        assignments: assignments || {},
        updatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add product to selected list
router.post("/selected-products/add", async (req, res) => {
  try {
    const { product } = req.body;

    let selectedData = await ManagementSettings.findOne({
      type: "selectedProducts",
    });
    if (!selectedData) {
      selectedData = {
        type: "selectedProducts",
        products: [],
        assignments: {},
      };
    }

    // Check if product already exists
    const exists = selectedData.products.find((p) => p._id === product._id);
    if (!exists) {
      selectedData.products.push(product);

      await ManagementSettings.findOneAndUpdate(
        { type: "selectedProducts" },
        selectedData,
        { upsert: true, new: true }
      );
    }

    res.json({ success: true, products: selectedData.products });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/selected-products/:productId", async (req, res) => {
  try {
    const { productId } = req.params; // This is the MongoDB _id

    let selectedData = await ManagementSettings.findOne({
      type: "selectedProducts",
    });

    if (selectedData) {
      // Find the product being removed to get its productId
      const productToRemove = selectedData.products.find(
        (p) => p._id === productId
      );

      // Remove from products array
      selectedData.products = selectedData.products.filter(
        (p) => p._id !== productId
      );

      // Remove any assignments for this product using the actual productId
      if (selectedData.assignments && productToRemove) {
        console.log(
          "Removing assignment for productId:",
          productToRemove.productId
        );
        delete selectedData.assignments[productToRemove.productId];
      }

      await ManagementSettings.findOneAndUpdate(
        { type: "selectedProducts" },
        selectedData,
        { upsert: true, new: true }
      );

      console.log("Updated selectedData after removal:", selectedData);
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error removing product:", error);
    res.status(500).json({ error: error.message });
  }
});
// Assign vendor to product - FIXED VERSION
router.post("/selected-products/assign", async (req, res) => {
  try {
    const { productId, vendorId, vendorName } = req.body;

    console.log("Assigning vendor:", { productId, vendorId, vendorName });

    let selectedData = await ManagementSettings.findOne({
      type: "selectedProducts",
    });

    if (!selectedData) {
      selectedData = {
        type: "selectedProducts",
        products: [],
        assignments: {},
      };
    }

    // Ensure assignments is a plain object
    if (!selectedData.assignments || selectedData.assignments instanceof Map) {
      selectedData.assignments = {};
    }

    selectedData.assignments[productId] = {
      vendorId,
      vendorName,
      assignedAt: new Date().toISOString(),
    };

    console.log("Updated assignments:", selectedData.assignments);

    const updatedData = await ManagementSettings.findOneAndUpdate(
      { type: "selectedProducts" },
      {
        type: "selectedProducts",
        products: selectedData.products,
        assignments: selectedData.assignments, // Save as plain object
      },
      { upsert: true, new: true }
    );

    // Convert Map to object if needed for response
    let responseAssignments = updatedData.assignments;
    if (responseAssignments instanceof Map) {
      responseAssignments = Object.fromEntries(responseAssignments);
    }

    console.log("Saved to database:", responseAssignments);

    res.json({ success: true, assignments: responseAssignments });
  } catch (error) {
    console.error("Error assigning vendor:", error);
    res.status(500).json({ error: error.message });
  }
});
// Remove vendor assignment - FIXED VERSION
router.delete("/selected-products/assign/:productId", async (req, res) => {
  try {
    const { productId } = req.params;

    console.log("Removing assignment for productId:", productId);

    let selectedData = await ManagementSettings.findOne({
      type: "selectedProducts",
    });

    if (selectedData && selectedData.assignments) {
      // Convert Map to object if needed
      let assignments = selectedData.assignments;
      if (assignments instanceof Map) {
        assignments = Object.fromEntries(assignments);
      }

      console.log("Before removal:", assignments);
      delete assignments[productId];
      console.log("After removal:", assignments);

      await ManagementSettings.findOneAndUpdate(
        { type: "selectedProducts" },
        {
          type: "selectedProducts",
          products: selectedData.products,
          assignments: assignments, // Save as plain object
        },
        { upsert: true, new: true }
      );
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error removing assignment:", error);
    res.status(500).json({ error: error.message });
  }
});
module.exports = router;
