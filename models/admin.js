// models/Admin.js
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

// Check if the model already exists to prevent recompilation
const Admin =
  mongoose.models.Admin ||
  (() => {
    const AdminSchema = new mongoose.Schema({
      username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
      },
      password: {
        type: String,
        required: true,
      },
      email: {
        type: String,
        required: false,
        unique: true,
        trim: true,
      },
      name: {
        type: String,
        required: false,
      },
      role: {
        type: String,
        default: "admin",
        enum: ["admin", "super-admin"],
      },
      lastLogin: {
        type: Date,
        default: null,
      },
      createdAt: {
        type: Date,
        default: Date.now,
      },
    });

    // Pre-save hook to hash password
    AdminSchema.pre("save", async function (next) {
      // Only hash the password if it's modified or new
      if (!this.isModified("password")) return next();

      try {
        // Generate salt
        const salt = await bcrypt.genSalt(10);
        // Hash the password with the salt
        this.password = await bcrypt.hash(this.password, salt);
        next();
      } catch (error) {
        next(error);
      }
    });

    // Static method to seed admin user
    AdminSchema.statics.seedAdmin = async function () {
      try {
        const adminExists = await this.findOne({ username: "admin12" });

        if (!adminExists) {
          await this.create({
            username: "admin12",
            password: "admin12", // Will be hashed by pre-save hook
            email: "admin@example.com",
            name: "System Admin",
            role: "admin",
          });
          console.log("Admin user seeded successfully");
        }
      } catch (error) {
        console.error("Error seeding admin user:", error);
      }
    };

    return mongoose.model("Admin", AdminSchema);
  })();

module.exports = Admin;
