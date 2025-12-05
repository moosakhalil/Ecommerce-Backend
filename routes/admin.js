// routes/admin.js - CLEANED UP VERSION WITH PROPER COMPONENT ACCESS
const express = require("express");
const adminRouter = express.Router();
const jwt = require("jsonwebtoken");
const { User } = require("../models/User");
const { Role } = require("../models/Role");
const { Permission } = require("../models/Permission");

// Get JWT secret from global variables (same as auth.js)
const JWT_SECRET =
  global.JWT_SECRET || "admin-dashboard-super-secret-jwt-key-2025-secure";

// Authentication middleware with better logging
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    console.log("🔒 ADMIN API: No access token provided");
    return res.status(401).json({
      success: false,
      message: "Access token required",
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log("🔒 ADMIN API: Token verification failed:", err.message);
      return res.status(403).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    console.log(
      `✅ ADMIN API: Token verified for user ${user.username} (${user.role})`
    );
    req.user = user;
    next();
  });
};

// Role-based access control middleware
const requireSuperAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Get user with role populated
    const user = await User.findById(req.user.id).populate("role");
    if (!user || !user.role || user.role.name !== "super_admin") {
      console.log(
        `🚫 ADMIN API: Access denied. User ${req.user.username} is not super admin`
      );
      return res.status(403).json({
        success: false,
        message: "Super admin access required",
      });
    }

    console.log(
      `✅ ADMIN API: Super admin check passed for ${req.user.username}`
    );
    next();
  } catch (error) {
    console.error("❌ SUPER ADMIN CHECK ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// ============================================================================
// USER MANAGEMENT ROUTES
// ============================================================================

// Get all users (Super Admin only)
adminRouter.get(
  "/users",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      console.log(`📋 FETCHING USERS: Request by ${req.user.username}`);

      const { page = 1, limit = 100, search = "", role = "" } = req.query;

      const query = {};
      if (search) {
        query.$or = [
          { username: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
          { name: { $regex: search, $options: "i" } },
        ];
      }

      if (role) {
        query.role = role;
      }

      const users = await User.find(query)
        .select("-password -otpSecret")
        .populate("role", "name displayName components categories")
        .populate("createdBy", "username")
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);

      const total = await User.countDocuments(query);

      console.log(`✅ USERS FETCHED: ${users.length} users returned`);

      res.status(200).json({
        success: true,
        users,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalUsers: total,
        },
      });
    } catch (error) {
      console.error("❌ GET USERS ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Create new user (Super Admin only)
adminRouter.post(
  "/users",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const {
        username,
        email,
        password,
        name,
        roleId,
        permissions = [],
      } = req.body;

      console.log(`👤 CREATING USER: ${username} by ${req.user.username}`);

      // Validate required fields
      if (!username || !email || !password || !name || !roleId) {
        console.log("❌ CREATE USER: Missing required fields");
        return res.status(400).json({
          success: false,
          message: "All fields are required",
        });
      }

      // Check if role exists
      const role = await Role.findById(roleId);
      if (!role) {
        return res.status(400).json({
          success: false,
          message: "Invalid role selected",
        });
      }

      // Check if user already exists
      const existingUser = await User.findOne({
        $or: [{ username }, { email }],
      });

      if (existingUser) {
        console.log(`❌ CREATE USER: User already exists - ${username}`);
        return res.status(400).json({
          success: false,
          message: "User with this username or email already exists",
        });
      }

      // Create new user
      const newUser = new User({
        username,
        email,
        password,
        name,
        role: roleId,
        permissions,
        createdBy: req.user.id,
        status: "active",
      });

      await newUser.save();

      // Populate role info for response
      await newUser.populate("role", "name displayName components categories");

      // Remove sensitive data before sending response
      const userResponse = newUser.toObject();
      delete userResponse.password;
      delete userResponse.otpSecret;

      console.log(`✅ USER CREATED: ${username} with role ${role.displayName}`);

      res.status(201).json({
        success: true,
        message: "User created successfully",
        user: userResponse,
      });
    } catch (error) {
      console.error("❌ CREATE USER ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Update user role (Super Admin only)
adminRouter.put(
  "/users/:id/role",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { roleId } = req.body;

      console.log(`🔄 UPDATING USER ROLE: ${id} by ${req.user.username}`);

      if (!roleId) {
        return res.status(400).json({
          success: false,
          message: "Role ID is required",
        });
      }

      // Check if role exists
      const role = await Role.findById(roleId);
      if (!role) {
        return res.status(400).json({
          success: false,
          message: "Invalid role selected",
        });
      }

      const user = await User.findById(id);
      if (!user) {
        console.log(`❌ UPDATE USER ROLE: User not found - ${id}`);
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const oldRole = await Role.findById(user.role);
      user.role = roleId;
      await user.save();

      await user.populate("role", "name displayName components categories");

      console.log(
        `✅ USER ROLE UPDATED: ${user.username} from ${oldRole?.displayName} to ${role.displayName}`
      );

      res.status(200).json({
        success: true,
        message: "User role updated successfully",
        user: {
          id: user._id,
          username: user.username,
          role: user.role,
        },
      });
    } catch (error) {
      console.error("❌ UPDATE USER ROLE ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Reset user password (Super Admin only)
adminRouter.post(
  "/users/:id/reset-password",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { newPassword } = req.body;

      console.log(`🔑 RESETTING PASSWORD: User ${id} by ${req.user.username}`);

      if (!newPassword || newPassword.length < 6) {
        console.log("❌ RESET PASSWORD: Password too short");
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters long",
        });
      }

      const user = await User.findById(id);
      if (!user) {
        console.log(`❌ RESET PASSWORD: User not found - ${id}`);
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      user.password = newPassword;
      user.loginAttempts = 0;
      user.lockUntil = undefined;
      await user.save();

      console.log(`✅ PASSWORD RESET: ${user.username}`);

      res.status(200).json({
        success: true,
        message: "Password reset successfully",
      });
    } catch (error) {
      console.error("❌ RESET PASSWORD ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Toggle user status (Super Admin only)
adminRouter.post(
  "/users/:id/toggle-status",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      console.log(`🔄 TOGGLING STATUS: User ${id} by ${req.user.username}`);

      const user = await User.findById(id);
      if (!user) {
        console.log(`❌ TOGGLE STATUS: User not found - ${id}`);
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      const oldStatus = user.status;
      user.status = user.status === "active" ? "inactive" : "active";
      await user.save();

      console.log(
        `✅ STATUS TOGGLED: ${user.username} from ${oldStatus} to ${user.status}`
      );

      res.status(200).json({
        success: true,
        message: `User ${
          user.status === "active" ? "activated" : "deactivated"
        } successfully`,
        status: user.status,
      });
    } catch (error) {
      console.error("❌ TOGGLE STATUS ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// ============================================================================
// ROLE MANAGEMENT ROUTES
// ============================================================================

// Get all roles
adminRouter.get(
  "/roles",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      console.log(`📋 FETCHING ROLES: Request by ${req.user.username}`);

      const roles = await Role.find()
        .populate("createdBy", "username")
        .populate("lastModifiedBy", "username")
        .sort({ priority: -1, createdAt: -1 });

      // Get user count for each role
      const rolesWithUserCount = await Promise.all(
        roles.map(async (role) => {
          const userCount = await User.countDocuments({ role: role._id });
          return {
            ...role.toObject(),
            userCount,
          };
        })
      );

      console.log(`✅ ROLES FETCHED: ${roles.length} roles returned`);

      res.status(200).json({
        success: true,
        roles: rolesWithUserCount,
      });
    } catch (error) {
      console.error("❌ GET ROLES ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Create new role
adminRouter.post(
  "/roles",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const {
        name,
        displayName,
        description,
        components = [],
        categories = [],
        priority = 0,
      } = req.body;

      console.log(`🆕 CREATING ROLE: ${name} by ${req.user.username}`);

      if (!name || !displayName || !description) {
        return res.status(400).json({
          success: false,
          message: "Name, display name, and description are required",
        });
      }

      // Check if role name already exists
      const existingRole = await Role.findOne({ name });
      if (existingRole) {
        return res.status(400).json({
          success: false,
          message: "Role with this name already exists",
        });
      }

      // Create new role with proper component assignment
      const newRole = new Role({
        name: name.toLowerCase().replace(/\s+/g, "_"),
        displayName,
        description,
        components: components, // This should be an array of component IDs like ["1", "2", "28", etc.]
        categories: categories, // This should be an array of category keys like ["operations", "inventory", etc.]
        priority,
        isSystemRole: false, // Custom roles are not system roles
        isActive: true,
        createdBy: req.user.id,
        lastModifiedBy: req.user.id,
      });

      await newRole.save();
      await newRole.populate("createdBy", "username");

      console.log(
        `✅ ROLE CREATED: ${displayName} with ${components.length} components`
      );
      console.log(`   Components: [${components.join(", ")}]`);
      console.log(`   Categories: [${categories.join(", ")}]`);

      res.status(201).json({
        success: true,
        message: "Role created successfully",
        role: newRole,
      });
    } catch (error) {
      console.error("❌ CREATE ROLE ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Update role
adminRouter.put(
  "/roles/:id",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        displayName,
        description,
        components,
        categories,
        priority,
        isActive,
      } = req.body;

      console.log(`✏️ UPDATING ROLE: ${id} by ${req.user.username}`);

      const role = await Role.findById(id);
      if (!role) {
        return res.status(404).json({
          success: false,
          message: "Role not found",
        });
      }

      // Update role fields
      if (displayName) role.displayName = displayName;
      if (description) role.description = description;
      if (components !== undefined) {
        role.components = components;
        console.log(`   Updated components: [${components.join(", ")}]`);
      }
      if (categories !== undefined) {
        role.categories = categories;
        console.log(`   Updated categories: [${categories.join(", ")}]`);
      }
      if (priority !== undefined) role.priority = priority;
      if (isActive !== undefined) role.isActive = isActive;

      role.lastModifiedBy = req.user.id;

      await role.save();
      await role.populate("lastModifiedBy", "username");

      console.log(`✅ ROLE UPDATED: ${role.displayName}`);

      res.status(200).json({
        success: true,
        message: "Role updated successfully",
        role,
      });
    } catch (error) {
      console.error("❌ UPDATE ROLE ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Delete role (with password verification) - SIMPLIFIED - ONLY PROTECT SUPER_ADMIN
adminRouter.delete(
  "/roles/:id",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { password } = req.body;

      console.log(`🗑️ DELETING ROLE: ${id} by ${req.user.username}`);

      // PASSWORD VERIFICATION
      if (!password) {
        console.log("❌ DELETE ROLE: No password provided");
        return res.status(400).json({
          success: false,
          message: "Admin password verification required",
        });
      }

      // Get the current user with password for verification
      const currentUser = await User.findById(req.user.id);
      if (!currentUser) {
        console.log("❌ DELETE ROLE: Current user not found");
        return res.status(401).json({
          success: false,
          message: "Current user not found",
        });
      }

      // Verify the provided password matches current user's password
      const isValidPassword = await currentUser.comparePassword(password);
      if (!isValidPassword) {
        console.log("❌ DELETE ROLE: Invalid password provided");
        return res.status(401).json({
          success: false,
          message: "Invalid admin password",
        });
      }

      console.log("✅ DELETE ROLE: Password verified successfully");

      // Get role details
      const role = await Role.findById(id);
      if (!role) {
        return res.status(404).json({
          success: false,
          message: "Role not found",
        });
      }

      // ONLY PROTECT super_admin - ALL OTHER ROLES CAN BE DELETED
      if (role.name === "super_admin") {
        return res.status(400).json({
          success: false,
          message: "Cannot delete the super_admin role",
        });
      }

      // Check if any users have this role
      const userCount = await User.countDocuments({ role: id });
      if (userCount > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot delete role. ${userCount} users are assigned to this role. Please reassign them first.`,
        });
      }

      await Role.findByIdAndDelete(id);

      console.log(
        `✅ ROLE DELETED: ${role.displayName} by ${req.user.username}`
      );

      res.status(200).json({
        success: true,
        message: "Role deleted successfully",
      });
    } catch (error) {
      console.error("❌ DELETE ROLE ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Bulk delete roles (with password verification) - SIMPLIFIED
adminRouter.post(
  "/roles/bulk-delete",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { roleIds, password } = req.body;

      console.log(
        `🗑️ BULK DELETING ROLES: ${roleIds?.length} roles by ${req.user.username}`
      );

      // PASSWORD VERIFICATION
      if (!password) {
        console.log("❌ BULK DELETE: No password provided");
        return res.status(400).json({
          success: false,
          message: "Admin password verification required",
        });
      }

      // Get the current user with password for verification
      const currentUser = await User.findById(req.user.id);
      if (!currentUser) {
        console.log("❌ BULK DELETE: Current user not found");
        return res.status(401).json({
          success: false,
          message: "Current user not found",
        });
      }

      // Verify the provided password matches current user's password
      const isValidPassword = await currentUser.comparePassword(password);
      if (!isValidPassword) {
        console.log("❌ BULK DELETE: Invalid password provided");
        return res.status(401).json({
          success: false,
          message: "Invalid admin password",
        });
      }

      console.log("✅ BULK DELETE: Password verified successfully");

      // Validate roleIds array
      if (!roleIds || !Array.isArray(roleIds) || roleIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "roleIds array is required and cannot be empty",
        });
      }

      // Get roles and filter out only super_admin
      const roles = await Role.find({ _id: { $in: roleIds } });
      const superAdminRoles = roles.filter(
        (role) => role.name === "super_admin"
      );
      const deletableRoles = roles.filter(
        (role) => role.name !== "super_admin"
      );

      if (superAdminRoles.length > 0) {
        console.log("❌ BULK DELETE: Attempted to delete super_admin role");
        return res.status(400).json({
          success: false,
          message: "Cannot delete super_admin role",
          protectedRoles: superAdminRoles.map((r) => ({
            id: r._id,
            name: r.name,
            displayName: r.displayName,
            reason: "Super Admin role cannot be deleted",
          })),
        });
      }

      if (deletableRoles.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid roles to delete",
        });
      }

      const deletableRoleIds = deletableRoles.map((r) => r._id);

      // Check if any users are assigned to these roles
      const usersWithRoles = await User.find({
        role: { $in: deletableRoleIds },
      }).populate("role", "displayName");

      if (usersWithRoles.length > 0) {
        const roleUsageMap = {};
        usersWithRoles.forEach((user) => {
          const roleName = user.role.displayName;
          roleUsageMap[roleName] = (roleUsageMap[roleName] || 0) + 1;
        });

        const usageText = Object.entries(roleUsageMap)
          .map(([role, count]) => `${role} (${count} users)`)
          .join(", ");

        return res.status(400).json({
          success: false,
          message: `Cannot delete roles with assigned users: ${usageText}. Please reassign users first.`,
          affectedUsers: usersWithRoles.length,
          roleUsage: roleUsageMap,
        });
      }

      // Perform the bulk deletion
      const result = await Role.deleteMany({ _id: { $in: deletableRoleIds } });

      const deletedRoleNames = deletableRoles
        .map((r) => r.displayName)
        .join(", ");
      console.log(
        `✅ BULK DELETE COMPLETED: ${result.deletedCount} roles deleted by ${req.user.username}`
      );
      console.log(`   Deleted roles: ${deletedRoleNames}`);

      res.status(200).json({
        success: true,
        message: `Successfully deleted ${result.deletedCount} role(s)`,
        deletedCount: result.deletedCount,
        deletedRoles: deletableRoles.map((r) => ({
          id: r._id,
          name: r.name,
          displayName: r.displayName,
        })),
        skippedCount: roleIds.length - result.deletedCount,
      });
    } catch (error) {
      console.error("❌ BULK DELETE ROLES ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error during bulk deletion",
      });
    }
  }
);

// Add these routes to your existing routes/admin.js file
// Place them after your existing user management routes

// Delete user (Super Admin only) - with password verification
adminRouter.delete(
  "/users/:id",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { password } = req.body;

      console.log(`🗑️ DELETING USER: ${id} by ${req.user.username}`);

      // PASSWORD VERIFICATION
      if (!password) {
        console.log("❌ DELETE USER: No password provided");
        return res.status(400).json({
          success: false,
          message: "Admin password verification required",
        });
      }

      // Get the current user with password for verification
      const currentUser = await User.findById(req.user.id);
      if (!currentUser) {
        console.log("❌ DELETE USER: Current user not found");
        return res.status(401).json({
          success: false,
          message: "Current user not found",
        });
      }

      // Verify the provided password matches current user's password
      const isValidPassword = await currentUser.comparePassword(password);
      if (!isValidPassword) {
        console.log("❌ DELETE USER: Invalid password provided");
        return res.status(401).json({
          success: false,
          message: "Invalid admin password",
        });
      }

      console.log("✅ DELETE USER: Password verified successfully");

      // Get user to be deleted
      const userToDelete = await User.findById(id).populate("role");
      if (!userToDelete) {
        console.log(`❌ DELETE USER: User not found - ${id}`);
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Prevent deletion of super admin users
      if (userToDelete.role && userToDelete.role.name === "super_admin") {
        console.log(
          `❌ DELETE USER: Attempted to delete super admin - ${userToDelete.username}`
        );
        return res.status(400).json({
          success: false,
          message: "Cannot delete super admin users",
        });
      }

      // Prevent users from deleting themselves
      if (userToDelete._id.toString() === req.user.id) {
        console.log(
          `❌ DELETE USER: User attempted to delete themselves - ${req.user.username}`
        );
        return res.status(400).json({
          success: false,
          message: "Cannot delete your own account",
        });
      }

      // Store user info for logging before deletion
      const deletedUserInfo = {
        username: userToDelete.username,
        email: userToDelete.email,
        name: userToDelete.name,
        role: userToDelete.role?.displayName || "Unknown",
      };

      // Delete the user
      await User.findByIdAndDelete(id);

      console.log(
        `✅ USER DELETED: ${deletedUserInfo.username} (${deletedUserInfo.role}) by ${req.user.username}`
      );

      res.status(200).json({
        success: true,
        message: `User ${deletedUserInfo.username} deleted successfully`,
        deletedUser: {
          username: deletedUserInfo.username,
          role: deletedUserInfo.role,
        },
      });
    } catch (error) {
      console.error("❌ DELETE USER ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Bulk delete users (Super Admin only) - with password verification
adminRouter.post(
  "/users/bulk-delete",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { userIds, password } = req.body;

      console.log(
        `🗑️ BULK DELETING USERS: ${userIds?.length} users by ${req.user.username}`
      );

      // PASSWORD VERIFICATION
      if (!password) {
        console.log("❌ BULK DELETE USERS: No password provided");
        return res.status(400).json({
          success: false,
          message: "Admin password verification required",
        });
      }

      // Get the current user with password for verification
      const currentUser = await User.findById(req.user.id);
      if (!currentUser) {
        return res.status(401).json({
          success: false,
          message: "Current user not found",
        });
      }

      // Verify the provided password
      const isValidPassword = await currentUser.comparePassword(password);
      if (!isValidPassword) {
        console.log("❌ BULK DELETE USERS: Invalid password provided");
        return res.status(401).json({
          success: false,
          message: "Invalid admin password",
        });
      }

      console.log("✅ BULK DELETE USERS: Password verified successfully");

      // Validate userIds array
      if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "userIds array is required and cannot be empty",
        });
      }

      // Get users to be deleted with role populated
      const usersToDelete = await User.find({ _id: { $in: userIds } }).populate(
        "role"
      );

      if (usersToDelete.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No users found with provided IDs",
        });
      }

      // Filter out super admin users and current user
      const superAdminUsers = usersToDelete.filter(
        (user) => user.role && user.role.name === "super_admin"
      );
      const currentUserInList = usersToDelete.find(
        (user) => user._id.toString() === req.user.id
      );
      const deletableUsers = usersToDelete.filter(
        (user) =>
          user._id.toString() !== req.user.id &&
          (!user.role || user.role.name !== "super_admin")
      );

      let warnings = [];
      if (superAdminUsers.length > 0) {
        warnings.push(
          `${superAdminUsers.length} super admin users cannot be deleted`
        );
      }
      if (currentUserInList) {
        warnings.push("Cannot delete your own account");
      }

      if (deletableUsers.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No valid users to delete",
          warnings,
          protectedUsers: [
            ...superAdminUsers.map((u) => ({
              id: u._id,
              username: u.username,
              reason: "Super admin user",
            })),
            ...(currentUserInList
              ? [
                  {
                    id: currentUserInList._id,
                    username: currentUserInList.username,
                    reason: "Cannot delete own account",
                  },
                ]
              : []),
          ],
        });
      }

      const deletableUserIds = deletableUsers.map((u) => u._id);

      // Store user info for logging before deletion
      const deletedUserInfo = deletableUsers.map((user) => ({
        username: user.username,
        email: user.email,
        role: user.role?.displayName || "Unknown",
      }));

      // Perform the bulk deletion
      const result = await User.deleteMany({ _id: { $in: deletableUserIds } });

      console.log(
        `✅ BULK DELETE USERS COMPLETED: ${result.deletedCount} users deleted by ${req.user.username}`
      );
      console.log(
        `   Deleted users: ${deletedUserInfo.map((u) => u.username).join(", ")}`
      );

      res.status(200).json({
        success: true,
        message: `Successfully deleted ${result.deletedCount} user(s)`,
        deletedCount: result.deletedCount,
        deletedUsers: deletedUserInfo,
        skippedCount: userIds.length - result.deletedCount,
        warnings: warnings.length > 0 ? warnings : undefined,
      });
    } catch (error) {
      console.error("❌ BULK DELETE USERS ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error during bulk deletion",
      });
    }
  }
);
// Reset all custom roles (with password verification) - SIMPLIFIED
adminRouter.post(
  "/roles/reset",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { password } = req.body;

      console.log(
        `🔄 RESETTING ALL NON-SUPER_ADMIN ROLES by ${req.user.username}`
      );

      // PASSWORD VERIFICATION
      if (!password) {
        console.log("❌ RESET ROLES: No password provided");
        return res.status(400).json({
          success: false,
          message: "Admin password verification required",
        });
      }

      // Get the current user with password for verification
      const currentUser = await User.findById(req.user.id);
      if (!currentUser) {
        return res.status(401).json({
          success: false,
          message: "Current user not found",
        });
      }

      // Verify the provided password
      const isValidPassword = await currentUser.comparePassword(password);
      if (!isValidPassword) {
        console.log("❌ RESET ROLES: Invalid password provided");
        return res.status(401).json({
          success: false,
          message: "Invalid admin password",
        });
      }

      console.log("✅ RESET ROLES: Password verified successfully");

      // Find all non-super_admin roles
      const rolesToDelete = await Role.find({
        name: { $ne: "super_admin" }, // Delete everything except super_admin
      });

      if (rolesToDelete.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No roles to delete (only super_admin exists)",
          deletedCount: 0,
        });
      }

      const roleIdsToDelete = rolesToDelete.map((role) => role._id);

      // Check if any users are assigned to these roles
      const usersWithRoles = await User.find({
        role: { $in: roleIdsToDelete },
      }).populate("role", "displayName");

      if (usersWithRoles.length > 0) {
        const roleUsageMap = {};
        usersWithRoles.forEach((user) => {
          const roleName = user.role.displayName;
          roleUsageMap[roleName] = (roleUsageMap[roleName] || 0) + 1;
        });

        return res.status(400).json({
          success: false,
          message:
            "Cannot reset roles while users are assigned to non-super_admin roles",
          affectedUsers: usersWithRoles.length,
          roleUsage: roleUsageMap,
          suggestion:
            "Please reassign all users to super_admin role before resetting",
        });
      }

      // Delete all non-super_admin roles
      const result = await Role.deleteMany({
        name: { $ne: "super_admin" },
      });

      console.log(
        `✅ ROLE RESET COMPLETED: ${result.deletedCount} roles deleted`
      );

      res.status(200).json({
        success: true,
        message: `Role system reset successfully. Deleted ${result.deletedCount} roles. Super admin role preserved.`,
        deletedCount: result.deletedCount,
        preservedRoles: 1, // Only super_admin preserved
      });
    } catch (error) {
      console.error("❌ RESET ROLES ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Force reset all roles (reassigns users automatically) - with password verification
adminRouter.post(
  "/roles/force-reset",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { password } = req.body;

      console.log(
        `⚠️ FORCE RESETTING ALL NON-SUPER_ADMIN ROLES by ${req.user.username}`
      );

      // PASSWORD VERIFICATION
      if (!password) {
        return res.status(400).json({
          success: false,
          message: "Admin password verification required",
        });
      }

      const currentUser = await User.findById(req.user.id);
      if (!currentUser) {
        return res.status(401).json({
          success: false,
          message: "Current user not found",
        });
      }

      const isValidPassword = await currentUser.comparePassword(password);
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          message: "Invalid admin password",
        });
      }

      // Find super_admin role to reassign users to
      const superAdminRole = await Role.findOne({ name: "super_admin" });
      if (!superAdminRole) {
        return res.status(500).json({
          success: false,
          message:
            "Super admin role not found. Cannot proceed with force reset.",
        });
      }

      // Find all non-super_admin roles
      const rolesToDelete = await Role.find({ name: { $ne: "super_admin" } });
      const roleIdsToDelete = rolesToDelete.map((role) => role._id);

      // Reassign all users with non-super_admin roles to super_admin role
      const usersReassigned = await User.updateMany(
        { role: { $in: roleIdsToDelete } },
        { role: superAdminRole._id }
      );

      // Delete all non-super_admin roles
      const rolesDeleted = await Role.deleteMany({
        name: { $ne: "super_admin" },
      });

      console.log(
        `✅ FORCE RESET COMPLETED: ${rolesDeleted.deletedCount} roles deleted, ${usersReassigned.modifiedCount} users reassigned`
      );

      res.status(200).json({
        success: true,
        message: `Force reset completed. Deleted ${rolesDeleted.deletedCount} roles and reassigned ${usersReassigned.modifiedCount} users to Super Admin.`,
        deletedRoles: rolesDeleted.deletedCount,
        reassignedUsers: usersReassigned.modifiedCount,
        defaultRole: superAdminRole.displayName,
      });
    } catch (error) {
      console.error("❌ FORCE RESET ROLES ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Get users by role
adminRouter.get(
  "/roles/:id/users",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;

      console.log(`👥 FETCHING USERS BY ROLE: ${id} by ${req.user.username}`);

      const role = await Role.findById(id);
      if (!role) {
        return res.status(404).json({
          success: false,
          message: "Role not found",
        });
      }

      const users = await User.find({ role: id })
        .select("-password -otpSecret")
        .populate("role", "name displayName components categories")
        .sort({ username: 1 });

      console.log(
        `✅ USERS BY ROLE FETCHED: ${users.length} users with role ${role.displayName}`
      );

      res.status(200).json({
        success: true,
        role: {
          id: role._id,
          name: role.name,
          displayName: role.displayName,
          components: role.components,
          categories: role.categories,
        },
        users,
      });
    } catch (error) {
      console.error("❌ GET USERS BY ROLE ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// ============================================================================
// COMPONENT MANAGEMENT ROUTES
// ============================================================================

// Get all available components
adminRouter.get(
  "/components",
  authenticateToken,
  requireSuperAdmin,
  async (req, res) => {
    try {
      console.log(`🧩 FETCHING COMPONENTS: Request by ${req.user.username}`);

      // This is the component structure from your frontend
      const componentCategories = {
        operations: {
          title: "Operations Management",
          components: [
            {
              id: "1",
              number: "1.",
              name: "Orders to cart not ordered yet",
              path: "/ordersINcart",
            },
            {
              id: "2",
              number: "2.",
              name: "Transaction control... paid / or not",
              path: "/Transactions-control",
            },
            { id: "3", number: "3.", name: "All Orders", path: "/all-orders" },
            {
              id: "4",
              number: "4.",
              name: "Order management delivery",
              path: "/delivery-orders",
            },
            { id: "5", number: "5.", name: "Delivery", path: "/Delivery" },
            {
              id: "6",
              number: "6.",
              name: "Non-delivered orders or issues",
              path: "/non-delivered-orders",
            },
            {
              id: "7",
              number: "7.",
              name: "Refund / complain",
              path: "/view-refunds",
            },
            {
              id: "8",
              number: "8.",
              name: "History orders",
              path: "/all-orders",
            },
          ],
        },
        inventory: {
          title: "Stock & Inventory",
          components: [
            {
              id: "28",
              number: "31.",
              name: "Product list everyone",
              path: "/admin/Products",
            },
            {
              id: "33",
              number: "33.",
              name: "Inventory check",
              path: "/inventory-check",
            },
            {
              id: "35",
              number: "35.",
              name: "Out of Stock...order stock",
              path: "/out-of-stock",
            },
            {
              id: "36",
              number: "36.",
              name: "Sales data for products",
              path: "/sales-data",
            },
            {
              id: "37",
              number: "37.",
              name: "Lost Stock Management",
              path: "/lost-stock",
            },
          ],
        },
        stock2: {
          title: "Stock Management 2",
          components: [
            {
              id: "61",
              number: "51.",
              name: "Create a new product",
              path: "/add-product",
            },
            {
              id: "54",
              number: "54.",
              name: "Fill inventory",
              path: "/Fill-inventory",
            },
            {
              id: "55",
              number: "55.",
              name: "Inventory control",
              path: "/inventory-control",
            },
            {
              id: "56",
              number: "56.",
              name: "Categories",
              path: "/add-category",
            },
          ],
        },
        discount: {
          title: "Discount Management",
          components: [
            {
              id: "71",
              number: "71.",
              name: "Create discount",
              path: "/create-discount",
            },
            {
              id: "72",
              number: "72.",
              name: "All Discount list",
              path: "/all-discounts",
            },
            {
              id: "73",
              number: "73.",
              name: "Discounted product inventory",
              path: "/discount-inventory",
            },
            {
              id: "74",
              number: "74.",
              name: "Discount policies action",
              path: "/discount-policies",
            },
          ],
        },
        suppliers: {
          title: "Suppliers, Employees & Customers",
          components: [
            {
              id: "81",
              number: "81.",
              name: "Suppliers",
              path: "/view-suppliers",
            },
            {
              id: "82",
              number: "82.",
              name: "employees",
              path: "/all-employees",
            },
            { id: "83", number: "83.", name: "Customers", path: "/customers" },
          ],
        },
        history: {
          title: "History",
          components: [
            {
              id: "90",
              number: "90.",
              name: "History orders supplier",
              path: "/supplier-history",
            },
          ],
        },
        finance: {
          title: "Finance & Analytics",
          components: [
            { id: "101", number: "101.", name: "Finances", path: "/finances" },
            {
              id: "105",
              number: "105.",
              name: "ANALYTICS",
              path: "/analytics",
            },
          ],
        },
        admin: {
          title: "Lower Admin",
          components: [
            {
              id: "admin-lower",
              number: "1.",
              name: "lower admin",
              path: "/admin/lower",
            },
            {
              id: "admin-drivers",
              number: "2.",
              name: "truck drivers",
              path: "/admin/drivers",
            },
            {
              id: "admin-employee-add",
              number: "3a.",
              name: "employee - add",
              path: "/admin/employee/add",
            },
            {
              id: "admin-employee-edit",
              number: "3b.",
              name: "employee - edit",
              path: "/admin/employee/edit",
            },
            {
              id: "admin-supplier-add",
              number: "4a.",
              name: "supplier - add",
              path: "/admin/supplier/add",
            },
            {
              id: "admin-supplier-edit",
              number: "4b.",
              name: "supplier - edit",
              path: "/admin/supplier/edit",
            },
            {
              id: "admin-customer-edit",
              number: "5a.",
              name: "customer - edit",
              path: "/admin/customer/edit",
            },
            {
              id: "admin-products",
              number: "6.",
              name: "Products",
              path: "/admin/Products",
            },
          ],
        },
        referrals: {
          title: "Referrals",
          components: [
            {
              id: "150",
              number: "150.",
              name: "Referrals video verification",
              path: "/referrals",
            },
            {
              id: "151",
              number: "151.",
              name: "Referrals data",
              path: "/referrals-data",
            },
            {
              id: "155",
              number: "155.",
              name: "Referrals foreman income",
              path: "/referals-foreman",
            },
          ],
        },
        foreman: {
          title: "Foreman",
          components: [
            {
              id: "160",
              number: "160.",
              name: "from human earning structure",
              path: "/foreman-earnings",
            },
          ],
        },
        settings: {
          title: "Settings & Support",
          components: [
            { id: "calendar", number: "", name: "Calendar", path: "/calendar" },
            { id: "support", number: "", name: "Support", path: "/support" },
          ],
        },
      };

      console.log(`✅ COMPONENTS FETCHED: All available components returned`);

      res.status(200).json({
        success: true,
        components: componentCategories,
      });
    } catch (error) {
      console.error("❌ GET COMPONENTS ERROR:", error);
      res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

// Get user profile
adminRouter.get("/profile", authenticateToken, async (req, res) => {
  try {
    console.log(`👤 PROFILE REQUEST: ${req.user.username}`);

    const user = await User.findById(req.user.id)
      .select("-password -otpSecret")
      .populate("role", "name displayName components categories");

    if (!user) {
      console.log(`❌ PROFILE: User not found - ${req.user.id}`);
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    console.log(`✅ PROFILE RETURNED: ${user.username}`);
    console.log(`   Role: ${user.role?.displayName || "No role"}`);
    console.log(
      `   Components: [${user.role?.components?.join(", ") || "none"}]`
    );
    console.log(
      `   Categories: [${user.role?.categories?.join(", ") || "none"}]`
    );

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("❌ GET PROFILE ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = { adminRouter };
