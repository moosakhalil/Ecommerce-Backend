const mongoose = require("mongoose");

const managementSettingsSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      unique: true,
    },
    products: [
      {
        _id: String,
        productId: String,
        name: String,
        category: String,
        price: Number,
        stock: Number,
        brand: String,
      },
    ],
    assignments: {
      type: Object, // Change from Map to Object
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("ManagementSettings", managementSettingsSchema);
