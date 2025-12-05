// utils/videoManagement.js
const fs = require("fs");
const path = require("path");
const Customer = require("../models/customer");

class VideoManagementUtils {
  // Get video statistics
  static async getVideoStats() {
    try {
      const stats = await Customer.aggregate([
        { $match: { "referralvideos.0": { $exists: true } } },
        { $unwind: "$referralvideos" },
        {
          $group: {
            _id: { $ifNull: ["$referralvideos.status", "unverified"] },
            count: { $sum: 1 },
            totalShared: {
              $sum: { $size: { $ifNull: ["$referralvideos.sharedWith", []] } },
            },
          },
        },
      ]);

      const result = {
        unverified: { count: 0, totalShared: 0 },
        verified: { count: 0, totalShared: 0 },
        manager: { count: 0, totalShared: 0 },
        spam: { count: 0, totalShared: 0 },
      };

      stats.forEach((stat) => {
        result[stat._id] = {
          count: stat.count,
          totalShared: stat.totalShared,
        };
      });

      return result;
    } catch (error) {
      console.error("Error getting video stats:", error);
      throw error;
    }
  }

  // Clean up orphaned video files
  static async cleanupOrphanedVideos() {
    try {
      const videosDir = path.join(__dirname, "../referral_videos");

      if (!fs.existsSync(videosDir)) {
        console.log("Videos directory does not exist");
        return { cleaned: 0, errors: [] };
      }

      const files = fs.readdirSync(videosDir);
      const dbVideos = await Customer.aggregate([
        { $match: { "referralvideos.0": { $exists: true } } },
        { $unwind: "$referralvideos" },
        { $project: { imagePath: "$referralvideos.imagePath" } },
      ]);

      const dbFilenames = new Set(
        dbVideos.map((v) => path.basename(v.imagePath))
      );

      let cleaned = 0;
      const errors = [];

      for (const file of files) {
        if (!dbFilenames.has(file)) {
          try {
            fs.unlinkSync(path.join(videosDir, file));
            cleaned++;
            console.log(`Deleted orphaned file: ${file}`);
          } catch (error) {
            errors.push(`Failed to delete ${file}: ${error.message}`);
          }
        }
      }

      return { cleaned, errors };
    } catch (error) {
      console.error("Error cleaning up videos:", error);
      throw error;
    }
  }

  // Validate video file integrity
  static async validateVideoFiles() {
    try {
      const customers = await Customer.find({
        "referralvideos.0": { $exists: true },
      });
      const results = {
        total: 0,
        valid: 0,
        missing: 0,
        invalid: [],
      };

      for (const customer of customers) {
        for (const video of customer.referralvideos) {
          results.total++;
          const videoPath = path.join(__dirname, "..", video.imagePath);

          if (fs.existsSync(videoPath)) {
            const stats = fs.statSync(videoPath);
            if (stats.size > 0) {
              results.valid++;
            } else {
              results.invalid.push({
                customerId: customer._id,
                videoId: video.imageId,
                issue: "Empty file",
              });
            }
          } else {
            results.missing++;
            results.invalid.push({
              customerId: customer._id,
              videoId: video.imageId,
              issue: "File not found",
            });
          }
        }
      }

      return results;
    } catch (error) {
      console.error("Error validating videos:", error);
      throw error;
    }
  }

  // Bulk update video statuses
  static async bulkUpdateStatus(videoIds, newStatus, adminNotes = "") {
    try {
      const results = {
        updated: 0,
        failed: 0,
        errors: [],
      };

      for (const videoId of videoIds) {
        try {
          const customer = await Customer.findOne({
            "referralvideos.imageId": videoId,
          });

          if (customer) {
            const videoIndex = customer.referralvideos.findIndex(
              (v) => v.imageId === videoId
            );

            if (videoIndex !== -1) {
              customer.referralvideos[videoIndex].status = newStatus;
              customer.referralvideos[videoIndex].statusUpdatedAt = new Date();
              customer.referralvideos[videoIndex].adminNotes = adminNotes;

              if (!customer.referralvideos[videoIndex].statusHistory) {
                customer.referralvideos[videoIndex].statusHistory = [];
              }

              customer.referralvideos[videoIndex].statusHistory.push({
                status: newStatus,
                updatedAt: new Date(),
                reason: `Bulk update: ${adminNotes}`,
              });

              await customer.save();
              results.updated++;
            }
          }
        } catch (error) {
          results.failed++;
          results.errors.push(`${videoId}: ${error.message}`);
        }
      }

      return results;
    } catch (error) {
      console.error("Error in bulk update:", error);
      throw error;
    }
  }

  // Get videos by date range
  static async getVideosByDateRange(startDate, endDate, status = null) {
    try {
      const matchConditions = {
        "referralvideos.approvalDate": {
          $gte: new Date(startDate),
          $lte: new Date(endDate),
        },
      };

      if (status) {
        matchConditions["referralvideos.status"] = status;
      }

      const videos = await Customer.aggregate([
        { $match: { "referralvideos.0": { $exists: true } } },
        { $unwind: "$referralvideos" },
        { $match: matchConditions },
        {
          $project: {
            customerId: "$_id",
            customerName: "$name",
            customerPhone: { $arrayElemAt: ["$phoneNumber", 0] },
            referralCode: "$referralCode",
            imageId: "$referralvideos.imageId",
            imagePath: "$referralvideos.imagePath",
            approvalDate: "$referralvideos.approvalDate",
            status: "$referralvideos.status",
            sharedCount: {
              $size: { $ifNull: ["$referralvideos.sharedWith", []] },
            },
          },
        },
        { $sort: { approvalDate: -1 } },
      ]);

      return videos;
    } catch (error) {
      console.error("Error getting videos by date range:", error);
      throw error;
    }
  }
}

module.exports = VideoManagementUtils;

// CLI script for video management (save as scripts/manageVideos.js)
// Usage: node scripts/manageVideos.js <command> [options]

if (require.main === module) {
  const mongoose = require("mongoose");
  const command = process.argv[2];

  // Connect to MongoDB
  mongoose
    .connect(process.env.MONGODB_URI || "your-mongodb-connection-string")
    .then(async () => {
      console.log("Connected to MongoDB");

      switch (command) {
        case "stats":
          const stats = await VideoManagementUtils.getVideoStats();
          console.log("Video Statistics:");
          console.table(stats);
          break;

        case "cleanup":
          const cleanupResult =
            await VideoManagementUtils.cleanupOrphanedVideos();
          console.log(`Cleaned up ${cleanupResult.cleaned} orphaned files`);
          if (cleanupResult.errors.length > 0) {
            console.log("Errors:", cleanupResult.errors);
          }
          break;

        case "validate":
          const validation = await VideoManagementUtils.validateVideoFiles();
          console.log("Validation Results:");
          console.table(validation);
          break;

        case "bulk-update":
          const status = process.argv[3];
          const videoIds = process.argv.slice(4);
          if (!status || videoIds.length === 0) {
            console.log(
              "Usage: node manageVideos.js bulk-update <status> <videoId1> [videoId2] ..."
            );
            break;
          }
          const updateResult = await VideoManagementUtils.bulkUpdateStatus(
            videoIds,
            status
          );
          console.log(
            `Updated: ${updateResult.updated}, Failed: ${updateResult.failed}`
          );
          break;

        default:
          console.log(
            "Available commands: stats, cleanup, validate, bulk-update"
          );
      }

      mongoose.disconnect();
    })
    .catch((error) => {
      console.error("Error:", error);
      process.exit(1);
    });
}
