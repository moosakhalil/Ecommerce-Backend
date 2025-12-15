const express = require("express");
const router = express.Router();
const EmployeeRole = require("../models/EmployeeRole");

// GET: Fetch all employee roles
router.get("/", async (req, res) => {
  try {
    const roles = await EmployeeRole.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      roles,
    });
  } catch (error) {
    console.error("Error fetching employee roles:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching employee roles",
      error: error.message,
    });
  }
});

// GET: Fetch single employee role
router.get("/:roleId", async (req, res) => {
  try {
    const { roleId } = req.params;
    const role = await EmployeeRole.findById(roleId);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    res.json({
      success: true,
      role,
    });
  } catch (error) {
    console.error("Error fetching employee role:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching employee role",
      error: error.message,
    });
  }
});

// POST: Create new employee role
router.post("/", async (req, res) => {
  try {
    const { name, description, permissions } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Role name is required",
      });
    }

    // Check if role with same name exists
    const existingRole = await EmployeeRole.findOne({ name });
    if (existingRole) {
      return res.status(400).json({
        success: false,
        message: "A role with this name already exists",
      });
    }

    const role = new EmployeeRole({
      name,
      description: description || "",
      permissions: permissions || [],
    });

    await role.save();

    res.status(201).json({
      success: true,
      message: "Employee role created successfully",
      role,
    });
  } catch (error) {
    console.error("Error creating employee role:", error);
    res.status(500).json({
      success: false,
      message: "Error creating employee role",
      error: error.message,
    });
  }
});

// PUT: Update employee role
router.put("/:roleId", async (req, res) => {
  try {
    const { roleId } = req.params;
    const { name, description, permissions } = req.body;

    console.log("=== UPDATE EMPLOYEE ROLE ===");
    console.log("Role ID:", roleId);
    console.log("Request body:", { name, description, permissions });

    const role = await EmployeeRole.findById(roleId);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    // Check if new name conflicts with existing role
    if (name && name !== role.name) {
      const existingRole = await EmployeeRole.findOne({ name });
      if (existingRole) {
        return res.status(400).json({
          success: false,
          message: "A role with this name already exists",
        });
      }
    }

    if (name) role.name = name;
    if (description !== undefined) role.description = description;
    if (permissions !== undefined) role.permissions = permissions;

    console.log("Saving role with permissions:", role.permissions);
    await role.save();

    console.log("✅ Role updated successfully");

    res.json({
      success: true,
      message: "Employee role updated successfully",
      role,
    });
  } catch (error) {
    console.error("❌ Error updating employee role:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      success: false,
      message: "Error updating employee role",
      error: error.message,
      details: error.toString(),
    });
  }
});

// DELETE: Delete employee role
router.delete("/:roleId", async (req, res) => {
  try {
    const { roleId } = req.params;

    const role = await EmployeeRole.findByIdAndDelete(roleId);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    res.json({
      success: true,
      message: "Employee role deleted successfully",
      role,
    });
  } catch (error) {
    console.error("Error deleting employee role:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting employee role",
      error: error.message,
    });
  }
});

module.exports = router;
