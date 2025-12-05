// server/routes/categoryRoutes.js
const express = require("express");
const router = express.Router();
const Category = require("../models/Category");

// GET all
router.get("/", async (req, res) => {
  try {
    const cats = await Category.find().sort({ name: 1 });
    res.json({ success: true, data: cats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST new
router.post("/", async (req, res) => {
  try {
    const { name, subcategories } = req.body;
    const exists = await Category.findOne({ name });
    if (exists) {
      return res
        .status(400)
        .json({ success: false, message: "Category exists" });
    }
    const cat = await Category.create({ name, subcategories });
    res.status(201).json({ success: true, data: cat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE an entire category
router.delete("/:id", async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: "Category removed" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH to update subcategories array (for removals or edits)
router.patch("/:id", async (req, res) => {
  try {
    const { subcategories } = req.body;
    const updated = await Category.findByIdAndUpdate(
      req.params.id,
      { subcategories },
      { new: true }
    );
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
