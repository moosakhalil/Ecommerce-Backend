// server.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const rateLimit = require("express-rate-limit");

// Use AreaB model (114 Delivery Fees) - Old Area model (107) is deprecated
const { AreaB, Regency } = require("./models/AreaManagement");
const VehicleType = require("./models/VehicleType");
const DeliveryPeriod = require("./models/DeliveryPeriod");
const packingRoutes = require("./routes/packingRoutes");
// Import vendor routes
const vendorPreOrderRoutes = require("./routes/vendorpreorder");
const vendorRoutes = require("./routes/vendors");

// Load environment variables
dotenv.config();

// Initialize express app
const app = express();
const PORT = process.env.PORT || 5000;

// JWT Secrets (hardcoded as requested)
const JWT_SECRET = "admin-dashboard-super-secret-jwt-key-2025-secure";
const JWT_REFRESH_SECRET = "admin-dashboard-refresh-token-secret-2025";

// Email configuration (using your email)
const EMAIL_CONFIG = {
  service: "gmail",
  auth: {
    user: "realahmedali4@gmail.com",
    pass: "your-app-password", // You'll need to generate this in Gmail
  },
};

// ========== MIDDLEWARE SETUP (MUST BE BEFORE ROUTES) ==========

app.use(cors()); // This allows all origins by default

// ⭐ CRITICAL: Body parsing middleware MUST come before routes
// Replace multiple declarations with single configuration
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Static file serving
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/videos", express.static(path.join(__dirname, "videos")));

// Rate limiting for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    success: false,
    message: "Too many login attempts, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

// Add at the top with other requires
const multer = require("multer");

// Configure multer for video uploads
const videoUpload = multer({
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, path.join(__dirname, "videos"));
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      cb(
        null,
        file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
      );
    },
  }),
});

// ========== ROUTE IMPORTS ==========
const { router: adminAuthRouter } = require("./routes/adminAuth");

