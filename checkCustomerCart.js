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

async function checkCart() {
  try {
    console.log('🔍 Checking customer cart...\n');
    
    // Find customer with phone number
    const customer = await Customer.findOne({ phoneNumber: '923312674909' });
    
    if (!customer) {
      console.log('❌ Customer not found');
      process.exit(1);
    }
    
    console.log(`✅ Found customer: ${customer.name || 'No name'}`);
    console.log(`   Phone: ${customer.phoneNumber}`);
    
    if (!customer.cart || !customer.cart.items || customer.cart.items.length === 0) {
      console.log('❌ Cart is empty\n');
      process.exit(0);
    }
    
    console.log(`\n📦 Cart has ${customer.cart.items.length} items:\n`);
    console.log('═══════════════════════════════════════════════════════════');
    
    for (let i = 0; i < customer.cart.items.length; i++) {
      const item = customer.cart.items[i];
      console.log(`\nItem ${i + 1}:`);
      console.log(`   Product ID: ${item.productId}`);
      console.log(`   Quantity: ${item.quantity}`);
      
      // Look up the actual product
      const product = await Product.findById(item.productId);
      if (product) {
        console.log(`   ✅ Product Found: ${product.productName}`);
        console.log(`   📦 Package Size: ${product.packageSize || '❌ UNDEFINED (defaults to Large)'}`);
      } else {
        console.log(`   ❌ Product NOT FOUND in database`);
      }
    }
    
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('\n🚚 Cart Delivery Type:', customer.cart.deliveryType || 'Not set');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkCart();
