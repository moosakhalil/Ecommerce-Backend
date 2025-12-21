const mongoose = require('mongoose');
const Product = require('./models/Product');

// MongoDB connection string (same as used in server.js - MongoDB Atlas)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://chatbiz50_db_user:hv2Lr5GNFG3vo0Mt@cluster0.m8czptr.mongodb.net/?appName=Cluster0';

async function deleteAllProducts() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Count products before deletion
    const countBefore = await Product.countDocuments();
    console.log(`Found ${countBefore} products in database`);

    if (countBefore === 0) {
      console.log('No products to delete.');
      await mongoose.connection.close();
      return;
    }

    // Delete all products
    const result = await Product.deleteMany({});
    console.log(`Successfully deleted ${result.deletedCount} products`);

    // Verify deletion
    const countAfter = await Product.countDocuments();
    console.log(`Products remaining: ${countAfter}`);

    await mongoose.connection.close();
    console.log('Database connection closed');
    
  } catch (error) {
    console.error('Error:', error.message);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

deleteAllProducts();
