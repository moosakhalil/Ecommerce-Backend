const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const supplierSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, "Supplier name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      match: [
        /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
        "Please provide a valid email",
      ],
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
      validate: {
        validator: function (v) {
          // Updated to only accept +62 format followed by 9-11 digits
          return /^\+62[0-9]{9,11}$/.test(v);
        },
        message: (props) =>
          `${props.value} is not a valid Indonesian phone number!`,
      },
    },
    secondPhone: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          if (!v) return true; // Only validate if provided
          // Updated to only accept +62 format followed by 9-11 digits
          return /^\+62[0-9]{9,11}$/.test(v);
        },
        message: (props) =>
          `${props.value} is not a valid Indonesian phone number!`,
      },
    },
    nameOrDepartment: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      required: [true, "Address is required"],
      trim: true,
    },
    warehouseLocation: {
      type: String,
      required: [true, "Warehouse location is required"],
      trim: true,
    },
    bankAccount: {
      type: String,
      trim: true,
    },
    bankName: {
      type: String,
      trim: true,
    },
    emergencyContact: {
      type: String,
      trim: true,
    },
    addedOn: {
      type: Date,
      default: Date.now,
    },
    // File paths stored as strings
    profilePicture: {
      type: String,
      default: "",
    },
    idCardFront: {
      type: String,
      default: "",
    },
    idCardBack: {
      type: String,
      default: "",
    },
    passportFront: {
      type: String,
      default: "",
    },
    passportBack: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["blocked", "unblocked"],
      default: "unblocked",
    },
    assignedTo: {
      type: String,
      trim: true,
    },
    activeInactive: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
    orders: [
      {
        type: Schema.Types.ObjectId,
        ref: "Order",
      },
    ],
    orderedProducts: [
      {
        type: Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    supplyProducts: [
      {
        type: Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
  },
  { timestamps: true }
);

// Custom validation for ID card or passport requirement
supplierSchema.pre("save", function (next) {
  // Check if either ID card (both sides) or passport (both sides) is provided
  const hasIdCard = this.idCardFront && this.idCardBack;
  const hasPassport = this.passportFront && this.passportBack;

  if (!hasIdCard && !hasPassport) {
    const error = new Error(
      "Either ID card (both sides) or passport (both sides) is required"
    );
    error.name = "ValidationError";
    return next(error);
  }

  next();
});

const Supplier = mongoose.model("Supplier", supplierSchema);

module.exports = Supplier;