const ordersRouter = require("./routes/orders");
const employeeRoutes = require("./routes/employeeRoutes");
const employeeRoleRoutes = require("./routes/employeeRoleRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const productRoutes = require("./routes/productRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const salesDataRoutes = require("./routes/salesDataRoutes");
const billRoutes = require("./routes/billRoutes");
const taxBracketRoutes = require("./routes/taxBracketRoutes");
const walletRoutes = require("./routes/walletRoutes");
const customersRouter = require("./routes/customers");
const referralVideosRoutes = require("./routes/referralVideos");
const chatbotRouter = require("./routes/chatbot-router");
const referralDataRoutes = require("./routes/referralData");
const foremanCustomersRoutes = require("./routes/foremanCustomers");
const feeControlRoutes = require("./routes/feeControlRoutes");
const referralDemoRoutes = require("./routes/customerVideosRoutes");
const supportRoutes = require("./routes/support");
const deliveryRoutes = require("./routes/deliveryRoutes");
const storageRoutes = require("./routes/storageRoutes");
const dispatchOfficer1Routes = require("./routes/dispatchOfficer1Routes");
const dispatchOfficer2Routes = require("./routes/dispatchOfficer2Routes");
const driverOnDeliveryRoutes = require("./routes/driverOnDeliveryRoutes");
// Import the complaint routes
const complaintRoutes = require("./routes/complaints");
app.use("/api/vendor-preorders", vendorPreOrderRoutes);
const driverRoutes = require("./routes/driverRoutes");
const vehicleRoutes = require("./routes/vehicleRoutes");
const vehicleTemplateRoutes = require("./routes/vehicleTemplateRoutes");
app.use("/api/driver-on-delivery", driverOnDeliveryRoutes);

// Add vendor routes to your existing routes
app.use("/api/vendors", vendorRoutes);

// Also ensure your driver routes are included:

app.use("/api/driver", driverRoutes);
const deliveredOrdersRoutes = require("./routes/deliveredOrdersRoutes");

app.use("/api/delivery", deliveredOrdersRoutes);

// ========== IMPORT YOUR NEW VIDEO ROUTES ==========
const videoRoutes = require("./routes/videos"); // This should be your new video routes file

// ========== NEW AUTH ROUTES IMPORT ==========
const {
  router: authRouter,
  authenticateToken,
  requireRole,
} = require("./routes/auth");
const { adminRouter } = require("./routes/admin");

// Make JWT secrets and middleware available globally
app.use("/api/sales-data", salesDataRoutes);
app.use("/api/bills", billRoutes);
app.use("/api/tax-brackets", taxBracketRoutes);
app.use("/api/wallets", walletRoutes);
app.use("/api/fee-control", feeControlRoutes);

global.JWT_SECRET = JWT_SECRET;
global.JWT_REFRESH_SECRET = JWT_REFRESH_SECRET;
global.EMAIL_CONFIG = EMAIL_CONFIG;
global.authenticateToken = authenticateToken;
global.requireRole = requireRole;

// ========== ADMIN USER SEEDING FUNCTION ==========
const seedAdminUser = async () => {
  try {
    console.log("🔍 Checking for admin user...");

    // Import the models
    const { User } = require("./models/User");
    const { Role } = require("./models/Role");

    // First, ensure super_admin role exists
    let superAdminRole = await Role.findOne({ name: "super_admin" });

    if (!superAdminRole) {
      console.log("🆕 Creating super_admin role...");

      // Create a temporary admin user to assign as creator
      const tempAdminData = {
        username: "system",
        email: "system@admin.com",
        password: "temp123",
        name: "System Admin",
        status: "active",
        permissions: [],
      };

      // Create temporary user without role first
      const tempUser = new User(tempAdminData);
      const savedTempUser = await tempUser.save();

      // Create super_admin role
      superAdminRole = new Role({
        name: "super_admin",
        displayName: "Super Administrator",
        description: "Full system access with all permissions",
        components: [], // Super admin has access to everything
        categories: [], // Super admin has access to everything
        isSystemRole: true,
        isActive: true,
        priority: 1000,
        createdBy: savedTempUser._id,
        lastModifiedBy: savedTempUser._id,
      });

      await superAdminRole.save();
      console.log("✅ Super admin role created successfully");

      // Update temp user with the role
      savedTempUser.role = superAdminRole._id;
      await savedTempUser.save();
    }

    // Check if admin12 user already exists
    let adminUser = await User.findOne({ username: "admin12" });

    if (!adminUser) {
      console.log("🔐 Creating admin12 user...");

      adminUser = new User({
        username: "admin12",
        email: "admin12@admin.com",
        password: "admin12", // This will be hashed by the pre-save hook
        name: "Default Admin",
        role: superAdminRole._id,
        status: "active",
        permissions: [],
        createdBy: superAdminRole.createdBy,
      });

      await adminUser.save();
      console.log("✅ Admin user 'admin12' created successfully");
      console.log("   Username: admin12");
      console.log("   Password: admin123");
      console.log("   Role: Super Administrator");
    } else {
      console.log("✅ Admin user 'admin12' already exists");

      // Ensure the admin user has the correct role
      if (
        !adminUser.role ||
        adminUser.role.toString() !== superAdminRole._id.toString()
      ) {
        console.log("🔄 Updating admin12 role to super_admin...");
        adminUser.role = superAdminRole._id;
        await adminUser.save();
        console.log("✅ admin12 role updated to super_admin");
      }
    }

    // Ensure password is correct (in case user exists but password was changed)
    const isPasswordCorrect = await adminUser
      .comparePassword("admin12")
      .catch(() => false);
    if (!isPasswordCorrect) {
      console.log("🔄 Resetting admin12 password to 'admin12'...");
      adminUser.password = "1234"; // This will trigger the pre-save hook to hash it
      adminUser.loginAttempts = 0;
      adminUser.lockUntil = undefined;
      await adminUser.save();
      console.log("✅ admin12 password reset successfully");
    }
  } catch (error) {
    console.error("❌ Error seeding admin user:", error);
  }
};

// ========== DATABASE SEEDING FUNCTION (PERMISSIONS ONLY) ==========
const seedDatabase = async () => {
  try {
    console.log("🌱 Starting database seeding...");

    // Import the models
    const { Permission } = require("./models/Permission");

    // Only seed permissions (removed role seeding)
    console.log("📝 Seeding permissions...");
    await Permission.seedDefaultPermissions();

    console.log("✅ Database seeding completed successfully!");
  } catch (error) {
    console.error("❌ Database seeding failed:", error);
  }
};

// ========== DATABASE CONNECTION ==========
mongoose
  .connect(
    process.env.MONGODB_URI ||
      "mongodb+srv://chatbiz50_db_user:hv2Lr5GNFG3vo0Mt@cluster0.m8czptr.mongodb.net/?appName=Cluster0",
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  )
  .then(async () => {
    console.log("✅ MongoDB connected successfully");

    // ❌ REMOVED: Old admin seeding that conflicts
    // Admin.seedAdmin();

    // ✅ NEW: Seed admin user for the new auth system
    await seedAdminUser();

    // ✅ FIXED: Seed only permissions (removed role seeding)
    await seedDatabase();

    // ✅ NEW: Seed default tax bracket
    const TaxBracket = require("./models/TaxBracket");
    await TaxBracket.seedDefaultBracket();
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });

// ========== API ROUTES (AFTER MIDDLEWARE) ==========

// ⭐ ADD YOUR NEW VIDEO ROUTES FIRST (BEFORE OTHER CONFLICTING ROUTES)
app.use("/api/videos", videoRoutes);

// Original admin auth (keep existing path)
app.use("/api/admin", adminAuthRouter);

// Regular routes
app.use("/api/employees", employeeRoutes);
app.use("/api/employee-roles", employeeRoleRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/products", productRoutes);
app.use("/api", chatbotRouter);
app.use("/api/categories", categoryRoutes);
app.use("/api/orders", ordersRouter);
app.use("/api/customers", customersRouter);
app.use("/api/referral-videos", referralVideosRoutes);
app.use("/api/referral-data", referralDataRoutes);
const triggerManagementRoutes = require("./routes/triggerManagement");
app.use("/api/triggers", triggerManagementRoutes);
app.use("/api/foreman-customers", foremanCustomersRoutes);
app.use("/api/referral-demos", referralDemoRoutes);
app.use("/api/customer-videos", referralDemoRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/dispatch1", dispatchOfficer1Routes);
// Routes
app.use("/api/delivery", deliveryRoutes);
app.use("/api/packing", packingRoutes);
app.use("/api/dispatch2", dispatchOfficer2Routes);
app.use("/api/driver-on-delivery", driverOnDeliveryRoutes);

// Add the complaint routes to your server
app.use("/api/complaints", complaintRoutes);

// Also ensure your driver routes are included:

app.use("/api/driver", driverRoutes);
app.use("/api/storage", storageRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/vehicle-templates", vehicleTemplateRoutes);

// Calendar routes
const calendarRoutes = require("./routes/calendarRoutes");
app.use("/api/calendar", calendarRoutes);

// Competitor routes
const competitorRoutes = require("./routes/competitorRoutes");
app.use("/api/competitors", competitorRoutes);

// Area Management B routes
const areaManagementRoutes = require("./routes/areaManagementRoutes");
app.use("/api/area-management", areaManagementRoutes);

// Supplier Order routes (Supply/Stock Arrival)
const supplierOrderRoutes = require("./routes/supplierOrderRoutes");
app.use("/api/supplier-orders", supplierOrderRoutes);

// Product Tracking routes (IDs 301-308)
const productTrackingRoutes = require("./routes/productTrackingRoutes");
app.use("/api/tracking", productTrackingRoutes);

// Batch Discount Allocation routes
const batchDiscountRoutes = require("./routes/batchDiscountRoutes");
app.use("/api/batch-discounts", batchDiscountRoutes);

// Discount Window Config routes (Page 74 - Discount Policies)
const discountWindowConfigRoutes = require("./routes/discountWindowConfigRoutes");
app.use("/api/discount-window-config", discountWindowConfigRoutes);

// Chatbot Monitor routes (for testing/verification)
const chatbotMonitorRoutes = require("./routes/chatbotMonitorRoutes");
app.use("/api/chatbot-monitor", chatbotMonitorRoutes);

// ========== NEW AUTH ROUTES ==========
app.use("/api/auth", authRouter);
app.use("/api/user-admin", adminRouter); // Changed path to avoid conflict

// ========== AREAS API ENDPOINTS (DEPRECATED) ==========
// Old Area (107) endpoints removed. Use /api/area-management/area-b for new AreaB (114) management.

// ========== VEHICLE TYPES API ENDPOINTS ==========

// Get all vehicle types
app.get("/api/vehicle-types", async (req, res) => {
  try {
    const vehicleTypes = await VehicleType.find().sort({ name: 1 });
    res.json(vehicleTypes);
  } catch (error) {
    console.error("Error fetching vehicle types:", error);
    res.status(500).json({ error: "Failed to fetch vehicle types" });
  }
});

// Create a new vehicle type
app.post("/api/vehicle-types", async (req, res) => {
  try {
    const {
      name,
      displayName,
      category,
      specifications,
      description,
      isActive,
    } = req.body;

    // Validate required fields
    if (!name || !displayName) {
      return res
        .status(400)
        .json({ error: "Name and display name are required" });
    }

    // Check if vehicle type already exists
    const existingVehicleType = await VehicleType.findOne({
      name: name.toLowerCase(),
    });
    if (existingVehicleType) {
      return res
        .status(400)
        .json({ error: "Vehicle type with this name already exists" });
    }

    // Create new vehicle type
    const newVehicleType = new VehicleType({
      name: name.toLowerCase(),
      displayName,
      category: category || "truck",
      specifications: specifications || {
        maxVolume: 0,
        maxWeight: 0,
        maxPackages: 0,
      },
      description: description || "",
      isActive: isActive !== undefined ? isActive : true,
    });

    const savedVehicleType = await newVehicleType.save();
    res.status(201).json(savedVehicleType);
  } catch (error) {
    console.error("Error creating vehicle type:", error);
    res.status(500).json({ error: "Failed to create vehicle type" });
  }
});

// Update a vehicle type
app.put("/api/vehicle-types/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // If name is being updated, make sure it's lowercase
    if (updateData.name) {
      updateData.name = updateData.name.toLowerCase();
    }

    const updatedVehicleType = await VehicleType.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    if (!updatedVehicleType) {
      return res.status(404).json({ error: "Vehicle type not found" });
    }

    res.json(updatedVehicleType);
  } catch (error) {
    console.error("Error updating vehicle type:", error);
    res.status(500).json({ error: "Failed to update vehicle type" });
  }
});

// Delete a vehicle type
app.delete("/api/vehicle-types/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Check if vehicle type is being used in delivery periods
    const periodsUsingVehicle = await DeliveryPeriod.find({ vehicleType: id });
    if (periodsUsingVehicle.length > 0) {
      return res.status(400).json({
        error:
          "Cannot delete vehicle type that is being used in delivery periods",
      });
    }

    const deletedVehicleType = await VehicleType.findByIdAndDelete(id);

    if (!deletedVehicleType) {
      return res.status(404).json({ error: "Vehicle type not found" });
    }

    res.json({ message: "Vehicle type deleted successfully" });
  } catch (error) {
    console.error("Error deleting vehicle type:", error);
    res.status(500).json({ error: "Failed to delete vehicle type" });
  }
});

