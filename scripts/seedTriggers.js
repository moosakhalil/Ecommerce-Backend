// scripts/seedTriggers.js - Seed all 15 trigger configurations
const mongoose = require("mongoose");
const TriggerConfiguration = require("../models/TriggerConfiguration");

const ALL_TRIGGERS = [
  // Core Triggers (1-5)
  {
    triggerName: "Referral Threshold - 5 Referrals",
    triggerType: "referral_threshold",
    description: "Send promotional message when customer receives 5+ referrals",
    isNew: false,
    isActive: true,
    configuration: {
      thresholdCount: 5,
      messageTemplate: "Hi {name}, you've been recommended by {count} friends! They trust us, and we'd love to serve you too. Use code {referralCode} for 10% off your first order.",
      cooldownDays: 30,
      executionSchedule: "hourly",
      targetAudience: {
        customerTypes: ["referred"],
        excludeOptedOut: true,
      },
    },
  },
  {
    triggerName: "Purchase Conversion Auto-Disable",
    triggerType: "purchase_conversion",
    description: "Automatically disable referral messages after first purchase",
    isNew: false,
    isActive: true,
    configuration: {
      messageTemplate: "Thank you for your first order! We hope you love your products.",
      executionSchedule: "realtime",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: false,
      },
    },
  },
  {
    triggerName: "30-Day Inactive Customer",
    triggerType: "inactive_customer",
    description: "Re-engage customers who haven't purchased in 30 days",
    isNew: false,
    isActive: true,
    configuration: {
      daysPeriod: 30,
      messageTemplate: "Hi {name}, we noticed it's been a while since your last order. We miss you! Here's 15% off your next purchase to welcome you back.",
      cooldownDays: 30,
      executionSchedule: "daily",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: true,
      },
    },
  },
  {
    triggerName: "60-Day Dormant Customer",
    triggerType: "dormant_customer",
    description: "Target customers with no activity for 60+ days",
    isNew: false,
    isActive: true,
    configuration: {
      daysPeriod: 60,
      messageTemplate: "Hi {name}, we haven't heard from you in a while. We'd love to have you back! Here's a special 20% discount code just for you, valid for 7 days.",
      cooldownDays: 60,
      executionSchedule: "daily",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: true,
      },
    },
  },
  {
    triggerName: "Global Referral Message Control",
    triggerType: "purchase_conversion",
    description: "Master control for all referral messaging system-wide",
    isNew: false,
    isActive: true,
    configuration: {
      messageTemplate: "System control trigger - no message sent",
      executionSchedule: "realtime",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: false,
      },
    },
  },

  // Additional Triggers (6-15)
  {
    triggerName: "24-Hour Abandoned Cart",
    triggerType: "abandoned_cart",
    description: "Remind customers about items left in cart after 24 hours",
    isNew: true,
    isActive: true,
    configuration: {
      daysPeriod: 1,
      messageTemplate: "Hi {name}, you left some items in your cart! Complete your order now and we'll include free delivery.",
      cooldownDays: 7,
      executionSchedule: "hourly",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: true,
      },
    },
  },
  {
    triggerName: "First Order Thank You",
    triggerType: "first_order_completion",
    description: "Thank new customers and encourage referrals",
    isNew: true,
    isActive: true,
    configuration: {
      messageTemplate: "Thank you for your first order, {name}! We hope you love your products. Share your experience with friends using your referral code {referralCode} and earn rewards on their purchases!",
      executionSchedule: "realtime",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: false,
      },
    },
  },
  {
    triggerName: "Loyalty Milestones",
    triggerType: "repeat_customer_milestone",
    description: "Reward customers at 5th, 10th, and 20th orders",
    isNew: true,
    isActive: true,
    configuration: {
      milestoneValues: [5, 10, 20, 50],
      messageTemplate: "Congratulations {name}! You've just placed your {milestone}th order with us. As a thank you, here's ${reward} credit added to your wallet for your next purchase. We appreciate your loyalty!",
      executionSchedule: "realtime",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: false,
      },
    },
  },
  {
    triggerName: "VIP Customer Upgrade",
    triggerType: "high_value_customer",
    description: "Grant VIP status when spending exceeds $500",
    isNew: true,
    isActive: true,
    configuration: {
      spendThreshold: 500,
      messageTemplate: "Hi {name}, you're now a VIP customer! You've unlocked exclusive benefits: priority customer service, early access to new products, and 5% discount on all future orders. Thank you for your continued trust!",
      executionSchedule: "realtime",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: false,
      },
    },
  },
  {
    triggerName: "Referral Commission Notification",
    triggerType: "referral_success",
    description: "Notify referrers when their referrals make purchases",
    isNew: true,
    isActive: true,
    configuration: {
      messageTemplate: "Great news {name}! Your referral {referredName} just made their first purchase. You've earned ${commission} commission added to your wallet. Keep sharing and earning!",
      executionSchedule: "realtime",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: false,
      },
    },
  },
  {
    triggerName: "Video Upload Reminder",
    triggerType: "video_upload_reminder",
    description: "Encourage customers to create referral videos",
    isNew: true,
    isActive: true,
    configuration: {
      daysPeriod: 7,
      messageTemplate: "Hi {name}! We noticed you haven't created your referral video yet. It only takes 2 minutes and helps you earn rewards when friends shop with us. Need help? Reply 'VIDEO' for tips!",
      cooldownDays: 14,
      executionSchedule: "daily",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: true,
      },
    },
  },
  {
    triggerName: "Seasonal Holiday Promotion",
    triggerType: "seasonal_promotion",
    description: "Send promotional messages during holiday periods",
    isNew: true,
    isActive: false,
    configuration: {
      messageTemplate: "Holiday Sale! Get 25% off everything this week only. Stock up on your favorites before the holiday rush. Shop now!",
      executionSchedule: "custom",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: true,
      },
    },
  },
  {
    triggerName: "Payment Receipt Reminder",
    triggerType: "payment_pending",
    description: "Remind customers to upload payment receipts",
    isNew: true,
    isActive: true,
    configuration: {
      daysPeriod: 0.08, // ~2 hours
      messageTemplate: "Hi {name}! We're holding your order but haven't received payment confirmation yet. Please upload your payment receipt to confirm your order. Need help? Reply 'PAYMENT' for instructions.",
      executionSchedule: "hourly",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: false,
      },
    },
  },
  {
    triggerName: "Delivery Reminder - Next Day",
    triggerType: "delivery_scheduled",
    description: "Remind customers about upcoming deliveries",
    isNew: true,
    isActive: true,
    configuration: {
      messageTemplate: "Your order will be delivered tomorrow {timeSlot}. Driver: {driverName} ({driverPhone}). Please ensure someone is available to receive the delivery. Track your order: {trackingLink}",
      executionSchedule: "daily",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: false,
      },
    },
  },
  {
    triggerName: "Post-Delivery Feedback Request",
    triggerType: "post_delivery_feedback",
    description: "Collect customer feedback after delivery",
    isNew: true,
    isActive: true,
    configuration: {
      daysPeriod: 1,
      messageTemplate: "How was your delivery experience? Rate your order and driver to help us improve. Reply with 1-5 stars: ⭐⭐⭐⭐⭐ Your feedback matters!",
      executionSchedule: "daily",
      targetAudience: {
        customerTypes: ["all"],
        excludeOptedOut: true,
      },
    },
  },
];

async function seedAllTriggers() {
  try {
    // Connect to MongoDB
    await mongoose.connect(
      process.env.MONGODB_URI ||
        "mongodb+srv://chatbiz50_db_user:hv2Lr5GNFG3vo0Mt@cluster0.m8czptr.mongodb.net/?appName=Cluster0",
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      }
    );

    console.log("✅ Connected to MongoDB");

    // Clear existing triggers
    await TriggerConfiguration.deleteMany({});
    console.log("🗑️  Cleared existing triggers");

    // Insert all 15 triggers
    for (const trigger of ALL_TRIGGERS) {
      await TriggerConfiguration.create(trigger);
      console.log(`✅ Created trigger: ${trigger.triggerName}`);
    }

    console.log("\n🎉 All triggers seeded successfully!");
    console.log(`📊 Total triggers in database: ${await TriggerConfiguration.countDocuments()}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding triggers:", error);
    process.exit(1);
  }
}

// Run the seed function
seedAllTriggers();
