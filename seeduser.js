// initializeSuperAdmin.js - Complete setup for super admin, roles, and permissions
const mongoose = require("mongoose");
const { User } = require("./models/User");
const { Role } = require("./models/Role");
const { Permission } = require("./models/Permission");

// MongoDB connection string - UPDATE THIS WITH YOUR CONNECTION STRING
const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb+srv://chatbiz50_db_user:hv2Lr5GNFG3vo0Mt@cluster0.m8czptr.mongodb.net/?appName=Cluster0";

// Component structure - same as in your admin routes
const componentCategories = {
  operations: {
    title: "Operations Management",
    components: [
      {
        id: "1",
        number: "1.",
        name: "Orders to cart not ordered yet",
        path: "/ordersINcart",
      },
      {
        id: "2",
        number: "2.",
        name: "Transaction control... paid / or not",
        path: "/Transactions-control",
      },
      { id: "3", number: "3.", name: "All Orders", path: "/all-orders" },
      {
        id: "4",
        number: "4.",
        name: "Order management delivery",
        path: "/delivery-orders",
      },
      { id: "5", number: "5.", name: "Delivery", path: "/Delivery" },
      {
        id: "6",
        number: "6.",
        name: "Non-delivered orders or issues",
        path: "/non-delivered-orders",
      },
      {
        id: "7",
        number: "7.",
        name: "Refund / complain",
        path: "/view-refunds",
      },
      {
        id: "8",
        number: "8.",
        name: "History orders",
        path: "/all-orders",
      },
    ],
  },
  inventory: {
    title: "Stock & Inventory",
    components: [
      {
        id: "28",
        number: "31.",
        name: "Product list everyone",
        path: "/admin/Products",
      },
      {
        id: "33",
        number: "33.",
        name: "Inventory check",
        path: "/inventory-check",
      },
      {
        id: "35",
        number: "35.",
        name: "Out of Stock...order stock",
        path: "/out-of-stock",
      },
      {
        id: "36",
        number: "36.",
        name: "Sales data for products",
        path: "/sales-data",
      },
      {
        id: "37",
        number: "37.",
        name: "Lost Stock Management",
        path: "/lost-stock",
      },
    ],
  },
  stock2: {
    title: "Stock Management 2",
    components: [
      {
        id: "61",
        number: "51.",
        name: "Create a new product",
        path: "/add-product",
      },
      {
        id: "54",
        number: "54.",
        name: "Fill inventory",
        path: "/Fill-inventory",
      },
      {
        id: "55",
        number: "55.",
        name: "Inventory control",
        path: "/inventory-control",
      },
      {
        id: "56",
        number: "56.",
        name: "Categories",
        path: "/add-category",
      },
    ],
  },
  discount: {
    title: "Discount Management",
    components: [
      {
        id: "71",
        number: "71.",
        name: "Create discount",
        path: "/create-discount",
      },
      {
        id: "72",
        number: "72.",
        name: "All Discount list",
        path: "/all-discounts",
      },
      {
        id: "73",
        number: "73.",
        name: "Discounted product inventory",
        path: "/discount-inventory",
      },
      {
        id: "74",
        number: "74.",
        name: "Discount policies action",
        path: "/discount-policies",
      },
    ],
  },
  suppliers: {
    title: "Suppliers, Employees & Customers",
    components: [
      {
        id: "81",
        number: "81.",
        name: "Suppliers",
        path: "/view-suppliers",
      },
      {
        id: "82",
        number: "82.",
        name: "employees",
        path: "/all-employees",
      },
      { id: "83", number: "83.", name: "Customers", path: "/customers" },
    ],
  },
  history: {
    title: "History",
    components: [
      {
        id: "90",
        number: "90.",
        name: "History orders supplier",
        path: "/supplier-history",
      },
    ],
  },
  finance: {
    title: "Finance & Analytics",
    components: [
      { id: "101", number: "101.", name: "Finances", path: "/finances" },
      {
        id: "105",
        number: "105.",
        name: "ANALYTICS",
        path: "/analytics",
      },
    ],
  },
  admin: {
    title: "Lower Admin",
    components: [
      {
        id: "admin-lower",
        number: "1.",
        name: "lower admin",
        path: "/admin/lower",
      },
      {
        id: "admin-drivers",
        number: "2.",
        name: "truck drivers",
        path: "/admin/drivers",
      },
      {
        id: "admin-employee-add",
        number: "3a.",
        name: "employee - add",
        path: "/admin/employee/add",
      },
      {
        id: "admin-employee-edit",
        number: "3b.",
        name: "employee - edit",
        path: "/admin/employee/edit",
      },
      {
        id: "admin-supplier-add",
        number: "4a.",
        name: "supplier - add",
        path: "/admin/supplier/add",
      },
      {
        id: "admin-supplier-edit",
        number: "4b.",
        name: "supplier - edit",
        path: "/admin/supplier/edit",
      },
      {
        id: "admin-customer-edit",
        number: "5a.",
        name: "customer - edit",
        path: "/admin/customer/edit",
      },
      {
        id: "admin-products",
        number: "6.",
        name: "Products",
        path: "/admin/Products",
      },
    ],
  },
  referrals: {
    title: "Referrals",
    components: [
      {
        id: "150",
        number: "150.",
        name: "Referrals video verification",
        path: "/referrals",
      },
      {
        id: "151",
        number: "151.",
        name: "Referrals data",
        path: "/referrals-data",
      },
      {
        id: "155",
        number: "155.",
        name: "Referrals foreman income",
        path: "/referals-foreman",
      },
    ],
  },
  foreman: {
    title: "Foreman",
    components: [
      {
        id: "160",
        number: "160.",
        name: "from human earning structure",
        path: "/foreman-earnings",
      },
    ],
  },
  settings: {
    title: "Settings & Support",
    components: [
      { id: "calendar", number: "", name: "Calendar", path: "/calendar" },
      { id: "support", number: "", name: "Support", path: "/support" },
    ],
  },
};

