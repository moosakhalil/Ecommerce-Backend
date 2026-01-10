// routes/referralData.js
const express = require("express");
const router = express.Router();
const Customer = require("../models/customer");

// GET /api/referral-data - Fetch comprehensive referral analytics by customer type
router.get("/", async (req, res) => {
  try {
    const {
      customerType = "referred_potential",
      period = "today",
      filter = "all",
    } = req.query;

    console.log(
      `Fetching referral data for customerType: ${customerType}, period: ${period}, filter: ${filter}`
    );

    // Calculate date ranges
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - 7);
    const monthStart = new Date(today);
    monthStart.setMonth(today.getMonth() - 1);
    const last3MonthsStart = new Date(today);
    last3MonthsStart.setMonth(today.getMonth() - 3);

    // Get date filter based on period
    const getDateFilter = (period) => {
      switch (period) {
        case "today":
          return { $gte: today };
        case "week":
          return { $gte: weekStart };
        case "month":
          return { $gte: monthStart };
        case "last3months":
          return { $gte: last3MonthsStart };
        default:
          return {}; // all time
      }
    };

    // Define customer type filters
    const getCustomerTypeFilter = (type) => {
      switch (type) {
        case "referred_potential":
          return {
            "orderHistory.0": { $exists: false }, // No order history
            "referredBy.referralCode": { $exists: true }, // Must be referred
            $or: [
              { repliedWithHi: true },
              { "messageHistory.content": { $regex: /^hi$/i } }, // Replied with "hi"
            ],
          };
        case "referred_existing":
          return {
            "orderHistory.0": { $exists: true }, // Has order history
            "referredBy.referralCode": { $exists: true }, // Must be referred
          };
        case "all_potential":
          return {
            "orderHistory.0": { $exists: false }, // No order history
            $or: [
              { repliedWithHi: true },
              { "messageHistory.content": { $regex: /^hi$/i } }, // Replied with "hi"
            ],
          };
        case "all_existing":
          return {
            "orderHistory.0": { $exists: true }, // Has order history
          };
        default:
          return {};
      }
    };

    // Initialize result structure
    const result = {
      referred_potential: {
        stats: {
          today: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
          week: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
          month: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
          last3months: {
            newAccounts: 0,
            successfulReferrals: 0,
            repliedWithHi: 0,
          },
          all: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
        },
        topReferring: [],
        topReferred: [],
        customers: [],
      },
      referred_existing: {
        stats: {
          today: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
          week: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
          month: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
          last3months: {
            newAccounts: 0,
            successfulReferrals: 0,
            repliedWithHi: 0,
          },
          all: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
        },
        topReferring: [],
        topReferred: [],
        customers: [],
      },
      all_potential: {
        stats: {
          today: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
          week: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
          month: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
          last3months: {
            newAccounts: 0,
            successfulReferrals: 0,
            repliedWithHi: 0,
          },
          all: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
        },
        topReferring: [],
        topReferred: [],
        customers: [],
      },
      all_existing: {
        stats: {
          today: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
          week: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
          month: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
          last3months: {
            newAccounts: 0,
            successfulReferrals: 0,
            repliedWithHi: 0,
          },
          all: { newAccounts: 0, successfulReferrals: 0, repliedWithHi: 0 },
        },
        topReferring: [],
        topReferred: [],
        customers: [],
      },
      recentActivity: [],
    };

    // OPTIMIZED: Only process the requested customer type instead of all types
    const type = customerType;
    const baseTypeFilter = getCustomerTypeFilter(type);

    // Apply additional filter for "all_" types
    let typeFilter = baseTypeFilter;
    if (type.startsWith("all_") && filter !== "all") {
      if (filter === "referred_only") {
        typeFilter = {
          ...baseTypeFilter,
          "referredBy.referralCode": { $exists: true },
        };
      } else if (filter === "non_referred_only") {
        typeFilter = {
          ...baseTypeFilter,
          "referredBy.referralCode": { $exists: false },
        };
      }
    }

    // Limit customers returned to improve performance
    const customers = await Customer.find(typeFilter).limit(500).lean();

    // OPTIMIZED: Only calculate stats for the requested period instead of all periods
    const dateFilter = getDateFilter(period);

    // Build queries for parallel execution
    let newAccountsQuery = typeFilter;
    if (Object.keys(dateFilter).length > 0) {
      newAccountsQuery = { ...typeFilter, createdAt: dateFilter };
    }

    let repliedWithHiQuery = {
      ...typeFilter,
      $or: [
        { repliedWithHi: true },
        { "messageHistory.content": { $regex: /^hi$/i } },
      ],
    };
    if (Object.keys(dateFilter).length > 0) {
      repliedWithHiQuery = { ...repliedWithHiQuery, createdAt: dateFilter };
    }

    let successfulReferralsQuery = {
      "referredBy.dateReferred":
        Object.keys(dateFilter).length > 0 ? dateFilter : { $exists: true },
      "orderHistory.0": { $exists: true },
    };

    // Run all count queries in parallel
    const [newAccounts, repliedWithHi, successfulReferrals] = await Promise.all([
      Customer.countDocuments(newAccountsQuery),
      Customer.countDocuments(repliedWithHiQuery),
      Customer.countDocuments(successfulReferralsQuery)
    ]);

    result[type].stats[period].newAccounts = newAccounts;
    result[type].stats[period].repliedWithHi = repliedWithHi;
    result[type].stats[period].successfulReferrals = successfulReferrals;

    // OPTIMIZED: Run both aggregate queries in parallel
    const [topReferring, topReferred] = await Promise.all([
      // Get top referring people (those who have made the most referrals)
      Customer.aggregate([
        { $match: typeFilter },
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
          $addFields: {
            totalReferrals: { $size: "$referrals" },
            isReferred: {
              $cond: [{ $ne: ["$referredBy.referralCode", null] }, true, false],
            },
          },
        },
        {
          $match: {
            totalReferrals: { $gt: 0 },
          },
        },
        {
          $sort: { totalReferrals: -1 },
        },
        {
          $limit: 20,
        },
        {
          $project: {
            name: 1,
            phoneNumber: { $arrayElemAt: ["$phoneNumber", 0] },
            referralCode: 1,
            totalReferrals: 1,
            isReferred: 1,
            createdAt: 1,
          },
        },
      ]),
      // Get top referred people (those who have been referred multiple times)
      Customer.aggregate([
        {
          $match: {
            ...typeFilter,
            "referredBy.referralCode": { $exists: true },
          },
        },
        {
          $group: {
            _id: {
              name: "$name",
              phoneNumber: { $arrayElemAt: ["$phoneNumber", 0] },
              referralCode: "$referralCode",
            },
            referredCount: { $sum: 1 },
            customers: { $push: "$$ROOT" },
          },
        },
        {
          $sort: { referredCount: -1 },
        },
        {
          $limit: 20,
        },
        {
          $project: {
            name: "$_id.name",
            phoneNumber: "$_id.phoneNumber",
            referralCode: "$_id.referralCode",
            referredCount: 1,
            isReferred: true,
            _id: 0,
          },
        },
      ])
    ]);

    // Process customer details
    const customerData = customers.map((customer) => {
      const videosUploaded = customer.referralvideos
        ? customer.referralvideos.length
        : 0;

      // Count people referred by this customer
      const peopleReferred = customers.filter(
        (c) =>
          c.referredBy && c.referredBy.referralCode === customer.referralCode
      ).length;

      // Check if customer was referred
      const isReferred = !!(
        customer.referredBy && customer.referredBy.referralCode
      );

      // Check if replied with hi
      const repliedWithHiFlag =
        customer.repliedWithHi ||
        (customer.messageHistory &&
          customer.messageHistory.some(
            (msg) => msg.content && msg.content.toLowerCase().trim() === "hi"
          ));

      // For existing customers, calculate order stats
      let totalOrders = 0;
      let totalSpent = 0;
      if (type.includes("existing") && customer.orderHistory) {
        totalOrders = customer.orderHistory.length;
        totalSpent = customer.orderHistory.reduce(
          (sum, order) => sum + (order.totalAmount || 0),
          0
        );
      }

      return {
        _id: customer._id,
        name: customer.name,
        phoneNumber: customer.phoneNumber[0] || "",
        referralCode: customer.referralCode,
        videosUploaded,
        peopleReferred,
        isReferred,
        repliedWithHi: repliedWithHiFlag,
        totalOrders,
        totalSpent,
        joinDate: customer.createdAt,
        lastActivity: customer.lastInteraction,
        referredBy: customer.referredBy,
      };
    });

    // Sort customers by activity level
    customerData.sort((a, b) => {
      const aActivity =
        a.videosUploaded + a.peopleReferred + (a.totalOrders || 0);
      const bActivity =
        b.videosUploaded + b.peopleReferred + (b.totalOrders || 0);
      return bActivity - aActivity;
    });

    result[type].topReferring = topReferring;
    result[type].topReferred = topReferred;
    result[type].customers = customerData;

    // OPTIMIZED: Run all recent activity queries in parallel
    const [recentVideos, recentReferrals, recentOrders, recentShares, recentHiReplies] = await Promise.all([
      // Get recent video uploads
      Customer.aggregate([
        { $match: { "referralvideos.0": { $exists: true } } },
        { $unwind: "$referralvideos" },
        { $sort: { "referralvideos.approvalDate": -1 } },
        { $limit: 10 },
        {
          $project: {
            customerName: "$name",
            action: {
              $concat: ["Uploaded referral video ", "$referralvideos.imageId"],
            },
            timestamp: "$referralvideos.approvalDate",
            type: { $literal: "video" },
          },
        },
      ]),
      // Get recent referrals
      Customer.aggregate([
        { $match: { "referredBy.dateReferred": { $exists: true } } },
        { $sort: { "referredBy.dateReferred": -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "customers",
            localField: "referredBy.referralCode",
            foreignField: "referralCode",
            as: "referrer",
          },
        },
        {
          $project: {
            customerName: { $arrayElemAt: ["$referrer.name", 0] },
            action: {
              $concat: ["Referred ", "$name"],
            },
            timestamp: "$referredBy.dateReferred",
            type: { $literal: "referral" },
          },
        },
      ]),
      // Get recent orders
      Customer.aggregate([
        { $match: { "orderHistory.0": { $exists: true } } },
        { $unwind: "$orderHistory" },
        { $sort: { "orderHistory.orderDate": -1 } },
        { $limit: 10 },
        {
          $project: {
            customerName: "$name",
            action: {
              $concat: [
                "Placed order ",
                "$orderHistory.orderId",
                " ($",
                { $toString: "$orderHistory.totalAmount" },
                ")",
              ],
            },
            timestamp: "$orderHistory.orderDate",
            type: { $literal: "order" },
          },
        },
      ]),
      // Get recent video shares
      Customer.aggregate([
        { $match: { "referralvideos.sharedWith.0": { $exists: true } } },
        { $unwind: "$referralvideos" },
        { $unwind: "$referralvideos.sharedWith" },
        { $sort: { "referralvideos.sharedWith.dateShared": -1 } },
        { $limit: 10 },
        {
          $project: {
            customerName: "$name",
            action: {
              $concat: ["Shared video with ", "$referralvideos.sharedWith.name"],
            },
            timestamp: "$referralvideos.sharedWith.dateShared",
            type: { $literal: "share" },
          },
        },
      ]),
      // Get recent "hi" replies
      Customer.aggregate([
        {
          $match: {
            $or: [
              { repliedWithHi: true },
              { "messageHistory.content": { $regex: /^hi$/i } },
            ],
          },
        },
        { $sort: { lastInteraction: -1 } },
        { $limit: 10 },
        {
          $project: {
            customerName: "$name",
            action: "Replied with 'Hi'",
            timestamp: "$lastInteraction",
            type: { $literal: "reply" },
          },
        },
      ])
    ]);

    // Combine all recent activity
    const recentActivity = [
      ...recentVideos,
      ...recentReferrals,
      ...recentOrders,
      ...recentShares,
      ...recentHiReplies
    ];

    // Sort all recent activity by timestamp
    recentActivity.sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    result.recentActivity = recentActivity.slice(0, 20);

    console.log(
      `Processed data for ${customerType} customers, period: ${period}, filter: ${filter}`
    );

    res.json({
      success: true,
      data: result,
      customerType,
      period,
      filter,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error fetching referral data:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching referral data",
      error: error.message,
    });
  }
});

