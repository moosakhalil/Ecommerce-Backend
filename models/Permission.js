// models/Permission.js
const mongoose = require("mongoose");

const PermissionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      maxlength: 500,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "operations",
        "inventory",
        "stock2",
        "discount",
        "suppliers",
        "history",
        "finance",
        "admin",
        "referrals",
        "foreman",
        "settings",
      ],
    },
    componentId: {
      type: String,
      required: true,
    },
    componentNumber: {
      type: String,
      default: "",
    },
    path: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    requiredLevel: {
      type: Number,
      default: 1,
      // 1 = basic access, 5 = high security access
    },
    roles: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Role",
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
PermissionSchema.index({ category: 1 });
PermissionSchema.index({ componentId: 1 });
PermissionSchema.index({ isActive: 1 });

// Static method to seed default permissions
PermissionSchema.statics.seedDefaultPermissions = async function () {
  try {
    const { User } = require("./User");
    const { Role } = require("./Role");

    const superAdmin = await User.findOne({ username: "super_admin" });
    if (!superAdmin) {
      console.log("❌ Super admin not found, cannot seed permissions");
      return;
    }

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
          { id: "105", number: "105.", name: "ANALYTICS", path: "/analytics" },
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

    for (const [categoryKey, categoryData] of Object.entries(
      componentCategories
    )) {
      for (const component of categoryData.components) {
        const existingPermission = await this.findOne({
          componentId: component.id,
        });

        if (!existingPermission) {
          await this.create({
            name: `${categoryKey}_${component.id}`,
            description: `Access to ${component.name} in ${categoryData.title}`,
            category: categoryKey,
            componentId: component.id,
            componentNumber: component.number,
            path: component.path,
            isActive: true,
            requiredLevel: categoryKey === "admin" ? 5 : 1,
            roles: [],
            createdBy: superAdmin._id,
          });
        }
      }
    }

    console.log("✅ Default permissions seeded successfully");
  } catch (error) {
    console.error("❌ Error seeding permissions:", error);
  }
};

const Permission =
  mongoose.models.Permission || mongoose.model("Permission", PermissionSchema);

module.exports = { Permission };
