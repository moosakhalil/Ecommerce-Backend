const express = require("express");
const router = express.Router();
const Video = require("../models/video");
const mongoose = require("mongoose");

const multer = require("multer");
const upload = multer({
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB limit for UltraMSG
  },
});

// ===== 159A - REFERRAL VIDEOS =====

// POST - Upload referral video (159A)
router.post("/referral", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file uploaded" });
    }

    const file = req.file;
    const base64Data = file.buffer.toString("base64");

    const video = new Video({
      title: file.originalname,
      mimetype: file.mimetype,
      filename: file.originalname,
      fileSize: file.size,
      base64Data: base64Data,
      videoType: "referral", // 159A
      isActive: false,
      isCurrentlyActive: false,
    });

    const savedVideo = await video.save();
    res.status(201).json(savedVideo);
  } catch (err) {
    console.error("Referral video upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET - Get all referral videos (159A)
router.get("/referral", async (req, res) => {
  try {
    const videos = await Video.getReferralVideos();
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH - Update referral video title (159A)
router.patch("/referral/:id", async (req, res) => {
  try {
    const { title } = req.body;
    const video = await Video.findOneAndUpdate(
      { _id: req.params.id, videoType: "referral" },
      { title },
      { new: true }
    );

    if (!video) {
      return res.status(404).json({ error: "Referral video not found" });
    }

    res.json(video);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH - Activate referral video (159A)
router.patch("/referral/:id/activate", async (req, res) => {
  try {
    const { startDate, endDate, isIndefinite } = req.body;

    const video = await Video.findOne({
      _id: req.params.id,
      videoType: "referral",
    });

    if (!video) {
      return res.status(404).json({ error: "Referral video not found" });
    }

    const activatedVideo = await video.activate({
      startDate,
      endDate,
      isIndefinite,
    });

    res.json(activatedVideo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH - Deactivate referral video (159A)
router.patch("/referral/:id/deactivate", async (req, res) => {
  try {
    const video = await Video.findOne({
      _id: req.params.id,
      videoType: "referral",
    });

    if (!video) {
      return res.status(404).json({ error: "Referral video not found" });
    }

    const deactivatedVideo = await video.deactivate();
    res.json(deactivatedVideo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH - Update referral video textbox (159A)
router.patch("/referral/:id/textbox", async (req, res) => {
  try {
    console.log("🎬 Updating referral textbox for video ID:", req.params.id);
    console.log("🎬 Request body:", req.body);

    const { content, isActive } = req.body;

    const video = await Video.findOne({
      _id: req.params.id,
      videoType: "referral",
    });

    if (!video) {
      console.log("❌ Referral video not found");
      return res.status(404).json({ error: "Referral video not found" });
    }

    console.log("✅ Video found:", video.title);
    console.log("🔄 Updating textbox content...");

    // Update textbox directly on the document
    video.textBox = {
      content: content || "",
      isActive: isActive || false,
    };

    const updatedVideo = await video.save();

    console.log("✅ Video textbox updated successfully");
    console.log("📝 New textbox content:", updatedVideo.textBox);

    res.json(updatedVideo);
  } catch (err) {
    console.error("❌ Error updating referral video textbox:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE - Delete referral video (159A)
router.delete("/referral/:id", async (req, res) => {
  try {
    const video = await Video.findOneAndDelete({
      _id: req.params.id,
      videoType: "referral",
    });

    if (!video) {
      return res.status(404).json({ error: "Referral video not found" });
    }

    res.json({ success: true, message: "Referral video deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 159B - INTRODUCTION VIDEOS =====

// POST - Upload introduction video (159B)
router.post("/introduction", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file uploaded" });
    }

    const { introductionCategory = "company_introduction" } = req.body;
    const file = req.file;
    const base64Data = file.buffer.toString("base64");

    const video = new Video({
      title: file.originalname,
      mimetype: file.mimetype,
      filename: file.originalname,
      fileSize: file.size,
      base64Data: base64Data,
      videoType: "introduction", // 159B
      introductionCategory: introductionCategory,
      isActive: false,
      isCurrentlyActive: false,
    });

    const savedVideo = await video.save();
    res.status(201).json(savedVideo);
  } catch (err) {
    console.error("Introduction video upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET - Get all introduction videos (159B)
router.get("/introduction", async (req, res) => {
  try {
    const videos = await Video.getIntroductionVideos();
    res.json(videos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH - Update introduction video title (159B)
router.patch("/introduction/:id", async (req, res) => {
  try {
    const { title } = req.body;
    const video = await Video.findOneAndUpdate(
      { _id: req.params.id, videoType: "introduction" },
      { title },
      { new: true }
    );

    if (!video) {
      return res.status(404).json({ error: "Introduction video not found" });
    }

    res.json(video);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH - Activate introduction video (159B)
router.patch("/introduction/:id/activate", async (req, res) => {
  try {
    const { startDate, endDate, isIndefinite } = req.body;

    const video = await Video.findOne({
      _id: req.params.id,
      videoType: "introduction",
    });

    if (!video) {
      return res.status(404).json({ error: "Introduction video not found" });
    }

    const activatedVideo = await video.activate({
      startDate,
      endDate,
      isIndefinite,
    });

    res.json(activatedVideo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH - Deactivate introduction video (159B)
router.patch("/introduction/:id/deactivate", async (req, res) => {
  try {
    const video = await Video.findOne({
      _id: req.params.id,
      videoType: "introduction",
    });

    if (!video) {
      return res.status(404).json({ error: "Introduction video not found" });
    }

    const deactivatedVideo = await video.deactivate();
    res.json(deactivatedVideo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH - Update introduction video textbox (159B)
router.patch("/introduction/:id/textbox", async (req, res) => {
  try {
    console.log("🎬 Updating textbox for video ID:", req.params.id);
    console.log("🎬 Request body:", req.body);

    const { content, isActive } = req.body;

    const video = await Video.findOne({
      _id: req.params.id,
      videoType: "introduction",
    });

    if (!video) {
      console.log("❌ Introduction video not found");
      return res.status(404).json({ error: "Introduction video not found" });
    }

    console.log("✅ Video found:", video.title);
    console.log("🔄 Updating textbox content...");

    // Update textbox directly on the document
    video.textBox = {
      content: content || "",
      isActive: isActive || false,
    };

    const updatedVideo = await video.save();

    console.log("✅ Video textbox updated successfully");
    console.log("📝 New textbox content:", updatedVideo.textBox);

    res.json(updatedVideo);
  } catch (err) {
    console.error("❌ Error updating introduction video textbox:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE - Delete introduction video (159B)
router.delete("/introduction/:id", async (req, res) => {
  try {
    const video = await Video.findOneAndDelete({
      _id: req.params.id,
      videoType: "introduction",
    });

    if (!video) {
      return res.status(404).json({ error: "Introduction video not found" });
    }

    res.json({
      success: true,
      message: "Introduction video deleted successfully",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== UTILITY ROUTES =====

// GET - Get currently active videos
router.get("/active", async (req, res) => {
  try {
    const activeReferralVideo = await Video.getCurrentlyActiveReferralVideo();
    const activeIntroductionVideo =
      await Video.getCurrentlyActiveIntroductionVideo();

    res.json({
      referralVideo: activeReferralVideo,
      introductionVideo: activeIntroductionVideo,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET - Get currently active referral video (159A)
router.get("/active/referral", async (req, res) => {
  try {
    const activeVideo = await Video.getCurrentlyActiveReferralVideo();
    res.json(activeVideo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET - Get currently active introduction video (159B)
router.get("/active/introduction", async (req, res) => {
  try {
    const activeVideo = await Video.getCurrentlyActiveIntroductionVideo();
    res.json(activeVideo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET - Get video statistics
router.get("/stats", async (req, res) => {
  try {
    const stats = await Video.getAllVideoStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET - Get referral video statistics (159A)
router.get("/stats/referral", async (req, res) => {
  try {
    const stats = await Video.getVideoStatsByType("referral");
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET - Get introduction video statistics (159B)
router.get("/stats/introduction", async (req, res) => {
  try {
    const stats = await Video.getVideoStatsByType("introduction");
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - Update video statuses (utility endpoint for cron jobs)
router.post("/update-statuses", async (req, res) => {
  try {
    const expiredCount = await Video.checkExpiredVideos();
    await Video.updateCurrentlyActiveStatus();

    res.json({
      success: true,
      expiredCount,
      message: `Updated video statuses. Deactivated ${expiredCount} expired videos.`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - Record video sent (for tracking)
router.post("/record-sent/:id", async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);

    if (!video) {
      return res.status(404).json({ error: "Video not found" });
    }

    await video.recordSent();
    res.json({ success: true, message: "Video send recorded" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
