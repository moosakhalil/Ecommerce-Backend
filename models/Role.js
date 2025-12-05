// models/Role.js
const mongoose = require("mongoose");

const RoleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: {
      type: String,
      required: true,
      maxlength: 500,
    },
    components: {
      type: [String],
      default: [],
      // Will store component IDs like "1", "2", "28", etc.
    },
    categories: {
      type: [String],
      default: [],
      // Will store category keys like "operations", "inventory", etc.
    },
    isSystemRole: {
      type: Boolean,
      default: false,
      // System roles cannot be deleted (like super_admin)
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    priority: {
      type: Number,
      default: 0,
      // Higher priority roles have more access
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastModifiedBy: {
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
RoleSchema.index({ name: 1 });
RoleSchema.index({ isActive: 1 });
RoleSchema.index({ priority: -1 });

// Virtual for user count
RoleSchema.virtual("userCount", {
  ref: "User",
  localField: "_id",
  foreignField: "role",
  count: true,
});

// Method to check if role can access component
RoleSchema.methods.hasComponentAccess = function (componentId) {
  return this.components.includes(componentId.toString());
};

// Method to check if role can access category
RoleSchema.methods.hasCategoryAccess = function (categoryKey) {
  return this.categories.includes(categoryKey);
};

const Role = mongoose.models.Role || mongoose.model("Role", RoleSchema);

module.exports = { Role };
