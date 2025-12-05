const mongoose = require("mongoose");

const videoSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: "Uploaded Video",
    },
    description: String,
    mimetype: String,
    filename: String,
    fileSize: Number, // in bytes
    base64Data: String, // base64 encoded video
    isActive: {
      type: Boolean,
      default: false,
    },
    uploadDate: {
      type: Date,
      default: Date.now,
    },
    thumbnail: String, // base64 encoded thumbnail (optional)

    // Video type for 159A and 159B
    videoType: {
      type: String,
      enum: ["referral", "introduction"], // referral = 159A, introduction = 159B
      required: true,
    },

    // Current activity status (computed based on schedule)
    isCurrentlyActive: {
      type: Boolean,
      default: false,
    },

    // Enhanced functionality fields
    activeSchedule: {
      startDate: {
        type: Date,
        default: null,
      },
      endDate: {
        type: Date,
        default: null, // null means indefinite
      },
      isIndefinite: {
        type: Boolean,
        default: true,
      },
    },

    textBox: {
      content: {
        type: String,
        default: "",
      },
      isActive: {
        type: Boolean,
        default: false,
      },
    },

    // Additional metadata
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "active"],
      default: "pending",
    },

    // UltraMsg compatibility
    ultraMsgCompatible: {
      type: Boolean,
      default: true,
    },

    // Usage tracking
    sentCount: {
      type: Number,
      default: 0,
    },

    lastSentDate: {
      type: Date,
      default: null,
    },

    // Video category for 159B (Introduction videos)
    introductionCategory: {
      type: String,
      enum: [
        "company_introduction",
        "referral_acknowledgment",
        "welcome_message",
      ],
      default: null, // Only used for introduction videos
    },
  },
  { timestamps: true }
);

// Check if video should be active based on schedule
videoSchema.methods.checkCurrentlyActive = function () {
  if (!this.isActive) return false;

  const now = new Date();
  const { startDate, endDate, isIndefinite } = this.activeSchedule;

  // If no start date set, consider it active immediately
  if (!startDate) return true;

  // Check if current time is after start date
  if (now < startDate) return false;

  // If indefinite or no end date, it's active
  if (isIndefinite || !endDate) return true;

  // Check if current time is before end date
  return now <= endDate;
};

// Get video data URL for frontend playback
videoSchema.methods.getVideoDataURL = function () {
  if (!this.base64Data || !this.mimetype) return null;
  return `data:${this.mimetype};base64,${this.base64Data}`;
};

// Check if video has valid data for sending
videoSchema.methods.isValidForSending = function () {
  return !!(this.base64Data && this.mimetype && this.fileSize > 0);
};

// Get formatted caption with text box content
videoSchema.methods.getFormattedCaption = function (baseCaption = "") {
  let caption = baseCaption;

  if (this.textBox && this.textBox.isActive && this.textBox.content) {
    if (caption) {
      caption += "\n\n📝 Additional Message:\n" + this.textBox.content;
    } else {
      caption = this.textBox.content;
    }
  }

  return caption;
};

// Activate this video (deactivates others of same type)
videoSchema.methods.activate = async function (schedule = {}) {
  // Deactivate all other videos of the same type
  await mongoose.model("Video").updateMany(
    {
      _id: { $ne: this._id },
      videoType: this.videoType,
    },
    {
      $set: {
        isActive: false,
        isCurrentlyActive: false,
      },
    }
  );

  const now = new Date();
  const { startDate, endDate, isIndefinite = true } = schedule;

  const start = startDate ? new Date(startDate) : now;
  const end = isIndefinite ? null : new Date(endDate);

  this.isActive = true;
  this.isCurrentlyActive = start <= now && (isIndefinite || !end || end > now);
  this.activeSchedule = {
    startDate: start,
    endDate: end,
    isIndefinite: isIndefinite,
  };

  return await this.save();
};

// Deactivate this video
videoSchema.methods.deactivate = async function () {
  this.isActive = false;
  this.isCurrentlyActive = false;
  this.activeSchedule = {
    startDate: null,
    endDate: null,
    isIndefinite: true,
  };

  return await this.save();
};

// Update text box content
videoSchema.methods.updateTextBox = async function (content, isActive) {
  this.textBox = {
    content: content || "",
    isActive: isActive || false,
  };

  return await this.save();
};