async function initializeSuperAdmin() {
  try {
    console.log("🚀 STARTING SUPER ADMIN INITIALIZATION...\n");

    // Connect to MongoDB
    if (mongoose.connection.readyState !== 1) {
      console.log("📡 Connecting to MongoDB...");
      await mongoose.connect(MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log("✅ Connected to MongoDB\n");
    }

    // Get all component IDs for super admin access
    const allComponentIds = [];
    const allCategoryKeys = [];

    for (const [categoryKey, categoryData] of Object.entries(
      componentCategories
    )) {
      allCategoryKeys.push(categoryKey);
      for (const component of categoryData.components) {
        allComponentIds.push(component.id);
      }
    }

    // ============================================================================
    // STEP 1: CREATE SUPER ADMIN USER FIRST (without role reference initially)
    // ============================================================================
    console.log("📋 STEP 1: Creating super admin user...");

    let superAdminUser = await User.findOne({ username: "admin12" });

    if (!superAdminUser) {
      // Create user without role first (we'll add role after creating the role)
      superAdminUser = new User({
        username: "admin12",
        email: "admin@system.com",
        password: "admin12", // Will be hashed by pre-save hook
        name: "System Administrator",
        role: new mongoose.Types.ObjectId(), // Temporary placeholder
        status: "active",
        permissions: [],
        createdBy: null,
      });

      await superAdminUser.save();
      console.log("✅ Super admin user created (role pending)\n");
    } else {
      console.log("ℹ️  Super admin user already exists\n");
    }

    // ============================================================================
    // STEP 2: CREATE SUPER ADMIN ROLE WITH USER REFERENCE
    // ============================================================================
    console.log("📋 STEP 2: Creating super admin role...");

    let superAdminRole = await Role.findOne({ name: "super_admin" });

    if (!superAdminRole) {
      superAdminRole = await Role.create({
        name: "super_admin",
        displayName: "Super Administrator",
        description:
          "Full system access - can manage all operations, users, roles, and permissions",
        components: allComponentIds,
        categories: allCategoryKeys,
        isSystemRole: true,
        isActive: true,
        priority: 1000,
        createdBy: superAdminUser._id, // NOW we have the user ID
        lastModifiedBy: superAdminUser._id,
      });

      console.log("✅ Super admin role created\n");
    } else {
      console.log(
        "ℹ️  Super admin role already exists, updating components..."
      );
      superAdminRole.components = allComponentIds;
      superAdminRole.categories = allCategoryKeys;
      superAdminRole.createdBy = superAdminUser._id;
      superAdminRole.lastModifiedBy = superAdminUser._id;
      await superAdminRole.save();
      console.log("✅ Super admin role updated\n");
    }

    // ============================================================================
    // STEP 3: UPDATE USER WITH ROLE REFERENCE
    // ============================================================================
    console.log("📋 STEP 3: Assigning role to super admin user...");

    superAdminUser.role = superAdminRole._id;
    await superAdminUser.save();

    console.log("✅ Super admin user assigned to role\n");

    // ============================================================================
    // STEP 4: CREATE OTHER COMMON ROLES
    // ============================================================================
    console.log("📋 STEP 4: Creating common roles...");

    // Define common roles
    const commonRoles = [
      {
        name: "manager",
        displayName: "Manager",
        description: "Can manage orders, inventory, and employees",
        components: [
          "1",
          "2",
          "3",
          "4",
          "5",
          "28",
          "33",
          "82",
          "83",
          "101",
          "105",
        ],
        categories: ["operations", "inventory", "suppliers", "finance"],
      },
      {
        name: "inventory_staff",
        displayName: "Inventory Staff",
        description: "Can manage stock and inventory",
        components: ["28", "33", "35", "36", "37", "54", "55", "56"],
        categories: ["inventory", "stock2"],
      },
      {
        name: "delivery_staff",
        displayName: "Delivery Staff",
        description: "Can manage deliveries and orders",
        components: ["3", "4", "5", "6", "90"],
        categories: ["operations", "history"],
      },
    ];

    let createdRolesCount = 0;
    for (const roleData of commonRoles) {
      const existingRole = await Role.findOne({ name: roleData.name });
      if (!existingRole) {
        await Role.create({
          ...roleData,
          isSystemRole: false,
          isActive: true,
          priority: 10,
          createdBy: superAdminUser._id,
          lastModifiedBy: superAdminUser._id,
        });
        createdRolesCount++;
        console.log(`  ✅ Created role: ${roleData.displayName}`);
      }
    }
    console.log(`\n✅ ${createdRolesCount} common roles created/verified\n`);

    // ============================================================================
    // STEP 5: CREATE PERMISSIONS FOR ALL COMPONENTS
    // ============================================================================
    console.log("📋 STEP 5: Creating permissions...");

    let permissionsCreated = 0;
    for (const [categoryKey, categoryData] of Object.entries(
      componentCategories
    )) {
      for (const component of categoryData.components) {
        const existingPermission = await Permission.findOne({
          componentId: component.id,
        });

        if (!existingPermission) {
          await Permission.create({
            name: `${categoryKey}_${component.id}`,
            description: `Access to ${component.name} in ${categoryData.title}`,
            category: categoryKey,
            componentId: component.id,
            componentNumber: component.number,
            path: component.path,
            isActive: true,
            requiredLevel: categoryKey === "admin" ? 5 : 1,
            roles: [superAdminRole._id],
            createdBy: superAdminUser._id,
          });
          permissionsCreated++;
        }
      }
    }

    console.log(`✅ ${permissionsCreated} permissions created/verified\n`);

    // ============================================================================
    // SUMMARY
    // ============================================================================
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );
    console.log("🎉 SUPER ADMIN INITIALIZATION COMPLETED SUCCESSFULLY!\n");
    console.log("📌 LOGIN CREDENTIALS:");
    console.log("   Username: admin12");
    console.log("   Password: admin12\n");
    console.log("📊 SYSTEM SETUP SUMMARY:");
    console.log(`   ✅ Super Admin Role: ${superAdminRole.displayName}`);
    console.log(
      `   ✅ Super Admin User: ${superAdminUser.username} (${superAdminUser.email})`
    );
    console.log(`   ✅ Components Accessible: ${allComponentIds.length}`);
    console.log(`   ✅ Categories Accessible: ${allCategoryKeys.length}`);
    console.log(`   ✅ Permissions Created: ${permissionsCreated}`);
    console.log(`   ✅ Additional Roles Created: ${createdRolesCount}`);
    console.log("\n🔐 COMPONENT ACCESS:");
    for (const [categoryKey, categoryData] of Object.entries(
      componentCategories
    )) {
      console.log(
        `   ${categoryKey}: ${categoryData.components.length} components`
      );
    }
    console.log("\n🚀 NEXT STEPS:");
    console.log("   1. Login with admin12 / admin12");
    console.log("   2. Go to Admin Dashboard");
    console.log("   3. Create additional users and roles as needed");
    console.log("   4. Use the component-based access control system");
    console.log(
      "═══════════════════════════════════════════════════════════════\n"
    );

    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ INITIALIZATION ERROR:", error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Run initialization
initializeSuperAdmin();
