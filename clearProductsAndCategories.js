const mongoose = require('mongoose');
const Product = require('./models/Product');
const Category = require('./models/Category');

// MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://chatbiz50_db_user:hv2Lr5GNFG3vo0Mt@cluster0.m8czptr.mongodb.net/?appName=Cluster0';

async function clearProductsAndCategories() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // === DELETE PRODUCTS ===
    const productCount = await Product.countDocuments();
    console.log(`📦 Found ${productCount} products in database`);

    if (productCount > 0) {
      const productResult = await Product.deleteMany({});
      console.log(`🗑️  Deleted ${productResult.deletedCount} products`);
    } else {
      console.log('ℹ️  No products to delete');
    }

    // === DELETE CATEGORIES ===
    const categoryCount = await Category.countDocuments();
    console.log(`\n📁 Found ${categoryCount} categories in database`);

    if (categoryCount > 0) {
      const categoryResult = await Category.deleteMany({});
      console.log(`🗑️  Deleted ${categoryResult.deletedCount} categories`);
    } else {
      console.log('ℹ️  No categories to delete');
    }

    // === VERIFY ===
    console.log('\n--- Verification ---');
    const remainingProducts = await Product.countDocuments();
    const remainingCategories = await Category.countDocuments();
    console.log(`Products remaining: ${remainingProducts}`);
    console.log(`Categories remaining: ${remainingCategories}`);

    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
    console.log('✅ Cleanup complete! Ready for fresh import.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

clearProductsAndCategories();
