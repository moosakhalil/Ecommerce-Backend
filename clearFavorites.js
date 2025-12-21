const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Product = require('./models/Product');

// Load environment variables
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/ecommerce';

console.log('Connecting to:', MONGO_URI.replace(/:([^:@]+)@/, ':****@')); // Hide password

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Check how many have favorites set before
    const countBefore = await Product.countDocuments({ selectedSupplierId: { $ne: null } });
    console.log(`Found ${countBefore} products with favorites set.`);

    if (countBefore > 0) {
      const result = await Product.updateMany(
        { selectedSupplierId: { $ne: null } },
        { 
          $set: { 
            selectedSupplierId: null, 
            supplierName: null, 
            supplierContact: null, 
            supplierEmail: null, 
            supplierAddress: null 
          } 
        }
      );
      console.log('Successfully unselected favorites for', result.modifiedCount, 'products');
    } else {
      console.log('No products to update.');
    }
    
    mongoose.disconnect();
  })
  .catch(err => {
    console.error('Database Error:', err);
    mongoose.disconnect();
  });
