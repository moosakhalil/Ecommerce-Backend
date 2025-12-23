// Sync all products' categories to the Category collection
const mongoose = require("mongoose");
const Product = require("./models/Product");
const Category = require("./models/Category");

const mongoURI = "mongodb+srv://chatbiz50_db_user:hv2Lr5GNFG3vo0Mt@cluster0.m8czptr.mongodb.net/?appName=Cluster0";

async function syncCategories() {
  try {
    console.log("🔄 Connecting to database...");
    await mongoose.connect(mongoURI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB");

    console.log("🔄 Fetching products...");
    const products = await Product.find({
      categories: { $exists: true, $ne: null, $ne: "" },
    }).select("categories subCategories productName").lean();

    console.log(`📦 Found ${products.length} products with categories`);

    const categoryMap = new Map();

    for (const product of products) {
      if (product.categories) {
        const categoryName = product.categories.trim();
        
        if (!categoryMap.has(categoryName)) {
          categoryMap.set(categoryName, new Set());
        }
        
        if (product.subCategories) {
          categoryMap.get(categoryName).add(product.subCategories.trim());
        }
      }
    }

    console.log(`📁 Found ${categoryMap.size} unique categories`);

    let created = 0;
    let updated = 0;

    for (const [categoryName, subcategories] of categoryMap) {
      let categoryDoc = await Category.findOne({ name: categoryName });
      
      if (!categoryDoc) {
        categoryDoc = new Category({
          name: categoryName,
          subcategories: Array.from(subcategories),
        });
        await categoryDoc.save();
        created++;
        console.log(`✅ Created category: "${categoryName}" with ${subcategories.size} subcategories`);
      } else {
        let isUpdated = false;
        for (const subCat of subcategories) {
          if (!categoryDoc.subcategories.includes(subCat)) {
            categoryDoc.subcategories.push(subCat);
            isUpdated = true;
          }
        }
        if (isUpdated) {
          await categoryDoc.save();
          updated++;
          console.log(`✅ Updated category: "${categoryName}"`);
        }
      }
    }

    console.log(`\n✅ Sync complete!`);
    console.log(`   Categories created: ${created}`);
    console.log(`   Categories updated: ${updated}`);
    console.log(`   Total categories: ${categoryMap.size}`);

    await mongoose.connection.close();
    console.log("Database connection closed");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

syncCategories();
