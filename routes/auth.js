// routes/auth.js - UPDATED FOR PROPER COMPONENT ACCESS
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const rateLimit = require("express-rate-limit");
const { User } = require("../models/User");
const { Role } = require("../models/Role");

// Use global JWT secrets from server.js
const JWT_SECRET =
  global.JWT_SECRET || "admin-dashboard-super-secret-jwt-key-2025-secure";
const JWT_REFRESH_SECRET =
  global.JWT_REFRESH_SECRET || "admin-dashboard-refresh-token-secret-2025";

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
});

// Generate fresh tokens with encrypted logging - ENHANCED FOR COMPONENT ACCESS
const generateTokens = (user) => {
  // Ensure role is properly populated
  const roleData = user.role || {};
  const roleName = roleData.name || user.role;
  const roleDisplayName = roleData.displayName || roleData.name || user.role;
  const roleComponents = roleData.components || [];
  const roleCategories = roleData.categories || [];

  const payload = {
    id: user._id,
    username: user.username,
    email: user.email,
    role: roleName, // Keep simple role name for backward compatibility
    roleName: roleName,
    roleDisplayName: roleDisplayName,
    roleId: roleData._id,
    permissions: user.permissions || [],
    components: roleComponents, // USER'S ACCESSIBLE COMPONENTS
    categories: roleCategories, // USER'S ACCESSIBLE CATEGORIES
    generatedAt: new Date().toISOString(),
  };

  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
  const refreshToken = jwt.sign(
    {
      id: user._id,
      generatedAt: new Date().toISOString(),
    },
    JWT_REFRESH_SECRET,
    {
      expiresIn: "7d",
    }
  );

  // Enhanced logging for component access debugging
  const maskedAccessToken = `${accessToken.substring(
    0,
    10
  )}...${accessToken.substring(accessToken.length - 10)}`;
  const maskedRefreshToken = `${refreshToken.substring(
    0,
    10
  )}...${refreshToken.substring(refreshToken.length - 10)}`;

  console.log("🔐 FRESH TOKENS GENERATED WITH COMPONENT ACCESS:");
  console.log(`   User: ${user.username} (${roleDisplayName})`);
  console.log(`   Role ID: ${roleData._id}`);
  console.log(`   Components: [${roleComponents.join(", ") || "none"}]`);
  console.log(`   Categories: [${roleCategories.join(", ") || "none"}]`);
  console.log(`   Access Token: ${maskedAccessToken}`);
  console.log(`   Refresh Token: ${maskedRefreshToken}`);
  console.log(`   Generated At: ${new Date().toISOString()}`);
  console.log("=" * 60);

  return { accessToken, refreshToken };
};

