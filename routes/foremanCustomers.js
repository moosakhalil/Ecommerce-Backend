// routes/foremanCustomers.js
const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");

// GET /api/foreman-customers - Fetch customers by status with enhanced data
router.get("/", async (req, res) => {
  try {
    const { status = "customers" } = req.query;
    console.log(`Fetching customers for status: ${status}`);

    let matchCondition = {};

    // Enhanced status filtering
    switch (status) {
      case "customers":
        // Regular customers (not foreman approved)
        matchCondition = {
          $or: [
            { "foremanStatus.isForemanApproved": { $ne: true } },
            { foremanStatus: { $exists: false } },
          ],
        };
        break;
      case "approved_foreman":
        matchCondition = { "foremanStatus.isForemanApproved": true };
        break;
      case "approved_commission":
        matchCondition = {
          "foremanStatus.isForemanApproved": true,
          "foremanStatus.isCommissionEligible": true,
        };
        break;
      case "Everyone":
        matchCondition = {};
        break;
      default:
        matchCondition = {};
    }

    // Enhanced aggregation pipeline
    const customers = await Customer.aggregate([
      { $match: matchCondition },

      // Add calculated fields
      {
        $addFields: {
          // Calculate total spent from shopping history
          totalSpent: {
            $reduce: {
              input: { $ifNull: ["$shoppingHistory", []] },
              initialValue: 0,
              in: { $add: ["$$value", { $ifNull: ["$$this.totalAmount", 0] }] },
            },
          },

          // Count total orders
          totalOrders: { $size: { $ifNull: ["$shoppingHistory", []] } },

          // Count videos uploaded
          videosUploaded: { $size: { $ifNull: ["$referralvideos", []] } },

          // Calculate total phone numbers given
          totalPhoneNumbersGiven: {
            $reduce: {
              input: { $ifNull: ["$referralvideos", []] },
              initialValue: 0,
              in: {
                $add: [
                  "$$value",
                  { $size: { $ifNull: ["$$this.sharedWith", []] } },
                ],
              },
            },
          },

          // Get first phone number
          phoneNumber: { $arrayElemAt: ["$phoneNumber", 0] },

          // Enhanced commission fields
          commissionEarned: {
            $ifNull: ["$commissionTracking.totalCommissionEarned", 0],
          },
          commissionPaid: {
            $ifNull: ["$commissionTracking.totalCommissionPaid", 0],
          },
          availableCommission: {
            $ifNull: ["$commissionTracking.availableCommission", 0],
          },

          // Foreman status fields
          isForemanApproved: {
            $ifNull: ["$foremanStatus.isForemanApproved", false],
          },
          isCommissionEligible: {
            $ifNull: ["$foremanStatus.isCommissionEligible", false],
          },
          foremanApprovalDate: "$foremanStatus.foremanApprovalDate",
          commissionEligibilityDate: "$foremanStatus.commissionEligibilityDate",

          // Count successful referrals from customersReferred array
          successfulReferrals: {
            $size: {
              $filter: {
                input: { $ifNull: ["$customersReferred", []] },
                cond: { $eq: ["$$this.hasPlacedOrder", true] },
              },
            },
          },

          // Total referrals count
          totalReferrals: { $size: { $ifNull: ["$customersReferred", []] } },
        },
      },

      // Project only needed fields
      {
        $project: {
          _id: 1,
          name: 1,
          phoneNumber: 1,
          referralCode: 1,
          totalSpent: 1,
          totalOrders: 1,
          videosUploaded: 1,
          totalPhoneNumbersGiven: 1,
          successfulReferrals: 1,
          totalReferrals: 1,
          createdAt: 1,
          lastInteraction: 1,
          // Enhanced commission fields
          commissionEarned: 1,
          commissionPaid: 1,
          availableCommission: 1,
          // Enhanced foreman fields
          isForemanApproved: 1,
          isCommissionEligible: 1,
          foremanApprovalDate: 1,
          commissionEligibilityDate: 1,
        },
      },

      // Sort by commission earned and referrals
      {
        $sort: {
          commissionEarned: -1,
          successfulReferrals: -1,
          totalSpent: -1,
        },
      },
    ]);

    console.log(`Found ${customers.length} customers for status: ${status}`);

    res.json({
      success: true,
      customers: customers,
      count: customers.length,
      status: status,
    });
  } catch (error) {
    console.error("Error fetching foreman customers:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching customers",
      error: error.message,
    });
  }
});

