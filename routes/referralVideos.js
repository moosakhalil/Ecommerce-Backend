// routes/referralVideos.js
const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");
const mongoose = require("mongoose");

// GET /api/referral-videos - Fetch videos by status
router.get("/", async (req, res) => {
  try {
    const { status = "unverified" } = req.query;

    console.log(`Fetching referral videos with status: ${status}`);

    // Aggregate to get all videos with customer details and referral count
    const customers = await Customer.aggregate([
      // Match customers who have referral videos
      { $match: { "referralvideos.0": { $exists: true } } },

      // Unwind the referralvideos array
      { $unwind: "$referralvideos" },

      // Match videos with the requested status (default to unverified if no status field)
      {
        $match: {
          $or: [
            { "referralvideos.status": status },
            {
              $and: [
                { "referralvideos.status": { $exists: false } },
                { $expr: { $eq: [status, "unverified"] } },
              ],
            },
          ],
        },
      },

      // Lookup to get referrals made by this customer
      {
        $lookup: {
          from: "customers", // Collection name
          let: { customerReferralCode: "$referralCode" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$referredBy.referralCode", "$$customerReferralCode"],
                },
              },
            },
            {
              $count: "totalReferred",
            },
          ],
          as: "referralStats",
        },
      },

      // Project the required fields
      {
        $project: {
          customerId: "$_id",
          customerName: "$name",
          customerPhone: { $arrayElemAt: ["$phoneNumber", 0] },
          referralCode: "$referralCode",
          imageId: "$referralvideos.imageId",
          approvalDate: "$referralvideos.approvalDate",
          sharedWith: "$referralvideos.sharedWith",
          sharedCount: {
            $size: { $ifNull: ["$referralvideos.sharedWith", []] },
          },
          totalContactsReferred: {
            $ifNull: [{ $arrayElemAt: ["$referralStats.totalReferred", 0] }, 0],
          },
          status: {
            $ifNull: ["$referralvideos.status", "unverified"],
          },
          mediaType: "$referralvideos.mediaType",
          mimetype: "$referralvideos.mimetype",
          filename: "$referralvideos.filename",
          fileSize: "$referralvideos.fileSize",
          // Include base64Data for video display
          base64Data: "$referralvideos.base64Data",
        },
      },

      // Sort by approval date (newest first)
      { $sort: { approvalDate: -1 } },
    ]);

    console.log(`Found ${customers.length} videos for status: ${status}`);

    res.json({
      success: true,
      videos: customers,
      count: customers.length,
    });
  } catch (error) {
    console.error("Error fetching referral videos:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching referral videos",
      error: error.message,
    });
  }
});

// POST /api/referral-videos/update-status - Update video status
router.post("/update-status", async (req, res) => {
  try {
    const { customerId, videoId, status } = req.body;

    // Validate required fields
    if (!customerId || !videoId || !status) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: customerId, videoId, status",
      });
    }

    // Validate status
    const validStatuses = ["unverified", "verified", "manager", "spam"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    console.log(
      `Updating video ${videoId} for customer ${customerId} to status: ${status}`
    );

    // Find customer and update the specific video's status
    const customer = await Customer.findById(customerId);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Find the video in the referralvideos array
    const videoIndex = customer.referralvideos.findIndex(
      (video) => video.imageId === videoId
    );

    if (videoIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      });
    }

    // Update the video status and add timestamp
    customer.referralvideos[videoIndex].status = status;
    customer.referralvideos[videoIndex].statusUpdatedAt = new Date();

    // Add admin log if needed
    if (!customer.referralvideos[videoIndex].statusHistory) {
      customer.referralvideos[videoIndex].statusHistory = [];
    }

    customer.referralvideos[videoIndex].statusHistory.push({
      status: status,
      updatedAt: new Date(),
      updatedBy: "admin", // You can add actual admin user info here
    });

    await customer.save();

    console.log(`Successfully updated video ${videoId} to status: ${status}`);

    res.json({
      success: true,
      message: `Video status updated to ${status}`,
      video: {
        imageId: videoId,
        status: status,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Error updating video status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating video status",
      error: error.message,
    });
  }
});