// Get only active vehicle types
app.get("/api/vehicle-types/active", async (req, res) => {
  try {
    const activeVehicleTypes = await VehicleType.find({ isActive: true }).sort({
      name: 1,
    });
    res.json(activeVehicleTypes);
  } catch (error) {
    console.error("Error fetching active vehicle types:", error);
    res.status(500).json({ error: "Failed to fetch active vehicle types" });
  }
});

// ========== DELIVERY PERIODS API ENDPOINTS ==========

// Get all delivery periods with optional category filter
app.get("/api/delivery-periods", async (req, res) => {
  try {
    const { category } = req.query;
    const filter = category ? { category } : {};

    const deliveryPeriods = await DeliveryPeriod.find(filter).sort({
      category: 1,
      name: 1,
    });
    res.json(deliveryPeriods);
  } catch (error) {
    console.error("Error fetching delivery periods:", error);
    res.status(500).json({ error: "Failed to fetch delivery periods" });
  }
});

// Create a new delivery period
app.post("/api/delivery-periods", async (req, res) => {
  try {
    const {
      category,
      name,
      timeFrame,
      truckPricing,
      scooterPricing,
      invoicePercentage,
      deliveryDiscount,
      isActive,
    } = req.body;

    // Validate required fields
    if (!name || !category) {
      return res.status(400).json({ error: "Name and category are required" });
    }

    // Check if delivery period with same name and category already exists
    const existingPeriod = await DeliveryPeriod.findOne({ name, category });
    if (existingPeriod) {
      return res.status(400).json({
        error: "Delivery period with this name and category already exists",
      });
    }

    // Create new delivery period
    const newDeliveryPeriod = new DeliveryPeriod({
      category: category || "day",
      name,
      timeFrame: timeFrame || {
        hours: null,
        fromDays: null,
        toDays: null,
        startTime: "09:00",
        endTime: "21:00",
      },
      truckPricing: truckPricing || { price: 0, isFree: false },
      scooterPricing: scooterPricing || { price: 0, isFree: false },
      invoicePercentage: invoicePercentage || 5,
      deliveryDiscount: deliveryDiscount || 30,
      isActive: isActive !== undefined ? isActive : true,
    });

    const savedDeliveryPeriod = await newDeliveryPeriod.save();

    res.status(201).json(savedDeliveryPeriod);
  } catch (error) {
    console.error("Error creating delivery period:", error);
    res.status(500).json({ error: "Failed to create delivery period" });
  }
});