// POST /api/foreman-customers/update-foreman-status - Update foreman approval status
router.post("/update-foreman-status", async (req, res) => {
  try {
    const { customerId, isApproved, staffId, staffName, reason } = req.body;

    if (!customerId || typeof isApproved !== "boolean" || !staffId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: customerId, isApproved, staffId",
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const staffInfo = { staffId, staffName: staffName || "Admin" };
    await customer.updateForemanStatus(isApproved, staffInfo, reason || "");

    res.json({
      success: true,
      message: `Customer ${isApproved ? "approved" : "revoked"} as foreman`,
      customer: {
        _id: customer._id,
        name: customer.name,
        isForemanApproved: isApproved,
        foremanApprovalDate: customer.foremanStatus?.foremanApprovalDate,
      },
    });
  } catch (error) {
    console.error("Error updating foreman status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating foreman status",
      error: error.message,
    });
  }
});

// POST /api/foreman-customers/update-commission-eligibility - Update commission eligibility
router.post("/update-commission-eligibility", async (req, res) => {
  try {
    const { customerId, isEligible, staffId, staffName, reason } = req.body;

    if (!customerId || typeof isEligible !== "boolean" || !staffId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: customerId, isEligible, staffId",
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const staffInfo = { staffId, staffName: staffName || "Admin" };
    await customer.updateCommissionEligibility(
      isEligible,
      staffInfo,
      reason || ""
    );

    res.json({
      success: true,
      message: `Customer ${
        isEligible ? "approved" : "revoked"
      } for commission eligibility`,
      customer: {
        _id: customer._id,
        name: customer.name,
        isCommissionEligible: isEligible,
        commissionEligibilityDate:
          customer.foremanStatus?.commissionEligibilityDate,
      },
    });
  } catch (error) {
    console.error("Error updating commission eligibility:", error);
    res.status(500).json({
      success: false,
      message: "Error updating commission eligibility",
      error: error.message,
    });
  }
});

// POST /api/foreman-customers/pay-commission - Pay commission to customer
router.post("/pay-commission", async (req, res) => {
  try {
    const { customerId, amount, staffId, staffName, notes } = req.body;

    if (!customerId || !amount || amount <= 0 || !staffId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: customerId, amount (> 0), staffId",
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    if (!customer.foremanStatus?.isCommissionEligible) {
      return res.status(400).json({
        success: false,
        message: "Customer not eligible for commission",
      });
    }

    const availableCommission =
      customer.commissionTracking?.availableCommission || 0;
    if (amount > availableCommission) {
      return res.status(400).json({
        success: false,
        message: `Cannot pay more than available commission: ${availableCommission.toFixed(
          2
        )}`,
      });
    }

    const staffInfo = { staffId, staffName: staffName || "Admin" };
    await customer.payCommission(amount, staffInfo, notes || "");

    res.json({
      success: true,
      message: `Commission of ${amount} paid successfully`,
      customer: {
        _id: customer._id,
        name: customer.name,
        totalCommissionPaid: customer.commissionTracking.totalCommissionPaid,
        availableCommission: customer.commissionTracking.availableCommission,
      },
    });
  } catch (error) {
    console.error("Error paying commission:", error);
    res.status(500).json({
      success: false,
      message: "Error paying commission",
      error: error.message,
    });
  }
});

// GET /api/foreman-customers/:customerId/referral-details - Get detailed referral information
router.get("/:customerId/referral-details", async (req, res) => {
  try {
    const { customerId } = req.params;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Get detailed referral data from customersReferred array
    const successfulReferrals =
      customer.customersReferred?.filter((r) => r.hasPlacedOrder) || [];

    // Get all referred phone numbers from referral videos
    const allReferredNumbers = [];
    if (customer.referralvideos) {
      customer.referralvideos.forEach((video) => {
        if (video.sharedWith) {
          video.sharedWith.forEach((contact) => {
            // Check if this contact became a referred customer
            const referredCustomer = customer.customersReferred?.find(
              (r) => r.phoneNumber === contact.phoneNumber
            );

            allReferredNumbers.push({
              name: contact.name,
              phoneNumber: contact.phoneNumber,
              dateShared: contact.dateShared,
              hasOrdered: !!referredCustomer?.hasPlacedOrder,
              totalSpent: referredCustomer?.totalSpentAmount || 0,
              commissionGenerated: referredCustomer?.commissionGenerated || 0,
            });
          });
        }
      });
    }

    // Enhanced successful referrals with commission data
    const enhancedSuccessfulReferrals = successfulReferrals.map((referral) => ({
      _id: referral.customerId,
      name: referral.customerName,
      phoneNumber: referral.phoneNumber,
      dateReferred: referral.referralDate,
      firstOrderDate: referral.firstOrderDate,
      totalAmountOrdered: referral.totalSpentAmount || 0,
      totalOrdersCount: referral.totalOrdersCount || 0,
      commissionGenerated: referral.commissionGenerated || 0,
    }));

    res.json({
      success: true,
      successfulReferrals: enhancedSuccessfulReferrals,
      allReferredNumbers,
      summary: {
        totalReferred: customer.customersReferred?.length || 0,
        successfulConversions: successfulReferrals.length,
        totalPhoneNumbersGiven: allReferredNumbers.length,
        conversionRate:
          allReferredNumbers.length > 0
            ? (
                (successfulReferrals.length / allReferredNumbers.length) *
                100
              ).toFixed(2) + "%"
            : "0%",
        totalCommissionGenerated: successfulReferrals.reduce(
          (sum, r) => sum + (r.commissionGenerated || 0),
          0
        ),
      },
    });
  } catch (error) {
    console.error("Error fetching referral details:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching referral details",
      error: error.message,
    });
  }
});

// GET /api/foreman-customers/:customerId - Get detailed customer information
router.get("/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Calculate comprehensive stats
    const totalSpent =
      customer.shoppingHistory?.reduce(
        (sum, order) => sum + (order.totalAmount || 0),
        0
      ) || 0;
    const totalOrders = customer.shoppingHistory?.length || 0;
    const videosUploaded = customer.referralvideos?.length || 0;

    // Calculate total phone numbers given
    const totalPhoneNumbersGiven =
      customer.referralvideos?.reduce(
        (sum, video) => sum + (video.sharedWith?.length || 0),
        0
      ) || 0;

    // Get commission data
    const commissionData = customer.commissionTracking || {
      totalCommissionEarned: 0,
      totalCommissionPaid: 0,
      availableCommission: 0,
      commissionHistory: [],
    };

    // Get recent activity from shopping history and commission history
    const recentActivity = [];

    // Add recent orders
    if (customer.shoppingHistory) {
      customer.shoppingHistory.slice(-5).forEach((order) => {
        recentActivity.push({
          action: `Placed order ${order.orderId}`,
          date: order.orderDate,
          amount: order.totalAmount,
          type: "order",
        });
      });
    }

    // Add recent commission activities
    if (commissionData.commissionHistory) {
      commissionData.commissionHistory.slice(-3).forEach((commission) => {
        recentActivity.push({
          action: `Commission ${commission.type}: ${commission.amount}`,
          date: commission.date,
          amount: commission.amount,
          type: "commission",
        });
      });
    }

    // Sort by date (most recent first)
    recentActivity.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      success: true,
      customer: {
        _id: customer._id,
        name: customer.name,
        phoneNumber: customer.phoneNumber[0] || "",
        referralCode: customer.referralCode,
        // Enhanced foreman status
        isForemanApproved: customer.foremanStatus?.isForemanApproved || false,
        isCommissionEligible:
          customer.foremanStatus?.isCommissionEligible || false,
        foremanApprovalDate: customer.foremanStatus?.foremanApprovalDate,
        commissionEligibilityDate:
          customer.foremanStatus?.commissionEligibilityDate,
        commissionRate: customer.foremanStatus?.commissionRate || 5,
        // Stats
        totalSpent,
        totalOrders,
        videosUploaded,
        totalPhoneNumbersGiven,
        successfulReferrals:
          customer.customersReferred?.filter((r) => r.hasPlacedOrder).length ||
          0,
        totalReferrals: customer.customersReferred?.length || 0,
        totalAddresses: customer.addresses?.length || 0,
        createdAt: customer.createdAt,
        lastInteraction: customer.lastInteraction,
        // Enhanced commission data
        commissionEarned: commissionData.totalCommissionEarned,
        commissionPaid: commissionData.totalCommissionPaid,
        availableCommission: commissionData.availableCommission,
        commissionHistory: commissionData.commissionHistory || [],
        recentActivity: recentActivity.slice(0, 10),
      },
      // Enhanced referral data
      referredCustomers: (customer.customersReferred || []).map((ref) => ({
        _id: ref.customerId,
        name: ref.customerName,
        phoneNumber: ref.phoneNumber,
        dateReferred: ref.referralDate,
        hasOrders: ref.hasPlacedOrder,
        totalSpent: ref.totalSpentAmount || 0,
        orderCount: ref.totalOrdersCount || 0,
        commissionGenerated: ref.commissionGenerated || 0,
      })),
      foremanStatusHistory: customer.foremanStatus?.statusHistory || [],
    });
  } catch (error) {
    console.error("Error fetching customer details:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching customer details",
      error: error.message,
    });
  }
});