// Login route - ENHANCED FOR COMPONENT ACCESS
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { username, password, totpCode } = req.body;

    console.log("🚀 LOGIN ATTEMPT:");
    console.log(`   Username: ${username}`);
    console.log(`   Time: ${new Date().toISOString()}`);

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    // Find user with FULLY POPULATED ROLE including components and categories
    const user = await User.findOne({
      $or: [{ username }, { email: username }],
      status: "active",
    }).populate({
      path: "role",
      select: "name displayName components categories isActive priority",
    });

    if (!user) {
      console.log("❌ LOGIN FAILED: User not found");
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (!user.role) {
      console.log("❌ LOGIN FAILED: User has no role assigned");
      return res.status(401).json({
        success: false,
        message: "Account not properly configured. Contact administrator.",
      });
    }

    if (!user.role.isActive) {
      console.log("❌ LOGIN FAILED: User role is inactive");
      return res.status(401).json({
        success: false,
        message: "Account role is disabled. Contact administrator.",
      });
    }

    // Check password
    const isValidPassword = await user.comparePassword(password);
    if (!isValidPassword) {
      console.log("❌ LOGIN FAILED: Invalid password");
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Check 2FA if enabled
    if (user.twoFactorEnabled) {
      if (!totpCode) {
        console.log("🔐 2FA REQUIRED for user:", user.username);
        return res.status(200).json({
          success: false,
          requireTwoFactor: true,
          message: "Two-factor authentication code required",
        });
      }

      const verified = speakeasy.totp.verify({
        secret: user.otpSecret,
        encoding: "base32",
        token: totpCode,
        window: 2,
      });

      if (!verified) {
        console.log("❌ 2FA FAILED for user:", user.username);
        return res.status(401).json({
          success: false,
          message: "Invalid two-factor authentication code",
        });
      }
      console.log("✅ 2FA VERIFIED for user:", user.username);
    }

    // Update last login
    await user.updateLastLogin();

    // 🔥 GENERATE FRESH TOKENS WITH COMPONENT ACCESS
    const { accessToken, refreshToken } = generateTokens(user);

    console.log("✅ LOGIN SUCCESSFUL WITH COMPONENT ACCESS:");
    console.log(`   User: ${user.username}`);
    console.log(`   Role: ${user.role.displayName}`);
    console.log(
      `   Components: [${user.role.components?.join(", ") || "none"}]`
    );
    console.log(
      `   Categories: [${user.role.categories?.join(", ") || "none"}]`
    );
    console.log(`   Fresh tokens generated and ready to send`);

    res.status(200).json({
      success: true,
      message:
        "Login successful - Fresh tokens generated with component access",
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role.name,
        roleDisplayName: user.role.displayName,
        roleId: user.role._id,
        permissions: user.permissions || [],
        components: user.role.components || [], // ACCESSIBLE COMPONENTS
        categories: user.role.categories || [], // ACCESSIBLE CATEGORIES
        lastLogin: user.lastLogin,
      },
      accessToken,
      refreshToken,
      tokenInfo: {
        accessTokenExpiry: "1 hour",
        refreshTokenExpiry: "7 days",
        generatedAt: new Date().toISOString(),
        componentsIncluded: (user.role.components || []).length,
        categoriesIncluded: (user.role.categories || []).length,
      },
    });
  } catch (error) {
    console.error("❌ LOGIN ERROR:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Refresh token route - ENHANCED FOR COMPONENT ACCESS
router.post("/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;

    console.log("🔄 TOKEN REFRESH REQUEST:");
    console.log(`   Time: ${new Date().toISOString()}`);

    if (!refreshToken) {
      console.log("❌ REFRESH FAILED: No refresh token provided");
      return res.status(401).json({
        success: false,
        message: "Refresh token required",
      });
    }

    const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET);

    // Find user with FULLY POPULATED ROLE for fresh component access
    const user = await User.findById(decoded.id).populate({
      path: "role",
      select: "name displayName components categories isActive priority",
    });

    if (
      !user ||
      user.status !== "active" ||
      !user.role ||
      !user.role.isActive
    ) {
      console.log("❌ REFRESH FAILED: Invalid user or inactive status");
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    // 🔥 GENERATE FRESH TOKENS WITH UPDATED COMPONENT ACCESS
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    console.log("✅ TOKEN REFRESH SUCCESSFUL WITH COMPONENT ACCESS:");
    console.log(`   User: ${user.username}`);
    console.log(`   Role: ${user.role.displayName}`);
    console.log(
      `   Components: [${user.role.components?.join(", ") || "none"}]`
    );
    console.log(
      `   Categories: [${user.role.categories?.join(", ") || "none"}]`
    );
    console.log(`   Fresh tokens generated with latest role data`);

    res.status(200).json({
      success: true,
      message: "Fresh tokens generated with updated component access",
      accessToken,
      refreshToken: newRefreshToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role.name,
        roleDisplayName: user.role.displayName,
        roleId: user.role._id,
        permissions: user.permissions || [],
        components: user.role.components || [], // LATEST ACCESSIBLE COMPONENTS
        categories: user.role.categories || [], // LATEST ACCESSIBLE CATEGORIES
      },
      tokenInfo: {
        accessTokenExpiry: "1 hour",
        refreshTokenExpiry: "7 days",
        generatedAt: new Date().toISOString(),
        componentsIncluded: (user.role.components || []).length,
        categoriesIncluded: (user.role.categories || []).length,
      },
    });
  } catch (error) {
    console.error("❌ REFRESH ERROR:", error);
    res.status(401).json({
      success: false,
      message: "Invalid refresh token",
    });
  }
});

