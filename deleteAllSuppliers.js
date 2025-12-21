const mongoose = require('mongoose');
const Supplier = require('./models/supplier');

// MongoDB connection string (same as used in server.js - MongoDB Atlas)
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://chatbiz50_db_user:hv2Lr5GNFG3vo0Mt@cluster0.m8czptr.mongodb.net/?appName=Cluster0';

async function deleteAllSuppliers() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Count suppliers before deletion
    const countBefore = await Supplier.countDocuments();
    console.log(`Found ${countBefore} suppliers in database`);

    if (countBefore === 0) {
      console.log('No suppliers to delete.');
      await mongoose.connection.close();
      return;
    }

    // Delete all suppliers
    const result = await Supplier.deleteMany({});
    console.log(`Successfully deleted ${result.deletedCount} suppliers`);

    // Verify deletion
    const countAfter = await Supplier.countDocuments();
    console.log(`Suppliers remaining: ${countAfter}`);

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

deleteAllSuppliers();