// POST /api/foreman-customers/process-referral-order - Process an order from a referred customer
router.post("/process-referral-order", async (req, res) => {
  try {
    const { referredCustomerId, orderData } = req.body;

    if (!referredCustomerId || !orderData) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: referredCustomerId, orderData",
      });
    }

    // Find the referred customer
    const referredCustomer = await Customer.findById(referredCustomerId);
    if (!referredCustomer) {
      return res.status(404).json({
        success: false,
        message: "Referred customer not found",
      });
    }

    // Check if customer has a primary referrer
    const primaryReferrer = referredCustomer.referralTracking?.primaryReferrer;
    if (!primaryReferrer) {
      return res.json({
        success: true,
        message: "No referrer found for this customer",
        commissionProcessed: false,
      });
    }

    // Find the referrer customer
    const referrerCustomer = await Customer.findById(
      primaryReferrer.customerId
    );
    if (!referrerCustomer) {
      return res.json({
        success: true,
        message: "Referrer customer not found",
        commissionProcessed: false,
      });
    }

    // Update referrer's customersReferred array
    let referredEntry = referrerCustomer.customersReferred?.find(
      (r) => r.customerId === referredCustomerId
    );

    if (!referredEntry) {
      // Add new referred customer entry
      if (!referrerCustomer.customersReferred) {
        referrerCustomer.customersReferred = [];
      }

      referredEntry = {
        customerId: referredCustomerId,
        customerName: referredCustomer.name,
        phoneNumber: referredCustomer.phoneNumber[0],
        referralDate: primaryReferrer.referralDate,
        hasPlacedOrder: true,
        firstOrderDate: new Date(),
        totalOrdersCount: 1,
        totalSpentAmount: orderData.totalAmount,
        commissionGenerated: 0,
      };

      referrerCustomer.customersReferred.push(referredEntry);
    } else {
      // Update existing entry
      if (!referredEntry.hasPlacedOrder) {
        referredEntry.hasPlacedOrder = true;
        referredEntry.firstOrderDate = new Date();
      }
      referredEntry.totalOrdersCount =
        (referredEntry.totalOrdersCount || 0) + 1;
      referredEntry.totalSpentAmount =
        (referredEntry.totalSpentAmount || 0) + orderData.totalAmount;
    }

    // Calculate and add commission if eligible
    let commissionAdded = 0;
    if (referrerCustomer.foremanStatus?.isCommissionEligible) {
      await referrerCustomer.addCommissionEarned(orderData, {
        customerId: referredCustomerId,
        customerName: referredCustomer.name,
      });

      // Calculate the commission amount for updating the referredEntry
      const eligibleAmount = orderData.items.reduce((sum, item) => {
        return sum + (item.isDiscountedProduct ? 0 : item.totalPrice);
      }, 0);

      const commissionRate = referrerCustomer.foremanStatus.commissionRate || 5;
      commissionAdded = (eligibleAmount * commissionRate) / 100;

      referredEntry.commissionGenerated =
        (referredEntry.commissionGenerated || 0) + commissionAdded;
    }

    await referrerCustomer.save();

    res.json({
      success: true,
      message: "Referral order processed successfully",
      commissionProcessed: commissionAdded > 0,
      commissionAmount: commissionAdded,
      referrer: {
        _id: referrerCustomer._id,
        name: referrerCustomer.name,
        totalCommissionEarned:
          referrerCustomer.commissionTracking?.totalCommissionEarned || 0,
      },
    });
  } catch (error) {
    console.error("Error processing referral order:", error);
    res.status(500).json({
      success: false,
      message: "Error processing referral order",
      error: error.message,
    });
  }
});

