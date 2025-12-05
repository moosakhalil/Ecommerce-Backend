const express = require("express");
const router = express.Router();
const Employee = require("../models/Employee");
const multer = require("multer");
const path = require("path");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

const uploadFields = [
  { name: "profilePicture", maxCount: 1 },
  { name: "idCardFront", maxCount: 1 },
  { name: "idCardBack", maxCount: 1 },
  { name: "passportFront", maxCount: 1 },
  { name: "passportBack", maxCount: 1 },
  { name: "otherDoc1", maxCount: 1 },
  { name: "otherDoc2", maxCount: 1 },
];

// ✅ GET: List all employees with filters
router.get("/", async (req, res) => {
  try {
    const {
      role,
      available,
      category,
      search,
      page = 1,
      limit = 10,
    } = req.query;

    console.log("=== EMPLOYEE LIST QUERY ===");
    console.log("Filters:", { role, available, category, search });

    let query = {};

    if (role) {
      query.roles = role;
    }

    if (available === "true") {
      query["availability.status"] = "available";
    }

    if (category) {
      query.employeeCategory = category;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { employeeId: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Employee.countDocuments(query);
    const employees = await Employee.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    console.log("=== EMPLOYEE LIST RESULT ===");
    console.log("Total found:", total);
    console.log("Returned:", employees.length);

    res.json({
      success: true,
      employees,
      total,
      page: Number(page),
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching employees:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching employees",
      error: error.message,
    });
  }
});

// ✅ GET: Get available employees by role (for packing staff)
router.get("/packing-staff", async (req, res) => {
  try {
    const employees = await Employee.find({
      roles: { $in: ["packing-staff"] },
      isActivated: true,
      isBlocked: false,
    }).select("employeeId name phone email currentAssignments maxAssignments");

    res.json(employees);
  } catch (error) {
    console.error("Error fetching packing staff:", error);
    res.json([]);
  }
});

// ✅ GET: Get available employees by role (for driver assignment)
router.get("/available/:role", async (req, res) => {
  try {
    const { role } = req.params;

    console.log("=== GET AVAILABLE EMPLOYEES ===");
    console.log("Role:", role);

    const employees = await Employee.find({
      roles: role,
      $expr: { $lt: ["$currentAssignments", "$maxAssignments"] },
      "availability.status": "available",
      isActivated: true,
      isBlocked: false,
    }).select(
      "employeeId name phone email currentAssignments maxAssignments performanceMetrics.rating"
    );

    console.log("Found available employees:", employees.length);

    res.json({
      success: true,
      employees,
      count: employees.length,
    });
  } catch (error) {
    console.error("Error fetching available employees:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching available employees",
      error: error.message,
    });
  }
});

// ✅ GET: Get specific employee by ID
router.get("/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    const employee = await Employee.findOne({ employeeId });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    res.json({
      success: true,
      employee,
    });
  } catch (error) {
    console.error("Error fetching employee:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching employee",
      error: error.message,
    });
  }
});

// ✅ POST: Create new employee
router.post("/", upload.fields(uploadFields), async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      address,
      emergencyContact,
      homeLocation,
      addedOn,
      employeeCategory,
      roles,
      contacts,
      isActivated,
      isBlocked,
    } = req.body;

    console.log("=== CREATE EMPLOYEE ===");
    console.log("Name:", name);
    console.log("Email:", email);
    console.log("Category:", employeeCategory);
    console.log("Request body:", req.body);

    // Validate required fields
    if (
      !name ||
      !email ||
      !phone ||
      !employeeCategory ||
      !address ||
      !homeLocation ||
      !emergencyContact
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const phoneArray = typeof phone === "string" ? [phone] : phone || [];
    const rolesArray = roles
      ? Array.isArray(roles)
        ? roles
        : JSON.parse(roles)
      : [];
    const contactsArray = contacts
      ? Array.isArray(contacts)
        ? contacts
        : JSON.parse(contacts)
      : [];

    // Process uploaded files
    const fileData = {};
    if (req.files) {
      if (req.files.profilePicture) {
        fileData.profilePicture = req.files.profilePicture[0].path;
      }
      if (req.files.idCardFront) {
        fileData.idCardFront = req.files.idCardFront[0].path;
      }
      if (req.files.idCardBack) {
        fileData.idCardBack = req.files.idCardBack[0].path;
      }
      if (req.files.passportFront) {
        fileData.passportFront = req.files.passportFront[0].path;
      }
      if (req.files.passportBack) {
        fileData.passportBack = req.files.passportBack[0].path;
      }
      if (req.files.otherDoc1) {
        fileData.otherDoc1 = req.files.otherDoc1[0].path;
      }
      if (req.files.otherDoc2) {
        fileData.otherDoc2 = req.files.otherDoc2[0].path;
      }
    }

    const employeeData = {
      name,
      email,
      phone: phoneArray,
      address,
      emergencyContact,
      homeLocation,
      addedOn: addedOn || new Date(),
      employeeCategory,
      roles: rolesArray,
      contacts: contactsArray,
      isActivated: isActivated !== "false",
      isBlocked: isBlocked === "true",
      ...fileData,
    };

    const employee = new Employee(employeeData);
    await employee.save();

    console.log("Employee created:", employee.employeeId);

    res.status(201).json({
      success: true,
      message: "Employee created successfully",
      employee,
    });
  } catch (error) {
    console.error("Error creating employee:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Error creating employee",
    });
  }
});