// Setup 2FA
router.post("/setup-2fa", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (user.twoFactorEnabled) {
      return res.status(400).json({
        success: false,
        message: "Two-factor authentication is already enabled",
      });
    }

    const secret = speakeasy.generateSecret({
      name: `Admin Dashboard (${user.username})`,
      issuer: "Company Admin",
    });

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    // Temporarily store secret (should be confirmed before saving)
    user.otpSecret = secret.base32;
    await user.save();

    res.status(200).json({
      success: true,
      secret: secret.base32,
      qrCode: qrCodeUrl,
      manualEntryKey: secret.base32,
    });
  } catch (error) {
    console.error("2FA setup error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Verify and enable 2FA
router.post("/verify-2fa", authenticateToken, async (req, res) => {
  try {
    const { totpCode } = req.body;
    const user = await User.findById(req.user.id);

    if (!user.otpSecret) {
      return res.status(400).json({
        success: false,
        message: "Two-factor authentication not set up",
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.otpSecret,
      encoding: "base32",
      token: totpCode,
      window: 2,
    });

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code",
      });
    }

    user.twoFactorEnabled = true;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Two-factor authentication enabled successfully",
    });
  } catch (error) {
    console.error("2FA verification error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Middleware to authenticate token - ENHANCED FOR COMPONENT ACCESS
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Access token required",
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log("🔒 TOKEN VERIFICATION FAILED:", err.message);
      return res.status(403).json({
        success: false,
        message: "Invalid or expired token",
      });
    }

    // Enhanced logging for component access debugging
    console.log("🔓 TOKEN VERIFIED WITH COMPONENT ACCESS:");
    console.log(`   User: ${user.username} (${user.roleDisplayName})`);
    console.log(`   Components: [${user.components?.join(", ") || "none"}]`);
    console.log(`   Categories: [${user.categories?.join(", ") || "none"}]`);

    req.user = user;
    next();
  });
}

// Middleware to check role permissions (updated to work with dynamic roles)
function requireRole(...roleNames) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!roleNames.includes(req.user.roleName || req.user.role)) {
      console.log(
        `🚫 ROLE ACCESS DENIED: User ${req.user.username} (${
          req.user.roleName
        }) not in [${roleNames.join(", ")}]`
      );
      return res.status(403).json({
        success: false,
        message: "Insufficient permissions",
      });
    }

    console.log(
      `✅ ROLE ACCESS GRANTED: User ${req.user.username} has role ${req.user.roleName}`
    );
    next();
  };
}

// Middleware to check component access - CRITICAL FOR CUSTOM ROLES
function requireComponent(componentId) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Super admin has access to everything
    if (req.user.roleName === "super_admin") {
      console.log(
        `✅ COMPONENT ACCESS GRANTED: Super admin ${req.user.username} accessing component ${componentId}`
      );
      return next();
    }

    // Check if user's role has access to this component
    if (!req.user.components || !req.user.components.includes(componentId)) {
      console.log(
        `🚫 COMPONENT ACCESS DENIED: User ${req.user.username} cannot access component ${componentId}`
      );
      console.log(
        `   User components: [${req.user.components?.join(", ") || "none"}]`
      );
      return res.status(403).json({
        success: false,
        message: "Component access denied",
        requestedComponent: componentId,
        userComponents: req.user.components || [],
      });
    }

    console.log(
      `✅ COMPONENT ACCESS GRANTED: User ${req.user.username} accessing component ${componentId}`
    );
    next();
  };
}

// Middleware to check category access - FOR CATEGORY-BASED PERMISSIONS
function requireCategory(categoryKey) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Super admin has access to everything
    if (req.user.roleName === "super_admin") {
      console.log(
        `✅ CATEGORY ACCESS GRANTED: Super admin ${req.user.username} accessing category ${categoryKey}`
      );
      return next();
    }

    // Check if user's role has access to this category
    if (!req.user.categories || !req.user.categories.includes(categoryKey)) {
      console.log(
        `🚫 CATEGORY ACCESS DENIED: User ${req.user.username} cannot access category ${categoryKey}`
      );
      console.log(
        `   User categories: [${req.user.categories?.join(", ") || "none"}]`
      );
      return res.status(403).json({
        success: false,
        message: "Category access denied",
        requestedCategory: categoryKey,
        userCategories: req.user.categories || [],
      });
    }

    console.log(
      `✅ CATEGORY ACCESS GRANTED: User ${req.user.username} accessing category ${categoryKey}`
    );
    next();
  };
}

module.exports = {
  router,
  authenticateToken,
  requireRole,
  requireComponent,
  requireCategory,
};