// GET /api/foreman-customers/stats/overview - Get comprehensive statistics
router.get("/stats/overview", async (req, res) => {
  try {
    const stats = await Customer.aggregate([
      {
        $group: {
          _id: null,
          totalCustomers: { $sum: 1 },
          regularCustomers: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $ne: ["$foremanStatus.isForemanApproved", true] },
                    { $not: { $ifNull: ["$foremanStatus", false] } },
                  ],
                },
                1,
                0,
              ],
            },
          },
          approvedForeman: {
            $sum: {
              $cond: [
                { $eq: ["$foremanStatus.isForemanApproved", true] },
                1,
                0,
              ],
            },
          },
          commissionEligible: {
            $sum: {
              $cond: [
                { $eq: ["$foremanStatus.isCommissionEligible", true] },
                1,
                0,
              ],
            },
          },
          totalCommissionEarned: {
            $sum: { $ifNull: ["$commissionTracking.totalCommissionEarned", 0] },
          },
          totalCommissionPaid: {
            $sum: { $ifNull: ["$commissionTracking.totalCommissionPaid", 0] },
          },
          totalRevenue: {
            $sum: {
              $reduce: {
                input: { $ifNull: ["$shoppingHistory", []] },
                initialValue: 0,
                in: { $add: ["$value", { $ifNull: ["$this.totalAmount", 0] }] },
              },
            },
          },
          totalReferrals: {
            $sum: { $size: { $ifNull: ["$customersReferred", []] } },
          },
          successfulReferrals: {
            $sum: {
              $size: {
                $filter: {
                  input: { $ifNull: ["$customersReferred", []] },
                  cond: { $eq: ["$this.hasPlacedOrder", true] },
                },
              },
            },
          },
        },
      },
    ]);

    const overview = stats[0] || {
      totalCustomers: 0,
      regularCustomers: 0,
      approvedForeman: 0,
      commissionEligible: 0,
      totalCommissionEarned: 0,
      totalCommissionPaid: 0,
      totalRevenue: 0,
      totalReferrals: 0,
      successfulReferrals: 0,
    };

    // Add calculated fields
    overview.availableCommission =
      overview.totalCommissionEarned - overview.totalCommissionPaid;
    overview.conversionRate =
      overview.totalReferrals > 0
        ? (
            (overview.successfulReferrals / overview.totalReferrals) *
            100
          ).toFixed(2) + "%"
        : "0%";

    res.json({
      success: true,
      stats: overview,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching statistics",
      error: error.message,
    });
  }
});

module.exports = router;