// Update a delivery period
app.put("/api/delivery-periods/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const updatedDeliveryPeriod = await DeliveryPeriod.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    if (!updatedDeliveryPeriod) {
      return res.status(404).json({ error: "Delivery period not found" });
    }

    res.json(updatedDeliveryPeriod);
  } catch (error) {
    console.error("Error updating delivery period:", error);
    res.status(500).json({ error: "Failed to update delivery period" });
  }
});

// Delete a delivery period
app.delete("/api/delivery-periods/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const deletedDeliveryPeriod = await DeliveryPeriod.findByIdAndDelete(id);

    if (!deletedDeliveryPeriod) {
      return res.status(404).json({ error: "Delivery period not found" });
    }

    res.json({ message: "Delivery period deleted successfully" });
  } catch (error) {
    console.error("Error deleting delivery period:", error);
    res.status(500).json({ error: "Failed to delete delivery period" });
  }
});

// Get only active delivery periods
app.get("/api/delivery-periods/active", async (req, res) => {
  try {
    const activeDeliveryPeriods = await DeliveryPeriod.find({
      isActive: true,
    }).sort({ category: 1, name: 1 });
    res.json(activeDeliveryPeriods);
  } catch (error) {
    console.error("Error fetching active delivery periods:", error);
    res.status(500).json({ error: "Failed to fetch active delivery periods" });
  }
});