// GET /api/referral-data/customer/:customerId - Get detailed referral data for specific customer
router.get("/customer/:customerId", async (req, res) => {
  try {
    const { customerId } = req.params;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Determine customer type
    const hasOrders = customer.orderHistory && customer.orderHistory.length > 0;
    const isReferred = !!(
      customer.referredBy && customer.referredBy.referralCode
    );
    const repliedWithHi =
      customer.repliedWithHi ||
      (customer.messageHistory &&
        customer.messageHistory.some(
          (msg) => msg.content && msg.content.toLowerCase().trim() === "hi"
        ));

    let customerType;
    if (isReferred && !hasOrders && repliedWithHi) {
      customerType = "referred_potential";
    } else if (isReferred && hasOrders) {
      customerType = "referred_existing";
    } else if (!hasOrders && repliedWithHi) {
      customerType = "all_potential";
    } else if (hasOrders) {
      customerType = "all_existing";
    } else {
      customerType = "unknown";
    }

    // Find people referred by this customer
    const referredCustomers = await Customer.find({
      "referredBy.referralCode": customer.referralCode,
    });

    // Find who referred this customer
    let referredBy = null;
    if (customer.referredBy && customer.referredBy.referralCode) {
      referredBy = await Customer.findOne({
        referralCode: customer.referredBy.referralCode,
      });
    }

    // Calculate detailed stats
    const videosUploaded = customer.referralvideos
      ? customer.referralvideos.length
      : 0;
    const totalShares = customer.referralvideos
      ? customer.referralvideos.reduce(
          (sum, video) =>
            sum + (video.sharedWith ? video.sharedWith.length : 0),
          0
        )
      : 0;

    const rewardsEarned = customer.referralRewards
      ? customer.referralRewards.reduce(
          (sum, reward) => sum + (reward.amount || 0),
          0
        )
      : 0;

    // Calculate order stats for existing customers
    let totalOrders = 0;
    let totalSpent = 0;
    let averageOrderValue = 0;
    if (customer.orderHistory && customer.orderHistory.length > 0) {
      totalOrders = customer.orderHistory.length;
      totalSpent = customer.orderHistory.reduce(
        (sum, order) => sum + (order.totalAmount || 0),
        0
      );
      averageOrderValue = totalSpent / totalOrders;
    }

    res.json({
      success: true,
      data: {
        customer: {
          _id: customer._id,
          name: customer.name,
          phoneNumber: customer.phoneNumber[0] || "",
          referralCode: customer.referralCode,
          customerType,
          isReferred,
          repliedWithHi,
          videosUploaded,
          totalShares,
          peopleReferred: referredCustomers.length,
          rewardsEarned,
          totalOrders,
          totalSpent,
          averageOrderValue,
          joinDate: customer.createdAt,
          lastActivity: customer.lastInteraction,
        },
        referredCustomers: referredCustomers.map((ref) => ({
          _id: ref._id,
          name: ref.name,
          phoneNumber: ref.phoneNumber[0] || "",
          dateReferred: ref.referredBy?.dateReferred,
          status: ref.referredBy?.status || "active",
          hasOrders: ref.orderHistory && ref.orderHistory.length > 0,
          repliedWithHi:
            ref.repliedWithHi ||
            (ref.messageHistory &&
              ref.messageHistory.some(
                (msg) =>
                  msg.content && msg.content.toLowerCase().trim() === "hi"
              )),
          totalSpent: ref.orderHistory
            ? ref.orderHistory.reduce(
                (sum, order) => sum + (order.totalAmount || 0),
                0
              )
            : 0,
        })),
        referredBy: referredBy
          ? {
              _id: referredBy._id,
              name: referredBy.name,
              phoneNumber: referredBy.phoneNumber[0] || "",
              referralCode: referredBy.referralCode,
              dateReferred: customer.referredBy?.dateReferred,
            }
          : null,
        videos: customer.referralvideos || [],
        rewards: customer.referralRewards || [],
        orders: customer.orderHistory || [],
        messageHistory: customer.messageHistory || [],
      },
    });
  } catch (error) {
    console.error("Error fetching customer referral data:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching customer referral data",
      error: error.message,
    });
  }
});

