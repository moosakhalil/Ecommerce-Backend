// seedData.js - Run this once to populate your database with sample data
const mongoose = require("mongoose");
const Customer = require("./models/customer"); // Adjust path as needed

const sampleOrders = [
  {
    name: "Ahmed Hassan",
    phoneNumber: ["+971-50-123-4567"],
    email: "ahmed.hassan@email.com",
    shoppingHistory: [
      {
        orderId: "ORD-A01",
        orderDate: new Date("2025-07-25T10:00:00Z"),
        items: [
          {
            productId: "P001",
            productName: "Fresh Vegetables",
            category: "Produce",
            subCategory: "Vegetables",
            weight: "2kg",
            quantity: 2,
            unitPrice: 25.5,
            totalPrice: 51.0,
            isDiscountedProduct: false,
            onTruck: false,
          },
          {
            productId: "P002",
            productName: "Organic Fruits",
            category: "Produce",
            subCategory: "Fruits",
            weight: "1.5kg",
            quantity: 1,
            unitPrice: 35.75,
            totalPrice: 35.75,
            isDiscountedProduct: false,
            onTruck: false,
          },
        ],
        totalAmount: 156.75,
        deliveryCharge: 15.0,
        status: "on-way",
        paymentStatus: "paid",
        paymentMethod: "bank_transfer",
        deliveryOption: "Normal Delivery",
        deliveryLocation: "Sheikh Zayed",
        deliveryDate: new Date("2025-07-25T14:00:00Z"),
        timeSlot: "2:00 PM - 4:00 PM",
        deliveryType: "truck",
        deliverySpeed: "normal",
        deliveryAddress: {
          nickname: "Home",
          area: "Sheikh Zayed",
          fullAddress: "Sheikh Zayed Road, Building 12, Apt 305, Dubai",
          googleMapLink: "https://maps.google.com/...",
        },
        driver1: "Khalid R.",
        driver2: null,
        pickupType: "heavy-pickup",
        pickupAllocated: true,
        allocatedAt: new Date("2025-07-25T09:00:00Z"),
      },
    ],
    addresses: [
      {
        nickname: "Home",
        area: "Sheikh Zayed",
        fullAddress: "Sheikh Zayed Road, Building 12, Apt 305, Dubai",
        googleMapLink: "https://maps.google.com/...",
        isDefault: true,
      },
    ],
  },
  {
    name: "Fatima Ali",
    phoneNumber: ["+971-50-987-6543"],
    email: "fatima.ali@email.com",
    shoppingHistory: [
      {
        orderId: "ORD-A02",
        orderDate: new Date("2025-07-25T11:00:00Z"),
        items: [
          {
            productId: "P003",
            productName: "Dairy Products",
            category: "Dairy",
            subCategory: "Milk",
            weight: "1L",
            quantity: 3,
            unitPrice: 15.5,
            totalPrice: 46.5,
            isDiscountedProduct: false,
            onTruck: false,
          },
          {
            productId: "P004",
            productName: "Bread & Bakery",
            category: "Bakery",
            subCategory: "Bread",
            weight: "500g",
            quantity: 5,
            unitPrice: 8.25,
            totalPrice: 41.25,
            isDiscountedProduct: true,
            onTruck: false,
          },
        ],
        totalAmount: 234.5,
        deliveryCharge: 20.0,
        status: "order-pickuped-up",
        paymentStatus: "paid",
        paymentMethod: "bank_transfer",
        deliveryOption: "Speed Delivery",
        deliveryLocation: "Jumeirah",
        deliveryDate: new Date("2025-07-25T16:30:00Z"),
        timeSlot: "4:30 PM - 6:30 PM",
        deliveryType: "truck",
        deliverySpeed: "speed",
        deliveryAddress: {
          nickname: "Villa",
          area: "Jumeirah",
          fullAddress: "Jumeirah Beach Road, Villa 23, Dubai",
          googleMapLink: "https://maps.google.com/...",
        },
        driver1: "Ahmed S.",
        driver2: null,
        pickupType: "medium-pickup",
        pickupAllocated: true,
        allocatedAt: new Date("2025-07-25T10:30:00Z"),
      },
    ],
    addresses: [
      {
        nickname: "Villa",
        area: "Jumeirah",
        fullAddress: "Jumeirah Beach Road, Villa 23, Dubai",
        googleMapLink: "https://maps.google.com/...",
        isDefault: true,
      },
    ],
  },
  {
    name: "Omar Abdullah",
    phoneNumber: ["+971-50-555-7777"],
    email: "omar.abdullah@email.com",
    shoppingHistory: [
      {
        orderId: "ORD-A03",
        orderDate: new Date("2025-07-25T12:00:00Z"),
        items: [
          {
            productId: "P005",
            productName: "Meat Products",
            category: "Meat",
            subCategory: "Beef",
            weight: "1kg",
            quantity: 1,
            unitPrice: 98.25,
            totalPrice: 98.25,
            isDiscountedProduct: false,
            onTruck: false,
          },
        ],
        totalAmount: 98.25,
        deliveryCharge: 10.0,
        status: "allocated-driver",
        paymentStatus: "paid",
        paymentMethod: "bank_transfer",
        deliveryOption: "Normal Delivery",
        deliveryLocation: "Al Wasl",
        deliveryDate: new Date("2025-07-25T18:00:00Z"),
        timeSlot: "6:00 PM - 8:00 PM",
        deliveryType: "scooter",
        deliverySpeed: "normal",
        deliveryAddress: {
          nickname: "Office",
          area: "Al Wasl",
          fullAddress: "Al Wasl Road, Villa 45, Dubai",
          googleMapLink: "https://maps.google.com/...",
        },
        driver1: "Mohamed K.",
        driver2: null,
        pickupType: "light-pickup",
        pickupAllocated: true,
        allocatedAt: new Date("2025-07-25T11:30:00Z"),
      },
    ],
    addresses: [
      {
        nickname: "Office",
        area: "Al Wasl",
        fullAddress: "Al Wasl Road, Villa 45, Dubai",
        googleMapLink: "https://maps.google.com/...",
        isDefault: true,
      },
    ],
  },
  {
    name: "Aisha Mohamed",
    phoneNumber: ["+971-50-444-3333"],
    email: "aisha.mohamed@email.com",
    shoppingHistory: [
      {
        orderId: "ORD-A04",
        orderDate: new Date("2025-07-25T13:00:00Z"),
        items: [
          {
            productId: "P006",
            productName: "Beverages",
            category: "Drinks",
            subCategory: "Juices",
            weight: "2L",
            quantity: 4,
            unitPrice: 12.5,
            totalPrice: 50.0,
            isDiscountedProduct: false,
            onTruck: false,
          },
          {
            productId: "P007",
            productName: "Frozen Foods",
            category: "Frozen",
            subCategory: "Vegetables",
            weight: "500g",
            quantity: 6,
            unitPrice: 22.98,
            totalPrice: 137.9,
            isDiscountedProduct: false,
            onTruck: false,
          },
        ],
        totalAmount: 187.9,
        deliveryCharge: 15.0,
        status: "order-confirmed",
        paymentStatus: "paid",
        paymentMethod: "bank_transfer",
        deliveryOption: "Normal Delivery",
        deliveryLocation: "Business Bay",
        deliveryDate: new Date("2025-07-26T10:00:00Z"),
        timeSlot: "10:00 AM - 12:00 PM",
        deliveryType: "truck",
        deliverySpeed: "normal",
        deliveryAddress: {
          nickname: "Office",
          area: "Business Bay",
          fullAddress: "Business Bay, Executive Tower, Office 1205",
          googleMapLink: "https://maps.google.com/...",
        },
        driver1: "John D.",
        driver2: null,
        pickupType: "heavy-pickup",
        pickupAllocated: false,
        adminReason: "Ring doorbell twice",
      },
    ],
    addresses: [
      {
        nickname: "Office",
        area: "Business Bay",
        fullAddress: "Business Bay, Executive Tower, Office 1205",
        googleMapLink: "https://maps.google.com/...",
        isDefault: true,
      },
    ],
  },
  {
    name: "Hassan Ali",
    phoneNumber: ["+971-50-777-6666"],
    email: "hassan.ali@email.com",
    shoppingHistory: [
      {
        orderId: "ORD-A05",
        orderDate: new Date("2025-07-25T14:00:00Z"),
        items: [
          {
            productId: "P008",
            productName: "Condiments",
            category: "Pantry",
            subCategory: "Spices",
            weight: "200g",
            quantity: 7,
            unitPrice: 20.8,
            totalPrice: 145.6,
            isDiscountedProduct: false,
            onTruck: false,
          },
        ],
        totalAmount: 145.6,
        deliveryCharge: 12.0,
        status: "order-confirmed",
        paymentStatus: "pending",
        paymentMethod: "bank_transfer",
        deliveryOption: "Speed Delivery",
        deliveryLocation: "Marina",
        deliveryDate: new Date("2025-07-26T12:00:00Z"),
        timeSlot: "12:00 PM - 2:00 PM",
        deliveryType: "truck",
        deliverySpeed: "speed",
        deliveryAddress: {
          nickname: "Apartment",
          area: "Marina",
          fullAddress: "Marina Walk, Cayan Tower, Apt 2105",
          googleMapLink: "https://maps.google.com/...",
        },
        driver1: null,
        driver2: null,
        pickupType: "medium-pickup",
        pickupAllocated: false,
        adminReason: "Call before delivery",
      },
    ],
    addresses: [
      {
        nickname: "Apartment",
        area: "Marina",
        fullAddress: "Marina Walk, Cayan Tower, Apt 2105",
        googleMapLink: "https://maps.google.com/...",
        isDefault: true,
      },
    ],
  },
  {
    name: "Layla Ahmed",
    phoneNumber: ["+971-50-888-9999"],
    email: "layla.ahmed@email.com",
    shoppingHistory: [
      {
        orderId: "ORD-A06",
        orderDate: new Date("2025-07-25T15:00:00Z"),
        items: [
          {
            productId: "P009",
            productName: "Fresh Vegetables",
            category: "Produce",
            subCategory: "Mixed",
            weight: "3kg",
            quantity: 6,
            unitPrice: 28.5,
            totalPrice: 171.0,
            isDiscountedProduct: false,
            onTruck: false,
          },
          {
            productId: "P010",
            productName: "Organic Fruits",
            category: "Produce",
            subCategory: "Fruits",
            weight: "2kg",
            quantity: 3,
            unitPrice: 32.1,
            totalPrice: 96.3,
            isDiscountedProduct: false,
            onTruck: false,
          },
        ],
        totalAmount: 267.3,
        deliveryCharge: 18.0,
        status: "ready to pickup",
        paymentStatus: "paid",
        paymentMethod: "bank_transfer",
        deliveryOption: "Normal Delivery",
        deliveryLocation: "Downtown",
        deliveryDate: new Date("2025-07-26T14:30:00Z"),
        timeSlot: "2:30 PM - 4:30 PM",
        deliveryType: "truck",
        deliverySpeed: "normal",
        deliveryAddress: {
          nickname: "Residence",
          area: "Downtown",
          fullAddress: "Downtown Dubai, Burj Khalifa Residences",
          googleMapLink: "https://maps.google.com/...",
        },
        driver1: "Sarah K.",
        driver2: null,
        pickupType: "heavy-pickup",
        pickupAllocated: true,
        allocatedAt: new Date("2025-07-25T14:00:00Z"),
        adminReason: "Fragile items - handle with care",
      },
    ],
    addresses: [
      {
        nickname: "Residence",
        area: "Downtown",
        fullAddress: "Downtown Dubai, Burj Khalifa Residences",
        googleMapLink: "https://maps.google.com/...",
        isDefault: true,
      },
    ],
  },
];