// Update a delivery period
app.put("/api/delivery-periods/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Validate vehicle type if it's being updated
    if (updateData.vehicleType) {
      const vehicleTypeExists = await VehicleType.findById(
        updateData.vehicleType
      );
      if (!vehicleTypeExists) {
        return res.status(400).json({ error: "Invalid vehicle type" });
      }
    }

    const updatedDeliveryPeriod = await DeliveryPeriod.findByIdAndUpdate(
      id,
      { ...updateData, updatedAt: Date.now() },
      { new: true, runValidators: true }
    ).populate("vehicleType", "name displayName category");

    if (!updatedDeliveryPeriod) {
      return res.status(404).json({ error: "Delivery period not found" });
    }

    res.json(updatedDeliveryPeriod);
  } catch (error) {
    console.error("Error updating delivery period:", error);
    res.status(500).json({ error: "Failed to update delivery period" });
  }
});

// Delete a delivery period
app.delete("/api/delivery-periods/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const deletedDeliveryPeriod = await DeliveryPeriod.findByIdAndDelete(id);

    if (!deletedDeliveryPeriod) {
      return res.status(404).json({ error: "Delivery period not found" });
    }

    res.json({ message: "Delivery period deleted successfully" });
  } catch (error) {
    console.error("Error deleting delivery period:", error);
    res.status(500).json({ error: "Failed to delete delivery period" });
  }
});

// Get only active delivery periods
app.get("/api/delivery-periods/active", async (req, res) => {
  try {
    const activeDeliveryPeriods = await DeliveryPeriod.find({ isActive: true })
      .populate("vehicleType", "name displayName category")
      .sort({ name: 1 });
    res.json(activeDeliveryPeriods);
  } catch (error) {
    console.error("Error fetching active delivery periods:", error);
    res.status(500).json({ error: "Failed to fetch active delivery periods" });
  }
});

// Get delivery periods by category
app.get("/api/delivery-periods/category/:category", async (req, res) => {
  try {
    const { category } = req.params;

    if (!["day", "night"].includes(category)) {
      return res
        .status(400)
        .json({ error: "Invalid category. Must be 'day' or 'night'" });
    }

    const deliveryPeriods = await DeliveryPeriod.find({
      category,
      isActive: true,
    }).sort({ name: 1 });

    res.json(deliveryPeriods);
  } catch (error) {
    console.error("Error fetching delivery periods by category:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch delivery periods by category" });
  }
});