// ✅ PUT: Update employee
router.put("/:employeeId", upload.fields(uploadFields), async (req, res) => {
  try {
    const { employeeId } = req.params;
    const {
      name,
      email,
      phone,
      address,
      emergencyContact,
      homeLocation,
      employeeCategory,
      roles,
      contacts,
      isActivated,
      isBlocked,
    } = req.body;

    const employee = await Employee.findOne({ employeeId });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const phoneArray = typeof phone === "string" ? [phone] : phone || [];
    const rolesArray = roles
      ? Array.isArray(roles)
        ? roles
        : JSON.parse(roles)
      : [];
    const contactsArray = contacts
      ? Array.isArray(contacts)
        ? contacts
        : JSON.parse(contacts)
      : [];

    // Update fields
    if (name) employee.name = name;
    if (email) employee.email = email;
    if (phoneArray.length) employee.phone = phoneArray;
    if (address) employee.address = address;
    if (emergencyContact) employee.emergencyContact = emergencyContact;
    if (homeLocation) employee.homeLocation = homeLocation;
    if (employeeCategory) employee.employeeCategory = employeeCategory;
    if (rolesArray.length) employee.roles = rolesArray;
    if (contactsArray.length) employee.contacts = contactsArray;
    if (isActivated !== undefined)
      employee.isActivated = isActivated !== "false";
    if (isBlocked !== undefined) employee.isBlocked = isBlocked === "true";

    // Update uploaded files
    if (req.files) {
      if (req.files.profilePicture) {
        employee.profilePicture = req.files.profilePicture[0].path;
      }
      if (req.files.idCardFront) {
        employee.idCardFront = req.files.idCardFront[0].path;
      }
      if (req.files.idCardBack) {
        employee.idCardBack = req.files.idCardBack[0].path;
      }
      if (req.files.passportFront) {
        employee.passportFront = req.files.passportFront[0].path;
      }
      if (req.files.passportBack) {
        employee.passportBack = req.files.passportBack[0].path;
      }
      if (req.files.otherDoc1) {
        employee.otherDoc1 = req.files.otherDoc1[0].path;
      }
      if (req.files.otherDoc2) {
        employee.otherDoc2 = req.files.otherDoc2[0].path;
      }
    }

    await employee.save();

    res.json({
      success: true,
      message: "Employee updated successfully",
      employee,
    });
  } catch (error) {
    console.error("Error updating employee:", error);
    res.status(400).json({
      success: false,
      message: error.message || "Error updating employee",
    });
  }
});

// ✅ PUT: Update employee availability
router.put("/:employeeId/availability", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { status, leaveStartDate, leaveEndDate, leaveReason } = req.body;

    console.log("=== UPDATE EMPLOYEE AVAILABILITY ===");
    console.log("Employee ID:", employeeId);
    console.log("New status:", status);

    const employee = await Employee.findOne({ employeeId });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    employee.availability.status = status;
    employee.availability.lastStatusUpdate = new Date();

    if (status === "on-leave") {
      employee.availability.leaveStartDate = leaveStartDate;
      employee.availability.leaveEndDate = leaveEndDate;
      employee.availability.leaveReason = leaveReason;
    }

    await employee.save();

    res.json({
      success: true,
      message: "Availability updated successfully",
      employee,
    });
  } catch (error) {
    console.error("Error updating availability:", error);
    res.status(500).json({
      success: false,
      message: "Error updating availability",
      error: error.message,
    });
  }
});