// Record video sent
videoSchema.methods.recordSent = async function () {
  this.sentCount += 1;
  this.lastSentDate = new Date();
  return await this.save();
};

// Auto-deactivate expired videos
videoSchema.statics.checkExpiredVideos = async function () {
  const now = new Date();

  // Find videos that should be deactivated
  const expiredVideos = await this.find({
    isActive: true,
    "activeSchedule.isIndefinite": false,
    "activeSchedule.endDate": { $lt: now },
  });

  // Update them
  const result = await this.updateMany(
    {
      isActive: true,
      "activeSchedule.isIndefinite": false,
      "activeSchedule.endDate": { $lt: now },
    },
    {
      $set: {
        isActive: false,
        isCurrentlyActive: false,
      },
    }
  );

  console.log(`Deactivated ${result.modifiedCount} expired videos`);
  return result.modifiedCount;
};

// Update currently active status for all videos
videoSchema.statics.updateCurrentlyActiveStatus = async function () {
  const activeVideos = await this.find({ isActive: true });

  for (const video of activeVideos) {
    const shouldBeActive = video.checkCurrentlyActive();
    if (video.isCurrentlyActive !== shouldBeActive) {
      video.isCurrentlyActive = shouldBeActive;
      await video.save();
    }
  }
};

// Get currently active video by type
videoSchema.statics.getCurrentlyActiveVideo = async function (videoType) {
  await this.checkExpiredVideos();
  await this.updateCurrentlyActiveStatus();

  const activeVideo = await this.findOne({
    videoType: videoType,
    isActive: true,
    isCurrentlyActive: true,
  });

  return activeVideo;
};

// Get currently active referral video (159A)
videoSchema.statics.getCurrentlyActiveReferralVideo = async function () {
  return await this.getCurrentlyActiveVideo("referral");
};

// Get currently active introduction video (159B)
videoSchema.statics.getCurrentlyActiveIntroductionVideo = async function () {
  return await this.getCurrentlyActiveVideo("introduction");
};

// Get video statistics by type
videoSchema.statics.getVideoStatsByType = async function (videoType) {
  const totalVideos = await this.countDocuments({ videoType });
  const activeVideos = await this.countDocuments({ videoType, isActive: true });

  // Get currently active videos (considering schedule)
  const videos = await this.find({ videoType, isActive: true });
  const currentlyActiveVideos = videos.filter((video) =>
    video.checkCurrentlyActive()
  ).length;

  return {
    total: totalVideos,
    active: activeVideos,
    currentlyActive: currentlyActiveVideos,
    scheduled: activeVideos - currentlyActiveVideos,
  };
};

// Get all video statistics
videoSchema.statics.getAllVideoStats = async function () {
  const referralStats = await this.getVideoStatsByType("referral");
  const introductionStats = await this.getVideoStatsByType("introduction");

  return {
    referral: referralStats,
    introduction: introductionStats,
    total: {
      total: referralStats.total + introductionStats.total,
      active: referralStats.active + introductionStats.active,
      currentlyActive:
        referralStats.currentlyActive + introductionStats.currentlyActive,
    },
  };
};

// Get videos by type
videoSchema.statics.getVideosByType = async function (videoType) {
  return await this.find({ videoType }).sort({ uploadDate: -1 });
};

// Get referral videos (159A)
videoSchema.statics.getReferralVideos = async function () {
  return await this.getVideosByType("referral");
};

// Get introduction videos (159B)
videoSchema.statics.getIntroductionVideos = async function () {
  return await this.getVideosByType("introduction");
};

// Pre-save middleware to update currently active status
videoSchema.pre("save", function (next) {
  if (this.isActive && this.activeSchedule) {
    this.isCurrentlyActive = this.checkCurrentlyActive();
  } else if (!this.isActive) {
    this.isCurrentlyActive = false;
  }
  next();
});

// Index for faster queries
videoSchema.index({ videoType: 1 });
videoSchema.index({ isActive: 1 });
videoSchema.index({ isCurrentlyActive: 1 });
videoSchema.index({ uploadDate: -1 });
videoSchema.index({ videoType: 1, isActive: 1 });
videoSchema.index({ videoType: 1, isCurrentlyActive: 1 });
videoSchema.index({
  "activeSchedule.startDate": 1,
  "activeSchedule.endDate": 1,
});

module.exports = mongoose.models.Video || mongoose.model("Video", videoSchema);