// POST /api/referral-videos/bulk-update-status - Bulk update video statuses
router.post("/bulk-update-status", async (req, res) => {
  try {
    const { updates } = req.body; // Array of { customerId, videoId, status }

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Updates array is required",
      });
    }

    const validStatuses = ["unverified", "verified", "manager", "spam"];
    const results = [];
    const errors = [];

    for (const update of updates) {
      try {
        const { customerId, videoId, status } = update;

        if (!customerId || !videoId || !status) {
          errors.push({
            videoId,
            error: "Missing required fields",
          });
          continue;
        }

        if (!validStatuses.includes(status)) {
          errors.push({
            videoId,
            error: `Invalid status: ${status}`,
          });
          continue;
        }

        const customer = await Customer.findById(customerId);
        if (!customer) {
          errors.push({
            videoId,
            error: "Customer not found",
          });
          continue;
        }

        const videoIndex = customer.referralvideos.findIndex(
          (video) => video.imageId === videoId
        );

        if (videoIndex === -1) {
          errors.push({
            videoId,
            error: "Video not found",
          });
          continue;
        }

        // Update the video status
        customer.referralvideos[videoIndex].status = status;
        customer.referralvideos[videoIndex].statusUpdatedAt = new Date();

        if (!customer.referralvideos[videoIndex].statusHistory) {
          customer.referralvideos[videoIndex].statusHistory = [];
        }

        customer.referralvideos[videoIndex].statusHistory.push({
          status: status,
          updatedAt: new Date(),
          updatedBy: "bulk-admin",
        });

        await customer.save();

        results.push({
          videoId,
          status,
          success: true,
        });
      } catch (error) {
        errors.push({
          videoId: update.videoId,
          error: error.message,
        });
      }
    }

    res.json({
      success: true,
      message: `Bulk update completed. ${results.length} successful, ${errors.length} failed.`,
      results,
      errors,
      summary: {
        total: updates.length,
        successful: results.length,
        failed: errors.length,
      },
    });
  } catch (error) {
    console.error("Error in bulk update:", error);
    res.status(500).json({
      success: false,
      message: "Error in bulk update",
      error: error.message,
    });
  }
});

// GET /api/referral-videos/stats - Get statistics for dashboard
router.get("/stats", async (req, res) => {
  try {
    const stats = await Customer.aggregate([
      // Match customers with referral videos
      { $match: { "referralvideos.0": { $exists: true } } },

      // Unwind videos array
      { $unwind: "$referralvideos" },

      // Group by status and count
      {
        $group: {
          _id: { $ifNull: ["$referralvideos.status", "unverified"] },
          count: { $sum: 1 },
          totalShared: {
            $sum: {
              $size: { $ifNull: ["$referralvideos.sharedWith", []] },
            },
          },
          totalSize: {
            $sum: { $ifNull: ["$referralvideos.fileSize", 0] },
          },
        },
      },

      // Format output
      {
        $project: {
          status: "$_id",
          count: 1,
          totalShared: 1,
          totalSize: 1,
          _id: 0,
        },
      },
    ]);

    // Get total referrals made by customers with videos
    const referralStats = await Customer.aggregate([
      { $match: { "referralvideos.0": { $exists: true } } },
      {
        $lookup: {
          from: "customers",
          let: { customerReferralCode: "$referralCode" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$referredBy.referralCode", "$$customerReferralCode"],
                },
              },
            },
          ],
          as: "referrals",
        },
      },
      {
        $group: {
          _id: null,
          totalReferralsMade: { $sum: { $size: "$referrals" } },
          customersWithVideos: { $sum: 1 },
        },
      },
    ]);

    // Create a proper stats object with all statuses
    const formattedStats = {
      unverified: { count: 0, totalShared: 0, totalSize: 0 },
      verified: { count: 0, totalShared: 0, totalSize: 0 },
      manager: { count: 0, totalShared: 0, totalSize: 0 },
      spam: { count: 0, totalShared: 0, totalSize: 0 },
    };

    stats.forEach((stat) => {
      formattedStats[stat.status] = {
        count: stat.count,
        totalShared: stat.totalShared,
        totalSize: stat.totalSize,
      };
    });

    const referralSummary = referralStats[0] || {
      totalReferralsMade: 0,
      customersWithVideos: 0,
    };

    res.json({
      success: true,
      stats: formattedStats,
      referralSummary: {
        totalReferralsMade: referralSummary.totalReferralsMade,
        customersWithVideos: referralSummary.customersWithVideos,
        averageReferralsPerCustomer:
          referralSummary.customersWithVideos > 0
            ? (
                referralSummary.totalReferralsMade /
                referralSummary.customersWithVideos
              ).toFixed(2)
            : 0,
      },
    });
  } catch (error) {
    console.error("Error fetching video stats:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching video statistics",
      error: error.message,
    });
  }
});