// Get delivery periods with pricing for specific vehicle type
app.get("/api/delivery-periods/vehicle/:vehicleType", async (req, res) => {
  try {
    const { vehicleType } = req.params;

    if (!["truck", "scooter"].includes(vehicleType.toLowerCase())) {
      return res
        .status(400)
        .json({ error: "Invalid vehicle type. Must be 'truck' or 'scooter'" });
    }

    const deliveryPeriods = await DeliveryPeriod.find({ isActive: true }).sort({
      category: 1,
      name: 1,
    });

    // Transform the data to include pricing for the specific vehicle type
    const periodsWithVehiclePricing = deliveryPeriods.map((period) => {
      const vehiclePricing =
        vehicleType.toLowerCase() === "truck"
          ? period.truckPricing
          : period.scooterPricing;

      return {
        ...period.toObject(),
        vehiclePricing,
        pricing: vehiclePricing, // For backward compatibility
      };
    });

    res.json(periodsWithVehiclePricing);
  } catch (error) {
    console.error("Error fetching delivery periods by vehicle type:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch delivery periods by vehicle type" });
  }
});

// Video streaming endpoint (for old customer videos)
app.get("/api/video/:videoId", async (req, res) => {
  try {
    const { videoId } = req.params;

    // Find the video in database
    const Customer = require("./models/customer");
    const customer = await Customer.findOne({
      "referralvideos.imageId": videoId,
    });

    if (!customer) {
      return res.status(404).json({ error: "Video not found" });
    }

    const video = customer.referralvideos.find((v) => v.imageId === videoId);
    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    // Extract filename from the stored path and look in the videos folder
    const filename = video.imagePath.split("/").pop();
    const videoPath = path.join(__dirname, "videos", filename);

    console.log("Looking for video at:", videoPath);

    // Check if file exists
    if (!fs.existsSync(videoPath)) {
      console.error("Video file not found at:", videoPath);
      return res.status(404).json({
        error: "Video file not found on server",
        expectedPath: videoPath,
        filename: filename,
      });
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      // Support video streaming with range requests
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(videoPath, { start, end });
      const head = {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": video.mimetype || "video/mp4",
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      // Send entire file
      const head = {
        "Content-Length": fileSize,
        "Content-Type": video.mimetype || "video/mp4",
      };
      res.writeHead(200, head);
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (error) {
    console.error("Error serving video:", error);
    res.status(500).json({ error: "Error serving video" });
  }
});

// Debug routes (keeping existing ones)
app.get("/api/debug/video-files", (req, res) => {
  try {
    const videosDir = path.join(__dirname, "videos");

    if (!fs.existsSync(videosDir)) {
      return res.json({
        error: "Videos directory does not exist",
        expectedPath: videosDir,
        currentDir: __dirname,
      });
    }

    const files = fs.readdirSync(videosDir);
    const fileDetails = files.map((file) => {
      const filePath = path.join(videosDir, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        size: stats.size,
        path: filePath,
        url: `http://localhost:5000/videos/${file}`,
        exists: fs.existsSync(filePath),
      };
    });

    res.json({
      success: true,
      videosDirectory: videosDir,
      totalFiles: files.length,
      files: fileDetails,
    });
  } catch (error) {
    res.status(500).json({
      error: error.message,
      stack: error.stack,
    });
  }
});

// Analytics endpoints (keeping existing ones)
app.get("/api/analytics/summary", async (req, res) => {
  try {
    const Customer = require("./models/customer");

    const totalCustomers = await Customer.countDocuments();
    const customersWithVideos = await Customer.countDocuments({
      "referralvideos.0": { $exists: true },
    });
    const customersWithReferrals = await Customer.countDocuments({
      referredBy: { $exists: true },
    });

    const videoStats = await Customer.aggregate([
      { $match: { "referralvideos.0": { $exists: true } } },
      { $unwind: "$referralvideos" },
      {
        $group: {
          _id: null,
          totalVideos: { $sum: 1 },
          totalShares: {
            $sum: { $size: { $ifNull: ["$referralvideos.sharedWith", []] } },
          },
        },
      },
    ]);

    const stats = videoStats[0] || { totalVideos: 0, totalShares: 0 };

    res.json({
      success: true,
      summary: {
        totalCustomers,
        customersWithVideos,
        customersWithReferrals,
        totalVideos: stats.totalVideos,
        totalShares: stats.totalShares,
        averageVideosPerCustomer:
          customersWithVideos > 0
            ? (stats.totalVideos / customersWithVideos).toFixed(2)
            : 0,
        averageSharesPerVideo:
          stats.totalVideos > 0
            ? (stats.totalShares / stats.totalVideos).toFixed(2)
            : 0,
      },
    });
  } catch (error) {
    console.error("Error fetching analytics summary:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching analytics summary",
      error: error.message,
    });
  }
});

app.get("/api/analytics/trends", async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysBack = parseInt(days);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const Customer = require("./models/customer");

    const videoTrends = await Customer.aggregate([
      { $match: { "referralvideos.0": { $exists: true } } },
      { $unwind: "$referralvideos" },
      { $match: { "referralvideos.approvalDate": { $gte: startDate } } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$referralvideos.approvalDate",
            },
          },
          videoCount: { $sum: 1 },
          shareCount: {
            $sum: { $size: { $ifNull: ["$referralvideos.sharedWith", []] } },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const referralTrends = await Customer.aggregate([
      { $match: { "referredBy.dateReferred": { $gte: startDate } } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$referredBy.dateReferred",
            },
          },
          referralCount: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      success: true,
      trends: {
        videos: videoTrends,
        referrals: referralTrends,
      },
      period: `${daysBack} days`,
    });
  } catch (error) {
    console.error("Error fetching trends:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching trends",
      error: error.message,
    });
  }
});

