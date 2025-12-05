const mongoose = require('mongoose');
const Customer = require('./models/customer');
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

async function fixCartAndProduct() {
  try {
    console.log('🔧 Fixing cart and product...\n');
    
    // 1. Update the "wye tee" product to Small
    console.log('1️⃣ Updating "wye tee" product to Small package...');
    const product = await Product.findByIdAndUpdate(
      '6931a1ab01fac3da814c3d4a',
      { packageSize: 'Small' },
      { new: true }
    );
    
    if (product) {
      console.log(`   ✅ Updated: ${product.productName} → packageSize: ${product.packageSize}`);
    } else {
      console.log('   ❌ Product not found');
    }
    
    // 2. Clear the cart
    console.log('\n2️⃣ Clearing cart...');
    const customer = await Customer.findOne({ phoneNumber: '923312674909' });
    
    if (customer) {
      customer.cart.items = [];
      customer.cart.totalAmount = 0;
      customer.cart.deliveryType = undefined;
      await customer.save();
      console.log(`   ✅ Cart cleared for ${customer.name || 'customer'}`);
    } else {
      console.log('   ❌ Customer not found');
    }
    
    console.log('\n✅ Done! Now try adding products to cart again.\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixCartAndProduct();