async function seedDatabase() {
  try {
    console.log("🌱 Starting database seeding...");

    // Connect to MongoDB if not already connected
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(
        "mongodb+srv://chatbiz50_db_user:hv2Lr5GNFG3vo0Mt@cluster0.m8czptr.mongodb.net/?appName=Cluster0",
        {
          useNewUrlParser: true,
          useUnifiedTopology: true,
        }
      );
      console.log("📡 Connected to MongoDB");
    }

    // Clear existing test data (optional)
    const existingTestOrders = await Customer.find({
      "shoppingHistory.orderId": {
        $in: ["ORD-A01", "ORD-A02", "ORD-A03", "ORD-A04", "ORD-A05", "ORD-A06"],
      },
    });

    if (existingTestOrders.length > 0) {
      console.log(
        `🗑️  Found ${existingTestOrders.length} existing test customers. Removing...`
      );
      await Customer.deleteMany({
        "shoppingHistory.orderId": {
          $in: [
            "ORD-A01",
            "ORD-A02",
            "ORD-A03",
            "ORD-A04",
            "ORD-A05",
            "ORD-A06",
          ],
        },
      });
    }

    // Insert sample data
    console.log("📦 Inserting sample orders...");
    const insertedCustomers = await Customer.insertMany(sampleOrders);

    console.log(
      `✅ Successfully seeded ${insertedCustomers.length} customers with orders!`
    );

    // Verify data
    const verification = await Customer.aggregate([
      { $unwind: "$shoppingHistory" },
      {
        $group: {
          _id: "$shoppingHistory.status",
          count: { $sum: 1 },
        },
      },
    ]);

    console.log("📊 Order status distribution:");
    verification.forEach((status) => {
      console.log(`   ${status._id}: ${status.count} orders`);
    });

    console.log("\n🎉 Database seeding completed successfully!");
    console.log(
      "🚀 You can now test your delivery management system with real data."
    );
  } catch (error) {
    console.error("❌ Error seeding database:", error);
  }
}