// GET /api/referral-data/analytics/summary - Get high-level analytics summary
router.get("/analytics/summary", async (req, res) => {
  try {
    const summary = await Customer.aggregate([
      {
        $facet: {
          // Total customers breakdown
          customerBreakdown: [
            {
              $group: {
                _id: null,
                totalCustomers: { $sum: 1 },
                referredPotentialCustomers: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              { $size: { $ifNull: ["$orderHistory", []] } },
                              0,
                            ],
                          },
                          { $ne: ["$referredBy.referralCode", null] },
                          {
                            $or: [
                              { $eq: ["$repliedWithHi", true] },
                              {
                                $in: [
                                  { $toLower: "$messageHistory.content" },
                                  ["hi"],
                                ],
                              },
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                referredExistingCustomers: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          {
                            $gt: [
                              { $size: { $ifNull: ["$orderHistory", []] } },
                              0,
                            ],
                          },
                          { $ne: ["$referredBy.referralCode", null] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                allPotentialCustomers: {
                  $sum: {
                    $cond: [
                      {
                        $and: [
                          {
                            $eq: [
                              { $size: { $ifNull: ["$orderHistory", []] } },
                              0,
                            ],
                          },
                          {
                            $or: [
                              { $eq: ["$repliedWithHi", true] },
                              {
                                $in: [
                                  { $toLower: "$messageHistory.content" },
                                  ["hi"],
                                ],
                              },
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                allExistingCustomers: {
                  $sum: {
                    $cond: [
                      {
                        $gt: [{ $size: { $ifNull: ["$orderHistory", []] } }, 0],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],

          // Referral stats
          referralStats: [
            {
              $group: {
                _id: null,
                customersWithReferralCode: {
                  $sum: {
                    $cond: [{ $ne: ["$referralCode", null] }, 1, 0],
                  },
                },
                customersWithVideos: {
                  $sum: {
                    $cond: [
                      {
                        $gt: [
                          { $size: { $ifNull: ["$referralvideos", []] } },
                          0,
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                customersWhoWereReferred: {
                  $sum: {
                    $cond: [{ $ne: ["$referredBy.referralCode", null] }, 1, 0],
                  },
                },
                customersWhoRepliedWithHi: {
                  $sum: {
                    $cond: [
                      {
                        $or: [
                          { $eq: ["$repliedWithHi", true] },
                          {
                            $in: [
                              { $toLower: "$messageHistory.content" },
                              ["hi"],
                            ],
                          },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
              },
            },
          ],

          // Top performing referrers
          topReferrers: [
            {
              $lookup: {
                from: "customers",
                let: { customerReferralCode: "$referralCode" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: [
                          "$referredBy.referralCode",
                          "$$customerReferralCode",
                        ],
                      },
                    },
                  },
                ],
                as: "referrals",
              },
            },
            {
              $addFields: {
                totalReferrals: { $size: "$referrals" },
              },
            },
            {
              $match: {
                totalReferrals: { $gt: 0 },
              },
            },
            {
              $sort: { totalReferrals: -1 },
            },
            {
              $limit: 5,
            },
            {
              $project: {
                name: 1,
                referralCode: 1,
                totalReferrals: 1,
                isReferred: {
                  $cond: [
                    { $ne: ["$referredBy.referralCode", null] },
                    true,
                    false,
                  ],
                },
              },
            },
          ],
        },
      },
    ]);

    res.json({
      success: true,
      summary: summary[0],
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error fetching analytics summary:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching analytics summary",
      error: error.message,
    });
  }
});

// GET /api/referral-data/trends - Get referral trends over time
router.get("/trends", async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysBack = parseInt(days);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const trends = await Customer.aggregate([
      {
        $facet: {
          // New customers trend by type
          newCustomers: [
            {
              $match: {
                createdAt: { $gte: startDate },
              },
            },
            {
              $group: {
                _id: {
                  date: {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$createdAt",
                    },
                  },
                  customerType: {
                    $switch: {
                      branches: [
                        {
                          case: {
                            $and: [
                              {
                                $eq: [
                                  { $size: { $ifNull: ["$orderHistory", []] } },
                                  0,
                                ],
                              },
                              { $ne: ["$referredBy.referralCode", null] },
                              {
                                $or: [
                                  { $eq: ["$repliedWithHi", true] },
                                  {
                                    $in: [
                                      { $toLower: "$messageHistory.content" },
                                      ["hi"],
                                    ],
                                  },
                                ],
                              },
                            ],
                          },
                          then: "referred_potential",
                        },
                        {
                          case: {
                            $and: [
                              {
                                $gt: [
                                  { $size: { $ifNull: ["$orderHistory", []] } },
                                  0,
                                ],
                              },
                              { $ne: ["$referredBy.referralCode", null] },
                            ],
                          },
                          then: "referred_existing",
                        },
                        {
                          case: {
                            $and: [
                              {
                                $eq: [
                                  { $size: { $ifNull: ["$orderHistory", []] } },
                                  0,
                                ],
                              },
                              {
                                $or: [
                                  { $eq: ["$repliedWithHi", true] },
                                  {
                                    $in: [
                                      { $toLower: "$messageHistory.content" },
                                      ["hi"],
                                    ],
                                  },
                                ],
                              },
                            ],
                          },
                          then: "all_potential",
                        },
                        {
                          case: {
                            $gt: [
                              { $size: { $ifNull: ["$orderHistory", []] } },
                              0,
                            ],
                          },
                          then: "all_existing",
                        },
                      ],
                      default: "other",
                    },
                  },
                },
                count: { $sum: 1 },
              },
            },
            {
              $sort: { "_id.date": 1 },
            },
          ],

          // Referral trend
          referrals: [
            {
              $match: {
                "referredBy.dateReferred": { $gte: startDate },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$referredBy.dateReferred",
                  },
                },
                count: { $sum: 1 },
              },
            },
            {
              $sort: { _id: 1 },
            },
          ],

          // Hi replies trend
          hiReplies: [
            {
              $match: {
                $or: [
                  { repliedWithHi: true },
                  { "messageHistory.content": { $regex: /^hi$/i } },
                ],
                lastInteraction: { $gte: startDate },
              },
            },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$lastInteraction",
                  },
                },
                count: { $sum: 1 },
              },
            },
            {
              $sort: { _id: 1 },
            },
          ],
        },
      },
    ]);

    res.json({
      success: true,
      trends: trends[0],
      period: `${daysBack} days`,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Error fetching trends:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching trends",
      error: error.message,
    });
  }
});

// POST /api/referral-data/update-hi-status - Update customer's "replied with hi" status
router.post("/update-hi-status", async (req, res) => {
  try {
    const { customerId, repliedWithHi } = req.body;

    if (!customerId || typeof repliedWithHi !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: customerId, repliedWithHi (boolean)",
      });
    }

    const customer = await Customer.findById(customerId);

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    // Update the replied with hi status
    customer.repliedWithHi = repliedWithHi;

    // Add to message history if not already present
    if (repliedWithHi) {
      if (!customer.messageHistory) {
        customer.messageHistory = [];
      }

      // Check if "hi" message already exists
      const hasHiMessage = customer.messageHistory.some(
        (msg) => msg.content && msg.content.toLowerCase().trim() === "hi"
      );

      if (!hasHiMessage) {
        customer.messageHistory.push({
          content: "hi",
          timestamp: new Date(),
          type: "reply",
          verified: true,
        });
      }
    }

    await customer.save();

    console.log(
      `Updated customer ${customerId} replied with hi status to: ${repliedWithHi}`
    );

    res.json({
      success: true,
      message: `Customer hi status updated successfully`,
      customer: {
        _id: customer._id,
        name: customer.name,
        repliedWithHi: customer.repliedWithHi,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.error("Error updating hi status:", error);
    res.status(500).json({
      success: false,
      message: "Error updating hi status",
      error: error.message,
    });
  }
});

// GET /api/referral-data/export - Export referral data to CSV
router.get("/export", async (req, res) => {
  try {
    const { customerType = "all", period = "all" } = req.query;

    // Calculate date filter
    const now = new Date();
    let dateFilter = {};

    switch (period) {
      case "today":
        const today = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        );
        dateFilter = { createdAt: { $gte: today } };
        break;
      case "week":
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - 7);
        dateFilter = { createdAt: { $gte: weekStart } };
        break;
      case "month":
        const monthStart = new Date(now);
        monthStart.setMonth(now.getMonth() - 1);
        dateFilter = { createdAt: { $gte: monthStart } };
        break;
      case "last3months":
        const last3MonthsStart = new Date(now);
        last3MonthsStart.setMonth(now.getMonth() - 3);
        dateFilter = { createdAt: { $gte: last3MonthsStart } };
        break;
      default:
        dateFilter = {}; // all time
    }

    // Build query based on customer type
    let query = dateFilter;

    if (customerType !== "all") {
      const typeFilter = getCustomerTypeFilter(customerType);
      query = { ...query, ...typeFilter };
    }

    const customers = await Customer.find(query).lean();

    // Format data for CSV export
    const csvData = customers.map((customer) => {
      const hasOrders =
        customer.orderHistory && customer.orderHistory.length > 0;
      const isReferred = !!(
        customer.referredBy && customer.referredBy.referralCode
      );
      const repliedWithHi =
        customer.repliedWithHi ||
        (customer.messageHistory &&
          customer.messageHistory.some(
            (msg) => msg.content && msg.content.toLowerCase().trim() === "hi"
          ));

      let customerType;
      if (isReferred && !hasOrders && repliedWithHi) {
        customerType = "Referred Potential";
      } else if (isReferred && hasOrders) {
        customerType = "Referred Existing";
      } else if (!hasOrders && repliedWithHi) {
        customerType = "All Potential";
      } else if (hasOrders) {
        customerType = "All Existing";
      } else {
        customerType = "Other";
      }

      return {
        Name: customer.name,
        Phone: customer.phoneNumber[0] || "",
        ReferralCode: customer.referralCode,
        CustomerType: customerType,
        IsReferred: isReferred ? "Yes" : "No",
        ReferredBy: customer.referredBy?.referralCode || "",
        RepliedWithHi: repliedWithHi ? "Yes" : "No",
        VideosUploaded: customer.referralvideos
          ? customer.referralvideos.length
          : 0,
        TotalOrders: customer.orderHistory ? customer.orderHistory.length : 0,
        TotalSpent: customer.orderHistory
          ? customer.orderHistory.reduce(
              (sum, order) => sum + (order.totalAmount || 0),
              0
            )
          : 0,
        JoinDate: customer.createdAt
          ? customer.createdAt.toISOString().split("T")[0]
          : "",
        LastActivity: customer.lastInteraction
          ? customer.lastInteraction.toISOString().split("T")[0]
          : "",
      };
    });

    res.json({
      success: true,
      data: csvData,
      count: csvData.length,
      exportDate: new Date(),
    });
  } catch (error) {
    console.error("Error exporting referral data:", error);
    res.status(500).json({
      success: false,
      message: "Error exporting referral data",
      error: error.message,
    });
  }
});

// GET /api/referral-data/averages - Get referral averages and metrics for charts
router.get("/averages", async (req, res) => {
  try {
    const { period = "all" } = req.query;

    console.log(`Fetching referral averages for period: ${period}`);

    // Calculate date ranges
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - 7);
    const monthStart = new Date(today);
    monthStart.setMonth(today.getMonth() - 1);
    const last3MonthsStart = new Date(today);
    last3MonthsStart.setMonth(today.getMonth() - 3);

    // Get date filter based on period
    const getDateFilter = (period) => {
      switch (period) {
        case "today":
          return { $gte: today };
        case "week":
          return { $gte: weekStart };
        case "month":
          return { $gte: monthStart };
        case "last3months":
          return { $gte: last3MonthsStart };
        default:
          return {}; // all time
      }
    };

    const dateFilter = getDateFilter(period);
    const createdAtFilter = Object.keys(dateFilter).length > 0 ? { createdAt: dateFilter } : {};

    // Get all customers for calculations
    const allCustomers = await Customer.find(createdAtFilter);
    
    // Get referred customers who made purchases
    const referredWithOrders = await Customer.find({
      ...createdAtFilter,
      "referredBy.referralCode": { $exists: true, $ne: null },
      "orderHistory.0": { $exists: true }
    });

    // Get referred customers who replied with Hi
    const referredWithHi = await Customer.find({
      ...createdAtFilter,
      "referredBy.referralCode": { $exists: true, $ne: null },
      $or: [
        { repliedWithHi: true },
        { "chatHistory.message": { $regex: /^hi$/i } }
      ]
    });

    // Get all referred customers
    const allReferred = await Customer.find({
      ...createdAtFilter,
      "referredBy.referralCode": { $exists: true, $ne: null }
    });

    // Get customers with videos
    const customersWithVideos = await Customer.find({
      ...createdAtFilter,
      "referralvideos.0": { $exists: true }
    });

    // Calculate averages
    let avgReferralsBeforeHi = 0;
    let avgReferralsBeforePurchase = 0;
    let avgDaysToFirstPurchase = 0;
    let avgHoursToHiResponse = 0;
    let avgVideoSharesPerCustomer = 0;
    let avgVideosPerCustomer = 0;

    // Calculate total video shares
    let totalShares = 0;
    let totalVideos = 0;
    customersWithVideos.forEach(customer => {
      if (customer.referralvideos) {
        totalVideos += customer.referralvideos.length;
        customer.referralvideos.forEach(video => {
          if (video.sharedWith) {
            totalShares += video.sharedWith.length;
          }
        });
      }
    });

    if (customersWithVideos.length > 0) {
      avgVideoSharesPerCustomer = Math.round((totalShares / customersWithVideos.length) * 10) / 10;
      avgVideosPerCustomer = Math.round((totalVideos / customersWithVideos.length) * 10) / 10;
    }

    // Calculate average days to first purchase
    let totalDaysToPurchase = 0;
    let purchaseCount = 0;
    referredWithOrders.forEach(customer => {
      if (customer.createdAt && customer.orderHistory && customer.orderHistory.length > 0) {
        // Find the earliest order
        const orders = customer.orderHistory.filter(o => o.orderId);
        if (orders.length > 0) {
          const createdDate = new Date(customer.createdAt);
          const now = new Date();
          const daysDiff = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
          totalDaysToPurchase += daysDiff;
          purchaseCount++;
        }
      }
    });

    if (purchaseCount > 0) {
      avgDaysToFirstPurchase = Math.round((totalDaysToPurchase / purchaseCount) * 10) / 10;
    }

    // Calculate average hours to Hi response (estimate based on createdAt to lastInteraction)
    let totalHoursToHi = 0;
    let hiCount = 0;
    referredWithHi.forEach(customer => {
      if (customer.createdAt && customer.lastInteraction) {
        const createdDate = new Date(customer.createdAt);
        const interactionDate = new Date(customer.lastInteraction);
        const hoursDiff = Math.floor((interactionDate - createdDate) / (1000 * 60 * 60));
        if (hoursDiff >= 0 && hoursDiff < 720) { // Within 30 days
          totalHoursToHi += hoursDiff;
          hiCount++;
        }
      }
    });

    if (hiCount > 0) {
      avgHoursToHiResponse = Math.round((totalHoursToHi / hiCount) * 10) / 10;
    }

    // Calculate referrals needed before actions
    // Count how many referrals each referrer made before their referred customers said hi or bought
    const referrers = await Customer.aggregate([
      { $match: { referralCode: { $exists: true, $ne: null } } },
      {
        $lookup: {
          from: "customers",
          let: { refCode: "$referralCode" },
          pipeline: [
            { $match: { $expr: { $eq: ["$referredBy.referralCode", "$$refCode"] } } }
          ],
          as: "referrals"
        }
      },
      {
        $addFields: {
          totalReferrals: { $size: "$referrals" },
          referralsWithHi: {
            $size: {
              $filter: {
                input: "$referrals",
                as: "ref",
                cond: { $eq: ["$$ref.repliedWithHi", true] }
              }
            }
          },
          referralsWithOrders: {
            $size: {
              $filter: {
                input: "$referrals",
                as: "ref",
                cond: { $gt: [{ $size: { $ifNull: ["$$ref.orderHistory", []] } }, 0] }
              }
            }
          }
        }
      },
      { $match: { totalReferrals: { $gt: 0 } } }
    ]);

    let totalReferralsBeforeHi = 0;
    let hiReferrersCount = 0;
    let totalReferralsBeforePurchase = 0;
    let purchaseReferrersCount = 0;

    referrers.forEach(referrer => {
      if (referrer.referralsWithHi > 0) {
        avgReferralsBeforeHi = referrer.totalReferrals / referrer.referralsWithHi;
        totalReferralsBeforeHi += avgReferralsBeforeHi;
        hiReferrersCount++;
      }
      if (referrer.referralsWithOrders > 0) {
        avgReferralsBeforePurchase = referrer.totalReferrals / referrer.referralsWithOrders;
        totalReferralsBeforePurchase += avgReferralsBeforePurchase;
        purchaseReferrersCount++;
      }
    });

    if (hiReferrersCount > 0) {
      avgReferralsBeforeHi = Math.round((totalReferralsBeforeHi / hiReferrersCount) * 10) / 10;
    }
    if (purchaseReferrersCount > 0) {
      avgReferralsBeforePurchase = Math.round((totalReferralsBeforePurchase / purchaseReferrersCount) * 10) / 10;
    }

    // Calculate conversion rates
    const totalReferredCustomers = allReferred.length;
    const referredWhoRepliedHi = referredWithHi.length;
    const referredWhoPurchased = referredWithOrders.length;

    const hiConversionRate = totalReferredCustomers > 0 
      ? Math.round((referredWhoRepliedHi / totalReferredCustomers) * 1000) / 10 
      : 0;
    
    const purchaseConversionRate = totalReferredCustomers > 0 
      ? Math.round((referredWhoPurchased / totalReferredCustomers) * 1000) / 10 
      : 0;

    const hiToPurchaseRate = referredWhoRepliedHi > 0
      ? Math.round((referredWhoPurchased / referredWhoRepliedHi) * 1000) / 10
      : 0;

    // Get chart data - trends over time (OPTIMIZED - reduced periods and parallel queries)
    const chartData = {
      referralsOverTime: [],
      conversionsOverTime: [],
      videosOverTime: []
    };

    // Reduce to max 7 periods for faster loading
    const periods = period === "today" ? 6 : 7;

    // Build date ranges first
    const dateRanges = [];
    for (let i = periods - 1; i >= 0; i--) {
      let startDate, endDate, label;
      
      if (period === "today") {
        startDate = new Date(today);
        startDate.setHours(today.getHours() - i * 4, 0, 0, 0); // 4-hour intervals
        endDate = new Date(startDate);
        endDate.setHours(startDate.getHours() + 4);
        label = `${startDate.getHours()}:00`;
      } else if (period === "week") {
        startDate = new Date(today);
        startDate.setDate(today.getDate() - i);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 1);
        label = startDate.toLocaleDateString('en-US', { weekday: 'short' });
      } else if (period === "month") {
        // Weekly intervals for monthly view
        startDate = new Date(today);
        startDate.setDate(today.getDate() - i * 4); // ~4 day intervals
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 4);
        label = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } else {
        // Monthly intervals for all-time
        startDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
        endDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
        label = startDate.toLocaleDateString('en-US', { month: 'short' });
      }
      dateRanges.push({ startDate, endDate, label });
    }

    // Run all chart queries in parallel
    const chartPromises = dateRanges.map(async ({ startDate, endDate, label }) => {
      const [referralsInPeriod, conversionsInPeriod, videosInPeriod] = await Promise.all([
        Customer.countDocuments({
          "referredBy.dateReferred": { $gte: startDate, $lt: endDate }
        }),
        Customer.countDocuments({
          "referredBy.referralCode": { $exists: true },
          "orderHistory.0": { $exists: true },
          createdAt: { $gte: startDate, $lt: endDate }
        }),
        Customer.countDocuments({
          "referralvideos.approvalDate": { $gte: startDate, $lt: endDate }
        })
      ]);
      return { label, referrals: referralsInPeriod, conversions: conversionsInPeriod, videos: videosInPeriod };
    });

    const chartResults = await Promise.all(chartPromises);
    chartResults.forEach(result => {
      chartData.referralsOverTime.push({ label: result.label, value: result.referrals });
      chartData.conversionsOverTime.push({ label: result.label, value: result.conversions });
      chartData.videosOverTime.push({ label: result.label, value: result.videos });
    });

    res.json({
      success: true,
      data: {
        // Core averages
        avgReferralsBeforeHi,
        avgReferralsBeforePurchase,
        avgDaysToFirstPurchase,
        avgHoursToHiResponse,
        avgVideoSharesPerCustomer,
        avgVideosPerCustomer,
        
        // Conversion rates
        hiConversionRate,
        purchaseConversionRate,
        hiToPurchaseRate,
        
        // Totals for context
        totalReferredCustomers,
        referredWhoRepliedHi,
        referredWhoPurchased,
        totalCustomersWithVideos: customersWithVideos.length,
        totalVideosUploaded: totalVideos,
        totalVideoShares: totalShares,
        
        // Chart data for visualizations
        chartData,
        
        // Sample size info
        sampleSize: allCustomers.length,
        period
      },
      timestamp: new Date()
    });

  } catch (error) {
    console.error("Error fetching referral averages:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching referral averages",
      error: error.message
    });
  }
});

module.exports = router;
