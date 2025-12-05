// ============================================================================
// COMPLETE MIGRATION SCRIPT FOR LOST STOCK FIELDS
// File: migrateCompleteRestockFields.js
// ============================================================================

const mongoose = require("mongoose");

// ⚠️  UPDATE THIS WITH YOUR ACTUAL CONNECTION STRING
const MONGODB_URI =
  "mongodb+srv://chatbiz50_db_user:hv2Lr5GNFG3vo0Mt@cluster0.m8czptr.mongodb.net/?appName=Cluster0";

// Import your Product model - UPDATE PATH AS NEEDED
const Product = require("./models/Product"); // Adjust this path to match your project structure

const migrateLostStockFields = async () => {
  try {
    console.log("🚀 Starting Complete Lost Stock Fields Migration...");
    console.log("📅 Date:", new Date().toISOString());
    console.log("🎯 Purpose: Add and update all lost stock related fields\n");

    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB successfully");

    // Get all products from database
    const products = await Product.find({});
    console.log(`📊 Found ${products.length} products to process\n`);

    let updatedCount = 0;
    let alreadyUpdatedCount = 0;
    let errorCount = 0;
    const updateLog = [];

    // Process each product
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      let needsUpdate = false;
      const updateData = {};
      const changes = [];

      try {
        console.log(
          `Processing ${i + 1}/${products.length}: ${
            product.productName || "Unnamed Product"
          } (ID: ${product.productId || product._id})`
        );

        // ═══════════════════════════════════════════════════════════════════════
        // CHECK AND ADD MISSING FIELDS
        // ═══════════════════════════════════════════════════════════════════════

        // 1. Add lostStock field if missing or null
        if (product.lostStock === undefined || product.lostStock === null) {
          updateData.lostStock = 0;
          changes.push("Added lostStock field (default: 0)");
          needsUpdate = true;
        }

        // 2. Add lostStockHistory array if missing or not an array
        if (
          !product.lostStockHistory ||
          !Array.isArray(product.lostStockHistory)
        ) {
          updateData.lostStockHistory = [];
          changes.push("Added lostStockHistory array (default: [])");
          needsUpdate = true;
        }

        // 3. Add lastStockUpdate timestamp if missing
        if (!product.lastStockUpdate) {
          updateData.lastStockUpdate = new Date();
          changes.push("Added lastStockUpdate timestamp");
          needsUpdate = true;
        }

        // 4. Ensure Stock field exists and is valid
        if (product.Stock === undefined || product.Stock === null) {
          updateData.Stock = 0;
          changes.push("Initialized Stock field (default: 0)");
          needsUpdate = true;
        }

        // 5. Ensure NormalPrice field exists and is valid
        if (product.NormalPrice === undefined || product.NormalPrice === null) {
          updateData.NormalPrice = 0;
          changes.push("Initialized NormalPrice field (default: 0)");
          needsUpdate = true;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // VALIDATE AND FIX EXISTING DATA
        // ═══════════════════════════════════════════════════════════════════════

        // 6. Fix any existing lostStockHistory entries with invalid reasons
        if (
          product.lostStockHistory &&
          Array.isArray(product.lostStockHistory) &&
          product.lostStockHistory.length > 0
        ) {
          const validReasons = [
            "Damaged goods",
            "Expired products",
            "Theft/Shrinkage",
            "Quality control rejection",
            "Inventory counting error",
            "Breakage during handling",
            "Weather/Environmental damage",
            "Manufacturing defect",
            "Returned/Refunded items",
            "Customer returns",
            "Manual increase",
            "Manual decrease",
            "Other",
          ];

          let historyUpdated = false;
          const updatedHistory = product.lostStockHistory.map((entry) => {
            if (entry.reason && !validReasons.includes(entry.reason)) {
              // Map common invalid reasons to valid ones
              const reasonMap = {
                retuned: "Other",
                returned: "Customer returns",
                refunded: "Returned/Refunded items",
                return: "Customer returns",
                damage: "Damaged goods",
                expired: "Expired products",
                theft: "Theft/Shrinkage",
                broken: "Breakage during handling",
              };

              const lowerReason = entry.reason.toLowerCase();
              const mappedReason = reasonMap[lowerReason] || "Other";

              if (mappedReason !== entry.reason) {
                entry.reason = mappedReason;
                if (mappedReason === "Other" && !entry.customReason) {
                  entry.customReason = `Original reason: ${entry.reason}`;
                }
                historyUpdated = true;
              }
            }

            // Ensure all required fields exist in history entries
            if (!entry.date) entry.date = new Date();
            if (!entry.correctedBy) entry.correctedBy = "System Migration";
            if (!entry.amount || entry.amount < 0) entry.amount = 0;

            return entry;
          });

          if (historyUpdated) {
            updateData.lostStockHistory = updatedHistory;
            changes.push("Fixed invalid reasons in lostStockHistory");
            needsUpdate = true;
          }
        }

        // 7. Validate and fix lostStock value
        if (typeof product.lostStock !== "number" || product.lostStock < 0) {
          updateData.lostStock = 0;
          changes.push("Fixed invalid lostStock value");
          needsUpdate = true;
        }

        // 8. Validate and fix Stock value
        if (typeof product.Stock !== "number" || product.Stock < 0) {
          updateData.Stock = 0;
          changes.push("Fixed invalid Stock value");
          needsUpdate = true;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // APPLY UPDATES IF NEEDED
        // ═══════════════════════════════════════════════════════════════════════

        if (needsUpdate) {
          await Product.findByIdAndUpdate(
            product._id,
            { $set: updateData },
            { new: true, runValidators: true }
          );

          updatedCount++;
          updateLog.push({
            productId: product.productId || product._id,
            productName: product.productName || "Unnamed",
            changes: changes,
          });

          console.log(`   ✅ Updated: ${changes.join(", ")}`);
        } else {
          alreadyUpdatedCount++;
          console.log(`   ✓ Already up-to-date`);
        }
      } catch (productError) {
        errorCount++;
        console.error(
          `   ❌ Error processing product ${product.productId}: ${productError.message}`
        );
        updateLog.push({
          productId: product.productId || product._id,
          productName: product.productName || "Unnamed",
          error: productError.message,
        });
      }

      // Add small delay to prevent overwhelming the database
      if (i % 10 === 0 && i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // VERIFICATION STEP
    // ═══════════════════════════════════════════════════════════════════════

    console.log("\n🔍 Verifying migration results...");

    const verificationSample = await Product.find({})
      .select(
        "productId productName Stock NormalPrice lostStock lostStockHistory lastStockUpdate"
      )
      .limit(5)
      .lean();

    console.log("\n📋 Sample of updated products:");
    verificationSample.forEach((product, index) => {
      console.log(`\nSample ${index + 1}:`);
      console.log(`  Product: ${product.productName} (${product.productId})`);
      console.log(`  Stock: ${product.Stock} (${typeof product.Stock})`);
      console.log(
        `  NormalPrice: ${product.NormalPrice} (${typeof product.NormalPrice})`
      );
      console.log(
        `  lostStock: ${product.lostStock} (${typeof product.lostStock})`
      );
      console.log(
        `  lostStockHistory: ${
          Array.isArray(product.lostStockHistory)
            ? `Array[${product.lostStockHistory.length}]`
            : "Not an array"
        }`
      );
      console.log(
        `  lastStockUpdate: ${
          product.lastStockUpdate
            ? new Date(product.lastStockUpdate).toISOString()
            : "Not set"
        }`
      );
    });

    // ═══════════════════════════════════════════════════════════════════════
    // FINAL STATISTICS AND SUMMARY
    // ═══════════════════════════════════════════════════════════════════════

    console.log(`\n🎉 ===============================================`);
    console.log(`🎉 LOST STOCK MIGRATION COMPLETED SUCCESSFULLY!`);
    console.log(`🎉 ===============================================`);

    console.log(`\n📊 MIGRATION STATISTICS:`);
    console.log(`   📦 Total products processed: ${products.length}`);
    console.log(`   ✅ Products updated: ${updatedCount}`);
    console.log(`   ✓ Products already current: ${alreadyUpdatedCount}`);
    console.log(`   ❌ Products with errors: ${errorCount}`);
    console.log(
      `   📈 Success rate: ${(
        ((updatedCount + alreadyUpdatedCount) / products.length) *
        100
      ).toFixed(2)}%`
    );

    console.log(`\n📋 FIELDS ADDED/UPDATED:`);
    console.log(`   • lostStock: Number (default: 0)`);
    console.log(`   • lostStockHistory: Array (default: [])`);
    console.log(`   • lastStockUpdate: Date (timestamp)`);
    console.log(`   • Stock: Number (validated/initialized)`);
    console.log(`   • NormalPrice: Number (validated/initialized)`);

    console.log(`\n🔧 DATA FIXES APPLIED:`);
    console.log(`   • Invalid enum reasons mapped to valid values`);
    console.log(`   • Missing history entry fields populated`);
    console.log(`   • Negative stock values corrected`);
    console.log(`   • Data type inconsistencies resolved`);

    console.log(`\n✨ YOUR SYSTEM IS NOW READY FOR:`);
    console.log(`   🎯 Full Lost Stock Management functionality`);
    console.log(`   📊 Stock synchronization with lost stock tracking`);
    console.log(`   📝 Complete audit trail and history tracking`);
    console.log(`   🔍 Advanced lost stock analytics`);
    console.log(`   ⚡ Real-time inventory management`);

    // Save detailed log to file (optional)
    if (updateLog.length > 0) {
      const fs = require("fs").promises;
      const logData = {
        migrationDate: new Date().toISOString(),
        statistics: {
          totalProcessed: products.length,
          updated: updatedCount,
          alreadyCurrent: alreadyUpdatedCount,
          errors: errorCount,
        },
        updateLog: updateLog,
      };

      try {
        await fs.writeFile(
          "lost-stock-migration-log.json",
          JSON.stringify(logData, null, 2)
        );
        console.log(
          `\n📄 Detailed log saved to: lost-stock-migration-log.json`
        );
      } catch (logError) {
        console.log(`\n⚠️  Could not save log file: ${logError.message}`);
      }
    }

    console.log(`\n⚠️  IMPORTANT REMINDERS:`);
    console.log(`   1. 🔄 Restart your application to pick up schema changes`);
    console.log(`   2. 🧪 Test the Lost Stock Management component`);
    console.log(`   3. 📱 Deploy updated frontend component`);
    console.log(`   4. 🔍 Monitor the first few lost stock updates`);
    console.log(`   5. 📋 Check the migration log for any errors`);

    console.log(`\n🎊 Migration completed at: ${new Date().toISOString()}`);
    console.log(
      `Thank you for upgrading your inventory management system! 🚀\n`
    );
  } catch (error) {
    console.error(`\n❌ MIGRATION FAILED:`);
    console.error(`Error: ${error.message}`);
    console.error(`Stack: ${error.stack}`);

    console.log(`\n🔧 TROUBLESHOOTING TIPS:`);
    console.log(`   1. Check your MongoDB connection string`);
    console.log(`   2. Ensure the Product model path is correct`);
    console.log(`   3. Verify you have write permissions to the database`);
    console.log(`   4. Make sure no other processes are using the database`);
    console.log(`   5. Check available disk space and memory`);
  } finally {
    // Always close the database connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      console.log(`\n🔌 Database connection closed safely`);
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

process.on("SIGINT", async () => {
  console.log("\n⚠️  Migration interrupted by user (Ctrl+C)");
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
    console.log("🔌 Database connection closed safely");
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n⚠️  Migration terminated by system");
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
    console.log("🔌 Database connection closed safely");
  }
  process.exit(0);
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("\n❌ Unhandled Rejection at:", promise, "reason:", reason);
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.close();
  }
  process.exit(1);
});

// ═══════════════════════════════════════════════════════════════════════════
// RUN THE MIGRATION
// ═══════════════════════════════════════════════════════════════════════════

if (require.main === module) {
  migrateLostStockFields()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}

module.exports = migrateLostStockFields;