// Additional utility function to add more test orders
async function addMoreTestOrders() {
  const additionalOrders = [
    {
      name: "Mohammad Khalil",
      phoneNumber: ["+971-50-111-2222"],
      email: "mohammad.khalil@email.com",
      shoppingHistory: [
        {
          orderId: "ORD-A07",
          orderDate: new Date(),
          items: [
            {
              productId: "P011",
              productName: "Cleaning Supplies",
              category: "Household",
              subCategory: "Cleaning",
              weight: "1.5kg",
              quantity: 4,
              unitPrice: 25.75,
              totalPrice: 103.0,
              isDiscountedProduct: false,
              onTruck: false,
            },
          ],
          totalAmount: 103.0,
          deliveryCharge: 10.0,
          status: "picking-order",
          paymentStatus: "paid",
          paymentMethod: "cash",
          deliveryOption: "Normal Delivery",
          deliveryLocation: "Deira",
          deliveryDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Tomorrow
          timeSlot: "Morning",
          deliveryType: "scooter",
          deliverySpeed: "normal",
          deliveryAddress: {
            nickname: "Home",
            area: "Deira",
            fullAddress: "Deira City Centre, Block A, Apt 808",
            googleMapLink: "https://maps.google.com/...",
          },
          driver1: null,
          driver2: null,
          pickupType: "scooter",
          pickupAllocated: false,
        },
      ],
    },
  ];

  try {
    await Customer.insertMany(additionalOrders);
    console.log("✅ Added more test orders successfully!");
  } catch (error) {
    console.error("❌ Error adding test orders:", error);
  }
}

// Export functions for use
module.exports = {
  seedDatabase,
  addMoreTestOrders,
  sampleOrders,
};

// Run seeder if called directly
if (require.main === module) {
  seedDatabase()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
}