// GET /api/referral-videos/:customerId/:videoId - Get specific video details
router.get("/:customerId/:videoId", async (req, res) => {
  try {
    const { customerId, videoId } = req.params;

    // Use aggregation to get video with referral count
    const result = await Customer.aggregate([
      { $match: { _id: mongoose.Types.ObjectId(customerId) } },
      { $unwind: "$referralvideos" },
      { $match: { "referralvideos.imageId": videoId } },
      {
        $lookup: {
          from: "customers",
          let: { customerReferralCode: "$referralCode" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$referredBy.referralCode", "$$customerReferralCode"],
                },
              },
            },
            { $count: "totalReferred" },
          ],
          as: "referralStats",
        },
      },
      {
        $project: {
          video: "$referralvideos",
          customerName: "$name",
          customerPhone: { $arrayElemAt: ["$phoneNumber", 0] },
          referralCode: "$referralCode",
          totalContactsReferred: {
            $ifNull: [{ $arrayElemAt: ["$referralStats.totalReferred", 0] }, 0],
          },
        },
      },
    ]);

    if (result.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer or video not found",
      });
    }

    const data = result[0];

    res.json({
      success: true,
      video: {
        ...data.video.toObject(),
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        referralCode: data.referralCode,
        totalContactsReferred: data.totalContactsReferred,
      },
    });
  } catch (error) {
    console.error("Error fetching video details:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching video details",
      error: error.message,
    });
  }
});

// GET /api/referral-videos/customer/:customerId/referrals - Get referrals made by customer
router.get("/customer/:customerId/referrals", async (req, res) => {
  try {
    const { customerId } = req.params;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Find all customers referred by this customer
    const referrals = await Customer.find({
      "referredBy.referralCode": customer.referralCode,
    }).select("name phoneNumber referredBy orderHistory");

    res.json({
      success: true,
      referrals: referrals.map((referral) => ({
        id: referral._id,
        name: referral.name,
        phone: referral.phoneNumber[0],
        dateReferred: referral.referredBy?.dateReferred,
        totalOrders: referral.orderHistory ? referral.orderHistory.length : 0,
        totalSpent: referral.orderHistory
          ? referral.orderHistory.reduce(
              (sum, order) => sum + (order.totalAmount || 0),
              0
            )
          : 0,
      })),
      summary: {
        totalReferrals: referrals.length,
        totalRevenue: referrals.reduce((sum, referral) => {
          return (
            sum +
            (referral.orderHistory
              ? referral.orderHistory.reduce(
                  (orderSum, order) => orderSum + (order.totalAmount || 0),
                  0
                )
              : 0)
          );
        }, 0),
      },
    });
  } catch (error) {
    console.error("Error fetching customer referrals:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching customer referrals",
      error: error.message,
    });
  }
});

// DELETE /api/referral-videos/:customerId/:videoId - Delete a video (admin only)
router.delete("/:customerId/:videoId", async (req, res) => {
  try {
    const { customerId, videoId } = req.params;

    const customer = await Customer.findById(customerId);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const videoIndex = customer.referralvideos.findIndex(
      (v) => v.imageId === videoId
    );

    if (videoIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      });
    }

    // Remove from database (no need to delete physical files since we're using base64)
    customer.referralvideos.splice(videoIndex, 1);
    await customer.save();

    console.log(`Successfully deleted video ${videoId} from database`);

    res.json({
      success: true,
      message: "Video deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting video:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting video",
      error: error.message,
    });
  }
});

// GET /api/referral-videos/video/:videoId/stream - Stream base64 video as blob
router.get("/video/:videoId/stream", async (req, res) => {
  try {
    const { videoId } = req.params;

    // Find the video in any customer's referralvideos
    const customer = await Customer.findOne({
      "referralvideos.imageId": videoId,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Video not found",
      });
    }

    const video = customer.referralvideos.find((v) => v.imageId === videoId);

    if (!video || !video.base64Data) {
      return res.status(404).json({
        success: false,
        message: "Video data not found",
      });
    }

    // Convert base64 to buffer
    const videoBuffer = Buffer.from(video.base64Data, "base64");

    // Set appropriate headers
    res.set({
      "Content-Type": video.mimetype || "video/mp4",
      "Content-Length": videoBuffer.length,
      "Cache-Control": "private, max-age=3600",
    });

    // Send the video buffer
    res.send(videoBuffer);
  } catch (error) {
    console.error("Error streaming video:", error);
    res.status(500).json({
      success: false,
      message: "Error streaming video",
      error: error.message,
    });
  }
});

module.exports = router;
