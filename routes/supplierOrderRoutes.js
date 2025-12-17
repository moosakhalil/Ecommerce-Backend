const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const SupplierOrder = require("../models/SupplierOrder");
const Supplier = require("../models/supplier");
const Product = require("../models/Product");

// Set up multer storage for issue media uploads
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const uploadDir = path.join(__dirname, "../uploads/supplier-orders");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `issue-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|webm/;
  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );
  const mimetype = allowedTypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error("Only images and videos are allowed"));
  }
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit for videos
  fileFilter: fileFilter,
});

// =============================================
// GET ALL SUPPLIER ORDERS (Combined from SupplierOrder + Product orderStock)
// =============================================
router.get("/", async (req, res) => {
  try {
    const {
      status,
      supplierId,
      startDate,
      endDate,
      page = 1,
      limit = 50,
      search,
    } = req.query;

    // 1. Get orders from SupplierOrder collection
    const filter = {};
    if (status) filter.status = status;
    if (supplierId) filter.supplier = supplierId;
    if (startDate || endDate) {
      filter.orderDate = {};
      if (startDate) filter.orderDate.$gte = new Date(startDate);
      if (endDate) filter.orderDate.$lte = new Date(endDate);
    }
    if (search) {
      filter.$or = [
        { orderNumber: { $regex: search, $options: "i" } },
        { supplierName: { $regex: search, $options: "i" } },
      ];
    }

    const supplierOrders = await SupplierOrder.find(filter)
      .populate("supplier", "name phone email")
      .sort({ orderDate: -1 })
      .lean();

    // 2. Get orders from Product orderStock (order_placed and order_confirmed)
    // Populate selectedSupplierId to get actual supplier names
    const products = await Product.find({
      "orderStock.0": { $exists: true },
    })
      .populate("orderStock.selectedSupplierId", "name phone email")
      .lean();

    // Group product orders by supplier
    const productOrdersMap = {};
    
    for (const product of products) {
      for (const stockOrder of product.orderStock || []) {
        // Only show orders that are placed or confirmed (not delivered or cancelled)
        if (!["order_placed", "order_confirmed", "pending"].includes(stockOrder.status)) {
          continue;
        }

        // Get supplier name - prioritize populated supplier, then approvedSupplier, then product supplierName
        let supplierName = "Unknown Supplier";
        if (stockOrder.selectedSupplierId && stockOrder.selectedSupplierId.name) {
          supplierName = stockOrder.selectedSupplierId.name;
        } else if (stockOrder.approvedSupplier) {
          supplierName = stockOrder.approvedSupplier;
        } else if (product.supplierName) {
          supplierName = product.supplierName;
        }

        const orderDate = stockOrder.orderPlacedAt || stockOrder.requestedAt || new Date();
        const dateKey = new Date(orderDate).toISOString().split("T")[0];
        const mapKey = `${supplierName}_${dateKey}`;

        if (!productOrdersMap[mapKey]) {
          productOrdersMap[mapKey] = {
            _id: `stock_${stockOrder._id || Date.now()}`,
            orderNumber: stockOrder.orderNumber || `SO-${dateKey.replace(/-/g, "")}`,
            supplierName: supplierName,
            supplierContact: stockOrder.supplierPhone || (stockOrder.selectedSupplierId?.phone) || "",
            supplierEmail: stockOrder.supplierEmail || (stockOrder.selectedSupplierId?.email) || "",
            orderDate: orderDate,
            estimatedArrival: stockOrder.estimatedDeliveryDate,
            status: stockOrder.status === "order_confirmed" ? "in_transit" : "pending",
            products: [],
            totalValue: 0,
            productLineCount: 0,
            source: "product_orderStock",
          };
        }

        productOrdersMap[mapKey].products.push({
          productRef: product._id,
          productId: product.productId,
          productName: product.productName,
          orderedQuantity: stockOrder.orderQuantity || 1,
          price: product.NormalPrice || 0,
          arrivalStatus: "pending",
        });

        productOrdersMap[mapKey].totalValue += (product.NormalPrice || 0) * (stockOrder.orderQuantity || 1);
        productOrdersMap[mapKey].productLineCount++;
      }
    }

    // Convert map to array
    const productOrders = Object.values(productOrdersMap);

    // 3. Combine both sources
    let allOrders = [];

    // Add supplier orders with progress
    for (const order of supplierOrders) {
      const verified = order.products?.filter((p) => p.arrivalStatus !== "pending").length || 0;
      allOrders.push({
        ...order,
        source: "supplier_order",
        verificationProgress: {
          total: order.products?.length || 0,
          verified,
          percentage: order.products?.length > 0 ? Math.round((verified / order.products.length) * 100) : 0,
        },
      });
    }

    // Add product orders (filter out duplicates by orderNumber)
    const existingOrderNumbers = new Set(supplierOrders.map((o) => o.orderNumber));
    for (const order of productOrders) {
      if (!existingOrderNumbers.has(order.orderNumber)) {
        allOrders.push({
          ...order,
          verificationProgress: {
            total: order.products.length,
            verified: 0,
            percentage: 0,
          },
        });
      }
    }

    // Sort by order date descending
    allOrders.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));

    // Apply search filter if provided
    if (search) {
      const searchLower = search.toLowerCase();
      allOrders = allOrders.filter(
        (o) =>
          o.orderNumber?.toLowerCase().includes(searchLower) ||
          o.supplierName?.toLowerCase().includes(searchLower)
      );
    }

    // Pagination
    const total = allOrders.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedOrders = allOrders.slice(skip, skip + parseInt(limit));

    res.json({
      success: true,
      data: paginatedOrders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching supplier orders:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});

// =============================================
// GET SINGLE SUPPLIER ORDER
// =============================================
router.get("/:id", async (req, res) => {
  try {
    const orderId = req.params.id;

    // Check if this is a product orderStock order (ID starts with "stock_")
    if (orderId.startsWith("stock_")) {
      // Extract the actual orderStock ID
      const stockOrderId = orderId.replace("stock_", "");

      // Find the product with this orderStock
      const product = await Product.findOne({
        "orderStock._id": stockOrderId,
      }).lean();

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const stockOrder = product.orderStock.find(
        (o) => o._id.toString() === stockOrderId
      );

      if (!stockOrder) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      // Build order response from product orderStock
      const order = {
        _id: orderId,
        orderNumber: stockOrder.orderNumber || `SO-${new Date(stockOrder.orderPlacedAt || stockOrder.requestedAt).toISOString().split("T")[0].replace(/-/g, "")}`,
        supplierName: stockOrder.approvedSupplier || product.supplierName || "Unknown Supplier",
        supplierContact: stockOrder.supplierPhone || "",
        supplierEmail: stockOrder.supplierEmail || "",
        supplierAddress: stockOrder.supplierAddress || "",
        orderDate: stockOrder.orderPlacedAt || stockOrder.requestedAt || new Date(),
        estimatedArrival: stockOrder.estimatedDeliveryDate,
        status: stockOrder.status === "order_confirmed" ? "in_transit" : 
                stockOrder.status === "delivered" ? "completed" : "pending",
        products: [
          {
            productRef: product._id,
            productId: product.productId,
            productName: product.productName,
            productImage: product.masterImage || "",
            orderedQuantity: stockOrder.orderQuantity || 1,
            receivedQuantity: stockOrder.status === "delivered" ? stockOrder.orderQuantity : 0,
            price: product.NormalPrice || 0,
            totalPrice: (product.NormalPrice || 0) * (stockOrder.orderQuantity || 1),
            arrivalStatus: stockOrder.status === "delivered" ? "received" : "pending",
            notes: stockOrder.notes || "",
            issues: [],
          },
        ],
        totalValue: (product.NormalPrice || 0) * (stockOrder.orderQuantity || 1),
        productLineCount: 1,
        issueCategories: {},
        overallIssues: [],
        additionalNotes: stockOrder.notes || "",
        source: "product_orderStock",
        originalOrderRef: {
          productId: product._id,
          orderStockId: stockOrder._id,
        },
        verificationProgress: {
          total: 1,
          verified: stockOrder.status === "delivered" ? 1 : 0,
          percentage: stockOrder.status === "delivered" ? 100 : 0,
        },
      };

      return res.json({
        success: true,
        data: order,
      });
    }

    // Regular SupplierOrder lookup
    const order = await SupplierOrder.findById(orderId)
      .populate("supplier", "name phone email address")
      .populate("products.productRef", "productId productName masterImage")
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Calculate verification progress
    const verified = order.products.filter(
      (p) => p.arrivalStatus !== "pending"
    ).length;
    order.verificationProgress = {
      total: order.products.length,
      verified,
      percentage:
        order.products.length > 0
          ? Math.round((verified / order.products.length) * 100)
          : 0,
    };

    res.json({
      success: true,
      data: order,
    });
  } catch (error) {
    console.error("Error fetching supplier order:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});

// =============================================
// CREATE NEW SUPPLIER ORDER
// =============================================
router.post("/", async (req, res) => {
  try {
    const {
      supplierId,
      supplierName,
      supplierContact,
      supplierEmail,
      supplierAddress,
      products,
      estimatedArrival,
      additionalNotes,
      createdBy,
    } = req.body;

    // Basic validation
    if (!supplierName) {
      return res.status(400).json({
        success: false,
        message: "Supplier name is required",
      });
    }

    if (!products || products.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one product is required",
      });
    }

    const orderData = {
      supplier: supplierId || undefined,
      supplierName,
      supplierContact,
      supplierEmail,
      supplierAddress,
      products: products.map((p) => ({
        productRef: p.productRef,
        productId: p.productId,
        productName: p.productName,
        productImage: p.productImage,
        details: p.details || {},
        orderedQuantity: p.orderedQuantity || 1,
        price: p.price || 0,
      })),
      estimatedArrival: estimatedArrival ? new Date(estimatedArrival) : undefined,
      additionalNotes,
      createdBy: createdBy || "Admin",
    };

    const order = await SupplierOrder.create(orderData);

    res.status(201).json({
      success: true,
      message: "Supplier order created successfully",
      data: order,
    });
  } catch (error) {
    console.error("Error creating supplier order:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});

// =============================================
// VERIFY SINGLE PRODUCT ARRIVAL
// =============================================
router.patch("/:id/verify-product/:productIndex", async (req, res) => {
  try {
    const { id, productIndex } = req.params;
    const {
      arrivalStatus,
      receivedQuantity,
      notes,
      verifiedBy,
    } = req.body;

    // Handle stock_ orders from Product.orderStock
    if (id.startsWith("stock_")) {
      const stockOrderId = id.replace("stock_", "");
      const product = await Product.findOne({ "orderStock._id": stockOrderId });

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const stockOrderIdx = product.orderStock.findIndex(
        (o) => o._id.toString() === stockOrderId
      );

      if (stockOrderIdx === -1) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      // Update the orderStock status
      const newStatus = arrivalStatus === "received" ? "delivered" : product.orderStock[stockOrderIdx].status;
      product.orderStock[stockOrderIdx].status = newStatus;
      product.orderStock[stockOrderIdx].notes = notes || product.orderStock[stockOrderIdx].notes;

      if (newStatus === "delivered") {
        product.orderStock[stockOrderIdx].actualDeliveryDate = new Date();
        // Update product stock
        product.Stock = (product.Stock || 0) + (product.orderStock[stockOrderIdx].orderQuantity || 0);
      }

      await product.save();

      return res.json({
        success: true,
        message: "Product verification updated",
        data: {
          product: {
            productId: product.productId,
            productName: product.productName,
            arrivalStatus: newStatus === "delivered" ? "received" : "pending",
            notes: product.orderStock[stockOrderIdx].notes,
          },
          orderStatus: newStatus === "delivered" ? "completed" : "pending",
          verificationProgress: {
            total: 1,
            verified: newStatus === "delivered" ? 1 : 0,
            percentage: newStatus === "delivered" ? 100 : 0,
          },
        },
      });
    }

    // Regular SupplierOrder handling
    const order = await SupplierOrder.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const idx = parseInt(productIndex);
    if (idx < 0 || idx >= order.products.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid product index",
      });
    }

    // Update product verification
    order.products[idx].arrivalStatus = arrivalStatus || "received";
    order.products[idx].receivedQuantity =
      receivedQuantity !== undefined
        ? receivedQuantity
        : order.products[idx].orderedQuantity;
    order.products[idx].notes = notes || order.products[idx].notes;
    order.products[idx].arrivalVerifiedAt = new Date();
    order.products[idx].verifiedBy = verifiedBy || "Admin";

    // Update order status if all products verified
    const allVerified = order.products.every(
      (p) => p.arrivalStatus !== "pending"
    );
    if (allVerified) {
      order.status = order.hasIssues() ? "issues_reported" : "completed";
      order.verificationCompletedAt = new Date();
    } else if (order.status === "pending" || order.status === "arrived") {
      order.status = "verification_in_progress";
    }

    await order.save();

    res.json({
      success: true,
      message: "Product verification updated",
      data: {
        product: order.products[idx],
        orderStatus: order.status,
        verificationProgress: order.getVerificationProgress(),
      },
    });
  } catch (error) {
    console.error("Error verifying product:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});


// =============================================
// ADD ISSUE TO PRODUCT
// =============================================
router.patch("/:id/product-issue/:productIndex", async (req, res) => {
  try {
    const { id, productIndex } = req.params;
    const { category, description, reportedBy } = req.body;

    // Handle stock_ orders - these don't have issue storage in Product model
    if (id.startsWith("stock_")) {
      // For stock orders, we acknowledge the issue but can't persist it to the Product model
      // Return success so the frontend works correctly
      return res.json({
        success: true,
        message: "Issue reported (stock order - noted but not persisted)",
        data: {
          product: {
            productIndex: parseInt(productIndex),
            issues: [{ category, description, reportedBy: reportedBy || "Admin", reportedAt: new Date() }],
          },
          issueIndex: 0,
        },
      });
    }

    const order = await SupplierOrder.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    const idx = parseInt(productIndex);
    if (idx < 0 || idx >= order.products.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid product index",
      });
    }

    // Add issue to product
    order.products[idx].issues.push({
      category,
      description,
      reportedBy: reportedBy || "Admin",
      reportedAt: new Date(),
      media: [],
    });

    // Update product status if not already set
    if (order.products[idx].arrivalStatus === "pending") {
      order.products[idx].arrivalStatus = "damaged";
    }

    // Update order status
    order.status = "issues_reported";

    await order.save();

    res.json({
      success: true,
      message: "Issue added to product",
      data: {
        product: order.products[idx],
        issueIndex: order.products[idx].issues.length - 1,
      },
    });
  } catch (error) {
    console.error("Error adding product issue:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});

// =============================================
// UPDATE OVERALL ORDER ISSUES (CHECKBOXES)
// =============================================
router.patch("/:id/overall-issues", async (req, res) => {
  try {
    const { issueCategories, additionalNotes, overallIssues } = req.body;
    const orderId = req.params.id;

    // Handle stock_ orders - these are read-only from product orderStock
    if (orderId.startsWith("stock_")) {
      // For stock orders, we can't persist issue categories but we return success
      // The frontend will show the checkboxes but changes won't persist
      return res.json({
        success: true,
        message: "Order issues acknowledged (read-only for stock orders)",
        data: {
          issueCategories: issueCategories || {},
          overallIssues: [],
          additionalNotes: additionalNotes || "",
        },
      });
    }

    const order = await SupplierOrder.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Update issue categories
    if (issueCategories) {
      order.issueCategories = {
        ...order.issueCategories,
        ...issueCategories,
      };
    }

    // Update additional notes
    if (additionalNotes !== undefined) {
      order.additionalNotes = additionalNotes;
    }

    // Add overall issues
    if (overallIssues && Array.isArray(overallIssues)) {
      overallIssues.forEach((issue) => {
        order.overallIssues.push({
          category: issue.category,
          description: issue.description,
          reportedBy: issue.reportedBy || "Admin",
          reportedAt: new Date(),
          media: [],
        });
      });
    }

    // Update status if there are issues
    if (order.hasIssues()) {
      order.status = "issues_reported";
    }

    await order.save();

    res.json({
      success: true,
      message: "Order issues updated",
      data: {
        issueCategories: order.issueCategories,
        overallIssues: order.overallIssues,
        additionalNotes: order.additionalNotes,
      },
    });
  } catch (error) {
    console.error("Error updating order issues:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});

// =============================================
// UPLOAD MEDIA FOR ISSUE
// =============================================
router.post(
  "/:id/upload-media",
  upload.array("media", 10),
  async (req, res) => {
    try {
      const { productIndex, issueIndex, isOverallIssue } = req.body;
      const orderId = req.params.id;

      // Handle stock_ orders - can't attach media to Product model
      if (orderId.startsWith("stock_")) {
        if (!req.files || req.files.length === 0) {
          return res.status(400).json({
            success: false,
            message: "No files uploaded",
          });
        }

        const mediaItems = req.files.map((file) => ({
          type: file.mimetype.startsWith("video") ? "video" : "photo",
          url: `/uploads/supplier-orders/${file.filename}`,
          filename: file.originalname,
          uploadedAt: new Date(),
        }));

        // Files are saved to disk, but can't be attached to stock order
        return res.json({
          success: true,
          message: "Media uploaded (stock order - saved but not linked)",
          data: { mediaItems },
        });
      }

      const order = await SupplierOrder.findById(orderId);

      if (!order) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No files uploaded",
        });
      }

      const mediaItems = req.files.map((file) => ({
        type: file.mimetype.startsWith("video") ? "video" : "photo",
        url: `/uploads/supplier-orders/${file.filename}`,
        filename: file.originalname,
        uploadedAt: new Date(),
      }));

      if (isOverallIssue === "true") {
        // Add to overall issue
        const idx = parseInt(issueIndex);
        if (idx >= 0 && idx < order.overallIssues.length) {
          order.overallIssues[idx].media.push(...mediaItems);
        } else {
          // Create new overall issue with media
          order.overallIssues.push({
            category: "product_broken_damaged",
            description: "Issue with media attached",
            reportedBy: "Admin",
            reportedAt: new Date(),
            media: mediaItems,
          });
        }
      } else {
        // Add to product issue
        const pIdx = parseInt(productIndex);
        const iIdx = parseInt(issueIndex);

        if (pIdx >= 0 && pIdx < order.products.length) {
          if (iIdx >= 0 && iIdx < order.products[pIdx].issues.length) {
            order.products[pIdx].issues[iIdx].media.push(...mediaItems);
          } else {
            // Create new issue with media
            order.products[pIdx].issues.push({
              category: "product_broken_damaged",
              description: "Issue with media attached",
              reportedBy: "Admin",
              reportedAt: new Date(),
              media: mediaItems,
            });
          }
        }
      }

      await order.save();

      res.json({
        success: true,
        message: "Media uploaded successfully",
        data: { mediaItems },
      });
    } catch (error) {
      console.error("Error uploading media:", error);
      res.status(500).json({
        success: false,
        message: "Server Error",
        error: error.message,
      });
    }
  }
);

// =============================================
// MARK ORDER AS ARRIVED
// =============================================
router.patch("/:id/mark-arrived", async (req, res) => {
  try {
    const orderId = req.params.id;

    // Handle stock_ orders from Product.orderStock
    if (orderId.startsWith("stock_")) {
      const stockOrderId = orderId.replace("stock_", "");
      const product = await Product.findOne({ "orderStock._id": stockOrderId });

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const stockOrderIdx = product.orderStock.findIndex(
        (o) => o._id.toString() === stockOrderId
      );

      if (stockOrderIdx === -1) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      // Update status to order_confirmed (arrived but not verified)
      product.orderStock[stockOrderIdx].status = "order_confirmed";

      await product.save();

      return res.json({
        success: true,
        message: "Order marked as arrived",
        data: {
          _id: orderId,
          status: "arrived",
          actualArrival: new Date(),
        },
      });
    }

    // Regular SupplierOrder handling
    const order = await SupplierOrder.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    order.status = "arrived";
    order.actualArrival = new Date();

    await order.save();

    res.json({
      success: true,
      message: "Order marked as arrived",
      data: order,
    });
  } catch (error) {
    console.error("Error marking order as arrived:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});

// =============================================
// COMPLETE ORDER VERIFICATION
// =============================================
router.patch("/:id/complete", async (req, res) => {
  try {
    const { verifiedBy } = req.body;
    const orderId = req.params.id;

    // Handle stock_ orders from Product.orderStock
    if (orderId.startsWith("stock_")) {
      const stockOrderId = orderId.replace("stock_", "");
      const product = await Product.findOne({ "orderStock._id": stockOrderId });

      if (!product) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      const stockOrderIdx = product.orderStock.findIndex(
        (o) => o._id.toString() === stockOrderId
      );

      if (stockOrderIdx === -1) {
        return res.status(404).json({
          success: false,
          message: "Order not found",
        });
      }

      // Mark as delivered
      product.orderStock[stockOrderIdx].status = "delivered";
      product.orderStock[stockOrderIdx].actualDeliveryDate = new Date();

      // Update product stock
      product.Stock = (product.Stock || 0) + (product.orderStock[stockOrderIdx].orderQuantity || 0);

      await product.save();

      return res.json({
        success: true,
        message: "Order verification completed",
        data: {
          _id: orderId,
          status: "completed",
          verificationCompletedAt: new Date(),
        },
      });
    }

    // Regular SupplierOrder handling
    const order = await SupplierOrder.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    // Mark all pending products as received
    order.products.forEach((product) => {
      if (product.arrivalStatus === "pending") {
        product.arrivalStatus = "received";
        product.receivedQuantity = product.orderedQuantity;
        product.arrivalVerifiedAt = new Date();
        product.verifiedBy = verifiedBy || "Admin";
      }
    });

    order.status = order.hasIssues() ? "issues_reported" : "completed";
    order.verifiedBy = verifiedBy || "Admin";
    order.verificationCompletedAt = new Date();

    await order.save();

    res.json({
      success: true,
      message: "Order verification completed",
      data: order,
    });
  } catch (error) {
    console.error("Error completing order:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});

// =============================================
// GET STATISTICS
// =============================================
router.get("/stats/summary", async (req, res) => {
  try {
    const stats = await SupplierOrder.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalValue: { $sum: "$totalValue" },
        },
      },
    ]);

    const totalOrders = await SupplierOrder.countDocuments();
    const ordersWithIssues = await SupplierOrder.countDocuments({
      status: "issues_reported",
    });

    // Get recent orders
    const recentOrders = await SupplierOrder.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select("orderNumber supplierName status orderDate totalValue")
      .lean();

    res.json({
      success: true,
      data: {
        statusBreakdown: stats,
        totalOrders,
        ordersWithIssues,
        issueRate: totalOrders > 0 ? (ordersWithIssues / totalOrders) * 100 : 0,
        recentOrders,
      },
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});

// =============================================
// CREATE FROM EXISTING STOCK ORDERS
// =============================================
router.post("/from-stock-orders", async (req, res) => {
  try {
    const { supplierId, supplierName, orders } = req.body;

    if (!orders || orders.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No orders provided",
      });
    }

    // Get supplier details if supplierId provided
    let supplierDetails = {};
    if (supplierId) {
      const supplier = await Supplier.findById(supplierId);
      if (supplier) {
        supplierDetails = {
          supplier: supplier._id,
          supplierName: supplier.name,
          supplierContact: supplier.phone,
          supplierEmail: supplier.email,
          supplierAddress: supplier.address,
        };
      }
    }

    // Create products array from stock orders
    const products = [];
    for (const orderInfo of orders) {
      const product = await Product.findById(orderInfo.productId);
      if (product) {
        const stockOrder = product.orderStock?.find(
          (o) => o._id.toString() === orderInfo.orderStockId
        );

        products.push({
          productRef: product._id,
          productId: product.productId,
          productName: product.productName,
          productImage: product.masterImage ? "/product-image" : "",
          details: {
            specifications: product.specifications?.[0]
              ? `${product.specifications[0].height || ""}x${product.specifications[0].width || ""}x${product.specifications[0].length || ""}`
              : "",
          },
          orderedQuantity: stockOrder?.orderQuantity || orderInfo.quantity || 1,
          price: product.NormalPrice || 0,
        });
      }
    }

    if (products.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid products found",
      });
    }

    const order = await SupplierOrder.create({
      ...supplierDetails,
      supplierName: supplierDetails.supplierName || supplierName || "Unknown",
      products,
      status: "pending",
      createdBy: "System",
    });

    res.status(201).json({
      success: true,
      message: "Supplier order created from stock orders",
      data: order,
    });
  } catch (error) {
    console.error("Error creating from stock orders:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});
// =============================================
// SYNC FROM PRODUCT ORDER STOCK
// Creates supplier orders from existing product orderStock entries
// =============================================
router.post("/sync-from-products", async (req, res) => {
  try {
    // Find all products with orderStock entries that have status order_placed or order_confirmed
    const products = await Product.find({
      "orderStock.0": { $exists: true },
      "orderStock.status": { $in: ["order_placed", "order_confirmed"] },
    }).lean();

    console.log(`Found ${products.length} products with orders`);

    // Group orders by supplier
    const supplierOrders = {};

    for (const product of products) {
      for (const stockOrder of product.orderStock || []) {
        if (!["order_placed", "order_confirmed"].includes(stockOrder.status)) {
          continue;
        }

        const supplierKey = stockOrder.approvedSupplier || product.supplierName || "Unknown Supplier";
        
        if (!supplierOrders[supplierKey]) {
          supplierOrders[supplierKey] = {
            supplierName: supplierKey,
            supplierContact: stockOrder.supplierPhone || product.supplierContact || "",
            supplierEmail: stockOrder.supplierEmail || product.supplierEmail || "",
            supplierAddress: stockOrder.supplierAddress || product.supplierAddress || "",
            products: [],
            orderDate: stockOrder.orderPlacedAt || stockOrder.requestedAt || new Date(),
            estimatedArrival: stockOrder.estimatedDeliveryDate,
          };
        }

        supplierOrders[supplierKey].products.push({
          productRef: product._id,
          productId: product.productId,
          productName: product.productName,
          details: {
            specifications: product.specifications?.[0]
              ? `H:${product.specifications[0].height || 0} W:${product.specifications[0].width || 0}`
              : "",
          },
          orderedQuantity: stockOrder.orderQuantity || 1,
          price: product.NormalPrice || 0,
        });
      }
    }

    // Create supplier orders
    let createdCount = 0;
    const createdOrders = [];

    for (const [supplierName, orderData] of Object.entries(supplierOrders)) {
      // Check if similar order already exists (same supplier, same day)
      const orderDate = new Date(orderData.orderDate);
      orderDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(orderDate);
      nextDay.setDate(nextDay.getDate() + 1);

      const existingOrder = await SupplierOrder.findOne({
        supplierName: orderData.supplierName,
        orderDate: { $gte: orderDate, $lt: nextDay },
      });

      if (!existingOrder) {
        const newOrder = await SupplierOrder.create({
          ...orderData,
          status: "pending",
          createdBy: "Sync",
        });
        createdOrders.push(newOrder);
        createdCount++;
      }
    }

    res.json({
      success: true,
      message: `Synced ${createdCount} supplier orders from product stock orders`,
      data: {
        productsWithOrders: products.length,
        suppliersFound: Object.keys(supplierOrders).length,
        ordersCreated: createdCount,
        orders: createdOrders,
      },
    });
  } catch (error) {
    console.error("Error syncing from products:", error);
    res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
});

module.exports = router;