// Migration and bulk update endpoints (keeping existing ones)
app.post("/api/migrate-foreman-fields", async (req, res) => {
  try {
    const Customer = require("./models/customer");

    const result = await Customer.updateMany(
      { foremanStatus: { $exists: false } },
      {
        $set: {
          foremanStatus: "regular",
          foremanAppliedAt: null,
          foremanApprovedAt: null,
          foremanNotes: "",
          foremanStatusHistory: [],
          foremanSettings: {
            canApproveReferrals: false,
            canManageTeam: false,
            commissionRate: 0,
            maxTeamSize: 0,
            territory: "",
          },
          performanceMetrics: {
            customerLoyaltyScore: 0,
            referralSuccessRate: 0,
            averageOrderValue: 0,
            monthlyTarget: 0,
            lastEvaluationDate: null,
          },
        },
      }
    );

    res.json({
      success: true,
      message: `Updated ${result.modifiedCount} customers with foreman fields`,
      result,
    });
  } catch (error) {
    console.error("Migration error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/api/foreman-customers/bulk-update", async (req, res) => {
  try {
    const { customerIds, status, reason } = req.body;

    if (
      !customerIds ||
      !Array.isArray(customerIds) ||
      customerIds.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "customerIds array is required",
      });
    }

    if (!status || !["regular", "pending", "approved"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Valid status is required",
      });
    }

    const Customer = require("./models/customer");

    const updateData = {
      foremanStatus: status,
      $push: {
        foremanStatusHistory: {
          status: status,
          updatedAt: new Date(),
          updatedBy: "bulk-admin",
          reason: reason || `Bulk update to ${status}`,
        },
      },
    };

    if (status === "pending") {
      updateData.foremanAppliedAt = new Date();
    } else if (status === "approved") {
      updateData.foremanApprovedAt = new Date();
    }

    const result = await Customer.updateMany(
      { _id: { $in: customerIds } },
      updateData
    );

    res.json({
      success: true,
      message: `Updated ${result.modifiedCount} customers to ${status} status`,
      updatedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Bulk update error:", error);
    res.status(500).json({
      success: false,
      message: "Error in bulk update",
      error: error.message,
    });
  }
});

// Foreman analytics endpoint (keeping existing)
app.get("/api/foreman-analytics", async (req, res) => {
  try {
    const Customer = require("./models/customer");

    const analytics = await Customer.aggregate([
      {
        $facet: {
          // Overall stats
          overallStats: [
            {
              $group: {
                _id: null,
                totalCustomers: { $sum: 1 },
                avgOrderValue: {
                  $avg: {
                    $cond: [
                      {
                        $gt: [{ $size: { $ifNull: ["$orderHistory", []] } }, 0],
                      },
                      {
                        $divide: [
                          {
                            $reduce: {
                              input: { $ifNull: ["$orderHistory", []] },
                              initialValue: 0,
                              in: {
                                $add: [
                                  "$value",
                                  { $ifNull: ["$this.totalAmount", 0] },
                                ],
                              },
                            },
                          },
                          { $size: { $ifNull: ["$orderHistory", []] } },
                        ],
                      },
                      0,
                    ],
                  },
                },
                totalRevenue: {
                  $sum: {
                    $reduce: {
                      input: { $ifNull: ["$orderHistory", []] },
                      initialValue: 0,
                      in: {
                        $add: ["$value", { $ifNull: ["$this.totalAmount", 0] }],
                      },
                    },
                  },
                },
              },
            },
          ],

          // Foreman status breakdown
          statusBreakdown: [
            {
              $group: {
                _id: { $ifNull: ["$foremanStatus", "regular"] },
                count: { $sum: 1 },
                avgSpent: {
                  $avg: {
                    $reduce: {
                      input: { $ifNull: ["$orderHistory", []] },
                      initialValue: 0,
                      in: {
                        $add: ["$value", { $ifNull: ["$this.totalAmount", 0] }],
                      },
                    },
                  },
                },
              },
            },
          ],

          // Top performers
          topPerformers: [
            {
              $addFields: {
                totalSpent: {
                  $reduce: {
                    input: { $ifNull: ["$orderHistory", []] },
                    initialValue: 0,
                    in: {
                      $add: ["$value", { $ifNull: ["$this.totalAmount", 0] }],
                    },
                  },
                },
                videosCount: { $size: { $ifNull: ["$referralvideos", []] } },
              },
            },
            {
              $sort: { totalSpent: -1 },
            },
            {
              $limit: 10,
            },
            {
              $project: {
                name: 1,
                referralCode: 1,
                foremanStatus: { $ifNull: ["$foremanStatus", "regular"] },
                totalSpent: 1,
                videosCount: 1,
                phoneNumber: { $arrayElemAt: ["$phoneNumber", 0] },
              },
            },
          ],
        },
      },
    ]);

    res.json({
      success: true,
      analytics: analytics[0],
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error fetching foreman analytics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching analytics",
      error: error.message,
    });
  }
});

// ========== PRODUCTION SETUP ==========
if (process.env.NODE_ENV === "production") {
  app.use(express.static("client/build"));

  app.get("*", (req, res) => {
    res.sendFile(path.resolve(__dirname, "client", "build", "index.html"));
  });
}

// ========== ERROR HANDLING ==========
app.use((err, req, res, next) => {
  console.error("Error details:", err);
  res.status(500).json({
    success: false,
    message: err.message || "Server error",
    error: process.env.NODE_ENV === "development" ? err.stack : {},
  });
});

// ========== START SERVER ==========
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("=".repeat(50));
  console.log("🚀 Enhanced Admin Dashboard Server Started");
  console.log("📧 Admin Email: realahmedali4@gmail.com");
  console.log("🔐 JWT Secret: Configured");
  console.log("🔒 2FA Support: Enabled");
  console.log("🎭 Dynamic Role System: Active");
  console.log("👤 Auto-seeded Admin: admin12 / 123456");
  console.log("=".repeat(50));
  console.log("🔗 API Endpoints:");
  console.log("   Auth: /api/auth/*");
  console.log("   User Management: /api/user-admin/*");
  console.log("   Original Admin: /api/admin/*");
  console.log("   ✨ NEW Videos: /api/videos/*");
  console.log("   📍 Areas Management: /api/areas/*");
  console.log("   🚛 Vehicle Types: /api/vehicle-types/*");
  console.log("   ⏰ Delivery Periods: /api/delivery-periods/*");
  console.log("=".repeat(50));
  console.log("💡 Roles need to be created manually");
  console.log("   (No automatic role seeding)");
  console.log("🎬 Video Management: Ready for 159A & 159B");
  console.log("🚚 Areas Management: Truck & Scooter Pricing");
  console.log("🚛 Vehicle Types: Full CRUD Operations");
  console.log("⏰ Delivery Periods: Time-based Pricing System");
  console.log("👤 Default Admin Login: admin12 / 123456");
  console.log("=".repeat(50));
});

module.exports = app;
