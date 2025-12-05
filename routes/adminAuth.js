// routes/adminAuth.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// Environment variables should be set in a .env file
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";

// Admin login route
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // For the predefined admin credentials
    if (username === "admin12" && password === "admin12") {
      // Generate token
      const token = jwt.sign({ username, role: "admin" }, JWT_SECRET, {
        expiresIn: "1h",
      });

      return res.status(200).json({
        success: true,
        message: "Login successful",
        token,
      });
    }

    // If you want to check against database instead of hardcoded credentials
    // Uncomment below:
    /*
    const admin = await Admin.findOne({ username });
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    const token = jwt.sign(
      { id: admin._id, username: admin.username, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
    */

    return res.status(401).json({
      success: false,
      message: "Invalid credentials",
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

// Middleware to protect admin routes
const authenticateAdmin = (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;

    // Ensure it's an admin role
    if (decoded.role !== "admin") {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }
};

// Protected route example
router.get("/dashboard", authenticateAdmin, (req, res) => {
  res.status(200).json({
    success: true,
    message: "Admin access granted",
    admin: req.admin,
  });
});

module.exports = { router, authenticateAdmin };