// ✅ POST: Assign order to employee
router.post("/:employeeId/assign-order", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { orderId, customerId, customerName, estimatedCompletionTime } =
      req.body;

    console.log("=== ASSIGN ORDER TO EMPLOYEE ===");
    console.log("Employee:", employeeId);
    console.log("Order:", orderId);

    const employee = await Employee.findOne({ employeeId });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    if (employee.currentAssignments >= employee.maxAssignments) {
      return res.status(400).json({
        success: false,
        message: "Employee has reached maximum assignments",
      });
    }

    employee.assignedOrders.push({
      orderId,
      customerId,
      customerName,
      assignedAt: new Date(),
      estimatedCompletionTime,
      status: "assigned",
    });

    employee.currentAssignments += 1;

    await employee.save();

    console.log("Order assigned successfully");

    res.json({
      success: true,
      message: "Order assigned successfully",
      employee,
    });
  } catch (error) {
    console.error("Error assigning order:", error);
    res.status(500).json({
      success: false,
      message: "Error assigning order",
      error: error.message,
    });
  }
});

// ✅ PUT: Update order status for employee
router.put("/:employeeId/order-status/:orderId", async (req, res) => {
  try {
    const { employeeId, orderId } = req.params;
    const { status } = req.body;

    console.log("=== UPDATE EMPLOYEE ORDER STATUS ===");
    console.log("Employee:", employeeId);
    console.log("Order:", orderId);
    console.log("Status:", status);

    const employee = await Employee.findOne({ employeeId });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    const orderIndex = employee.assignedOrders.findIndex(
      (o) => o.orderId === orderId
    );

    if (orderIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Order not found in employee assignments",
      });
    }

    employee.assignedOrders[orderIndex].status = status;

    if (status === "completed" || status === "failed") {
      employee.currentAssignments = Math.max(
        0,
        employee.currentAssignments - 1
      );

      if (status === "completed") {
        employee.performanceMetrics.successfulDeliveries += 1;
        employee.performanceMetrics.totalDeliveries += 1;
      } else if (status === "failed") {
        employee.performanceMetrics.failedDeliveries += 1;
        employee.performanceMetrics.totalDeliveries += 1;
      }
    }

    await employee.save();

    res.json({
      success: true,
      message: "Order status updated",
      employee,
    });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating order status",
      error: error.message,
    });
  }
});

// ✅ GET: Get current assignments for employee
router.get("/:employeeId/assignments", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { status } = req.query;

    const employee = await Employee.findOne({ employeeId });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    let assignments = employee.assignedOrders;

    if (status) {
      assignments = assignments.filter((a) => a.status === status);
    }

    res.json({
      success: true,
      assignments,
      total: assignments.length,
      currentAssignments: employee.currentAssignments,
      maxAssignments: employee.maxAssignments,
    });
  } catch (error) {
    console.error("Error fetching assignments:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching assignments",
      error: error.message,
    });
  }
});

// ✅ PUT: Update employee location
router.put("/:employeeId/location", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { latitude, longitude, address } = req.body;

    const employee = await Employee.findOne({ employeeId });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    employee.currentLocation = {
      latitude,
      longitude,
      address,
      updatedAt: new Date(),
    };

    await employee.save();

    res.json({
      success: true,
      message: "Location updated",
      employee,
    });
  } catch (error) {
    console.error("Error updating location:", error);
    res.status(500).json({
      success: false,
      message: "Error updating location",
      error: error.message,
    });
  }
});

// ✅ POST: Log employee activity
router.post("/:employeeId/activity", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { action, orderId, details } = req.body;

    const employee = await Employee.findOne({ employeeId });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    employee.activityLog.push({
      action,
      timestamp: new Date(),
      orderId,
      details,
    });

    if (employee.activityLog.length > 100) {
      employee.activityLog = employee.activityLog.slice(-100);
    }

    await employee.save();

    res.json({
      success: true,
      message: "Activity logged",
    });
  } catch (error) {
    console.error("Error logging activity:", error);
    res.status(500).json({
      success: false,
      message: "Error logging activity",
      error: error.message,
    });
  }
});

// ✅ GET: Get employee performance metrics
router.get("/:employeeId/performance", async (req, res) => {
  try {
    const { employeeId } = req.params;

    const employee = await Employee.findOne({ employeeId }).select(
      "employeeId name performanceMetrics"
    );

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: "Employee not found",
      });
    }

    res.json({
      success: true,
      performanceMetrics: employee.performanceMetrics,
    });
  } catch (error) {
    console.error("Error fetching performance metrics:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching performance metrics",
      error: error.message,
    });
  }
});

module.exports = router;
