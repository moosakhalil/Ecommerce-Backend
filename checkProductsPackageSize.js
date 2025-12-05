const mongoose = require('mongoose');
const Product = require('./models/Product');

// Connect to MongoDB (using the same connection as server.js)
mongoose.connect(
  process.env.MONGODB_URI ||
    "mongodb+srv://chatbiz50_db_user:hv2Lr5GNFG3vo0Mt@cluster0.m8czptr.mongodb.net/?appName=Cluster0",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }
);

async function checkProducts() {
  try {
    console.log('🔍 Fetching all products from database...\n');
    
    // Get all products
    const products = await Product.find({}).select('productName packageSize productType _id').limit(20);
    
    if (products.length === 0) {
      console.log('❌ No products found in database');
      process.exit(1);
    }
    
    console.log(`✅ Found ${products.length} products:\n`);
    console.log('═══════════════════════════════════════════════════════════');
    
    products.forEach((product, index) => {
      console.log(`${index + 1}. Product: ${product.productName}`);
      console.log(`   Type: ${product.productType}`);
      console.log(`   Package Size: ${product.packageSize || '❌ UNDEFINED (defaults to Large)'}`);
      console.log(`   ID: ${product._id}`);
      console.log('───────────────────────────────────────────────────────────');
    });
    
    // Check schema
    console.log('\n📋 Checking Product Schema for packageSize field...\n');
    const schema = Product.schema.paths.packageSize;
    if (schema) {
      console.log('✅ packageSize field EXISTS in schema');
      console.log(`   Type: ${schema.instance}`);
      console.log(`   Enum values: ${schema.enumValues || 'Not defined'}`);
      console.log(`   Required: ${schema.isRequired || false}`);
      console.log(`   Default: ${schema.defaultValue || 'No default'}`);
    } else {
      console.log('❌ packageSize field NOT FOUND in schema');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkProducts();
