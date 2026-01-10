// migrate-spam-to-not-passed.js
// Run this script BEFORE updating code: node scripts/migrate-spam-to-not-passed.js

const mongoose = require("mongoose");
require("dotenv").config();

const MONGODB_URI = process.env.MONGO_URI || "YOUR_CONNECTION_STRING";

async function migrate() {
  try {
    console.log("=".repeat(50));
    console.log("STATUS MIGRATION: spam → not_passed");
    console.log("=".repeat(50));
    console.log("\nConnecting to MongoDB...");
    
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected!\n");

    const db = mongoose.connection.db;
    const customers = db.collection("customers");

    // Count affected records before migration
    const beforeCount = await customers.countDocuments({
      "referralvideos.status": "spam"
    });
    console.log(`📊 Found ${beforeCount} customers with videos having status "spam"\n`);

    if (beforeCount === 0) {
      console.log("ℹ️  No records to migrate. Database is already updated or empty.");
      await mongoose.disconnect();
      console.log("Disconnected. Exiting.");
      process.exit(0);
    }

    // Migration 1: Update referralvideos.status from "spam" to "not_passed"
    console.log("🔄 Step 1: Migrating referralvideos.status...");
    const result1 = await customers.updateMany(
      { "referralvideos.status": "spam" },
      { $set: { "referralvideos.$[elem].status": "not_passed" } },
      { arrayFilters: [{ "elem.status": "spam" }] }
    );
    console.log(`   ✅ Updated ${result1.modifiedCount} customer documents\n`);

    // Migration 2: Update statusHistory entries
    console.log("🔄 Step 2: Migrating statusHistory entries...");
    const result2 = await customers.updateMany(
      { "referralvideos.statusHistory.status": "spam" },
      { $set: { "referralvideos.$[].statusHistory.$[hist].status": "not_passed" } },
      { arrayFilters: [{ "hist.status": "spam" }] }
    );
    console.log(`   ✅ Updated ${result2.modifiedCount} history entries\n`);

    // Verify no spam status remains
    const afterCount = await customers.countDocuments({
      "referralvideos.status": "spam"
    });
    
    console.log("=".repeat(50));
    if (afterCount === 0) {
      console.log("✅ MIGRATION SUCCESSFUL!");
      console.log("   No 'spam' status values remain in database.");
      console.log("   You can now update the code files safely.");
    } else {
      console.log(`⚠️  WARNING: ${afterCount} records still have 'spam' status`);
      console.log("   Please investigate before proceeding.");
    }
    console.log("=".repeat(50));

    await mongoose.disconnect();
    console.log("\n✅ Disconnected from MongoDB. Migration complete!");
    
  } catch (error) {
    console.error("\n❌ MIGRATION FAILED:", error.message);
    console.error("\nFull error:", error);
    process.exit(1);
  }
}

migrate();
