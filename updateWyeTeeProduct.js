const mongoose = require('mongoose');
const Product = require('./models/Product');

// Connect to MongoDB
mongoose.connect(
  process.env.MONGODB_URI ||
    "mongodb+srv://chatbiz50_db_user:hv2Lr5GNFG3vo0Mt@cluster0.m8czptr.mongodb.net/?appName=Cluster0",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true
  }
);

async function updateProduct() {
  try {
    console.log('🔍 Updating "wye tee" product...\n');
    
    // Update the specific product by ID
    const result = await Product.findByIdAndUpdate(
      '6931a1ab01fac3da814c3d4a',
      { packageSize: 'Small' },
      { new: true }
    );
    
    if (!result) {
      console.log('❌ Product not found');
      process.exit(1);
    }
    
    console.log('✅ Product updated successfully!');
    console.log(`   Product: ${result.productName}`);
    console.log(`   Package Size: ${result.packageSize}`);
    console.log(`   ID: ${result._id}\n`);
    
    console.log('🎯 Now try adding this product to cart in the chatbot!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

updateProduct();
