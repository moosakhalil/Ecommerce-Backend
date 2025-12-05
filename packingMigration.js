// migration-move-deliveryMedia-to-order-level.js
// ================================================
// This script moves deliveryMedia from items array to order level
// Run this ONCE to fix all existing customers in database

const mongoose = require("mongoose");
const Customer = require("./models/customer"); // Adjust path as needed

// MongoDB connection string - UPDATE THIS
const MONGODB_URI =
  "mongodb+srv://chatbiz50_db_user:hv2Lr5GNFG3vo0Mt@cluster0.m8czptr.mongodb.net/?appName=Cluster0";

async function migrateDeliveryMedia() {
  try {
    console.log("🔄 Starting deliveryMedia migration...");
    console.log("📊 Connecting to database...");

    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log("✅ Connected to database");

    // Find all customers
    const customers = await Customer.find({});
    console.log(`📦 Found ${customers.length} customers to check`);

    let updatedOrders = 0;
    let ordersWithMedia = 0;
    let customersUpdated = 0;

    for (let customer of customers) {
      let customerModified = false;

      for (let order of customer.shoppingHistory) {
        // Check if order already has deliveryMedia at order level
        if (order.deliveryMedia) {
          console.log(
            `✓ Order ${order.orderId} already has deliveryMedia at correct level`
          );
          continue;
        }

        // Initialize deliveryMedia object at order level
        order.deliveryMedia = {
          allMediaUploaded: false,
          allMediaVerified: false,
          hasCustomerComplaints: false,
        };

        // Check items for deliveryMedia
        let foundMediaInItems = false;

        if (order.items && order.items.length > 0) {
          for (let item of order.items) {
            // Check if this item has deliveryMedia
            if (item.deliveryMedia) {
              foundMediaInItems = true;
              console.log(
                `🔍 Found deliveryMedia in item for order ${order.orderId}`
              );

              // Copy all deliveryMedia fields from item to order level
              if (item.deliveryMedia.deliveryVideo) {
                order.deliveryMedia.deliveryVideo =
                  item.deliveryMedia.deliveryVideo;
                console.log(`   ✓ Moved deliveryVideo`);
              }

              if (item.deliveryMedia.complaintVideo) {
                order.deliveryMedia.complaintVideo =
                  item.deliveryMedia.complaintVideo;
                console.log(`   ✓ Moved complaintVideo`);
              }

              if (item.deliveryMedia.entrancePhoto) {
                order.deliveryMedia.entrancePhoto =
                  item.deliveryMedia.entrancePhoto;
                console.log(`   ✓ Moved entrancePhoto`);
              }

              if (item.deliveryMedia.receiptInHandPhoto) {
                order.deliveryMedia.receiptInHandPhoto =
                  item.deliveryMedia.receiptInHandPhoto;
                console.log(`   ✓ Moved receiptInHandPhoto`);
              }

              if (item.deliveryMedia.receiptCloseUpPhoto) {
                order.deliveryMedia.receiptCloseUpPhoto =
                  item.deliveryMedia.receiptCloseUpPhoto;
                console.log(`   ✓ Moved receiptCloseUpPhoto`);
              }

              if (item.deliveryMedia.receiptNextToFacePhoto) {
                order.deliveryMedia.receiptNextToFacePhoto =
                  item.deliveryMedia.receiptNextToFacePhoto;
                console.log(`   ✓ Moved receiptNextToFacePhoto`);
              }

              if (item.deliveryMedia.hasCustomerComplaints !== undefined) {
                order.deliveryMedia.hasCustomerComplaints =
                  item.deliveryMedia.hasCustomerComplaints;
              }

              if (item.deliveryMedia.complaintDescription) {
                order.deliveryMedia.complaintDescription =
                  item.deliveryMedia.complaintDescription;
              }

              if (item.deliveryMedia.allMediaUploaded !== undefined) {
                order.deliveryMedia.allMediaUploaded =
                  item.deliveryMedia.allMediaUploaded;
              }

              if (item.deliveryMedia.allMediaVerified !== undefined) {
                order.deliveryMedia.allMediaVerified =
                  item.deliveryMedia.allMediaVerified;
              }

              if (item.deliveryMedia.uploadCompletedAt) {
                order.deliveryMedia.uploadCompletedAt =
                  item.deliveryMedia.uploadCompletedAt;
              }

              if (item.deliveryMedia.verificationCompletedAt) {
                order.deliveryMedia.verificationCompletedAt =
                  item.deliveryMedia.verificationCompletedAt;
              }

              // Delete deliveryMedia from item
              delete item.deliveryMedia;
              console.log(`   🗑️  Removed deliveryMedia from item`);

              ordersWithMedia++;
            }
          }
        }

        if (foundMediaInItems) {
          updatedOrders++;
          customerModified = true;
        }
      }

      // Save customer if modified
      if (customerModified) {
        await customer.save();
        customersUpdated++;
        console.log(
          `💾 Saved customer ${customer.name} (${customer.phoneNumber[0]})`
        );
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ MIGRATION COMPLETED SUCCESSFULLY");
    console.log("=".repeat(60));
    console.log(`📊 Statistics:`);
    console.log(`   - Total customers checked: ${customers.length}`);
    console.log(`   - Customers updated: ${customersUpdated}`);
    console.log(`   - Orders with media migrated: ${ordersWithMedia}`);
    console.log(`   - Total orders updated: ${updatedOrders}`);
    console.log("=".repeat(60) + "\n");

    await mongoose.disconnect();
    console.log("👋 Disconnected from database");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the migration
migrateDeliveryMedia()
  .then(() => {
    console.log("🎉 Migration script finished");
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Fatal error:", error);
    process.exit(1);
  });
