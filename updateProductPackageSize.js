const mongoose = require('mongoose');
const Product = require('./models/Product');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/ecommerce', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

async function updateProduct() {
  try {
    console.log('🔍 Searching for "wye tee" product...');
    
    // Find the product
    const product = await Product.findOne({ productName: /wye tee/i });
    
    if (!product) {
      console.log('❌ Product "wye tee" not found');
      process.exit(1);
    }
    
    console.log(`✅ Found product: ${product.productName}`);
    console.log(`   Current packageSize: ${product.packageSize || 'undefined'}`);
    console.log(`   Product ID: ${product._id}`);
    
    // Update the packageSize to Small
    product.packageSize = 'Small';
    await product.save();
    
    console.log(`✅ Updated packageSize to: ${product.packageSize}`);
    console.log('✅ Product updated successfully!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

updateProduct();
