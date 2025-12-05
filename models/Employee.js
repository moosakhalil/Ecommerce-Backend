const mongoose = require("mongoose");
const { v4: uuidv4 } = require("uuid");

const EmployeeSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      default: () => `EMP-${uuidv4().substring(0, 8).toUpperCase()}`,
      unique: true,
      immutable: true,
    },
    name: {
      type: String,
      required: [true, "Employee name is required"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please provide a valid email",
      ],
    },
    phone: {
      type: [String],
      required: [true, "Phone number is required"],
    },
    address: {
      type: String,
      required: [true, "Address is required"],
    },
    homeLocation: {
      type: String,
      required: [true, "Home location is required"],
    },
    emergencyContact: {
      type: String,
      required: [true, "Emergency contact is required"],
    },
    contacts: [
      {
        name: { type: String, required: true },
        relation: { type: String, required: true },
        phoneNumber: { type: String, required: true },
      },
    ],
    roles: {
      type: [String],
      enum: [
        "packing-staff",
        "storage-officer",
        "dispatch-officer-1",
        "dispatch-officer-2",
        "driver",
        "driver-on-delivery",
        "complaint-manager",
      ],
      default: [],
    },
    profilePicture: {
      type: String,
      default: null,
    },
    employeeCategory: {
      type: String,
      enum: ["Driver", "Order Manager", "Packing", "Storage", "Dispatch"],
      required: [true, "Employee category is required"],
    },
    idCardFront: {
      type: String,
      default: null,
    },
    idCardBack: {
      type: String,
      default: null,
    },
    passportFront: {
      type: String,
      default: null,
    },
    passportBack: {
      type: String,
      default: null,
    },
    otherDoc1: {
      type: String,
      default: null,
    },
    otherDoc2: {
      type: String,
      default: null,
    },
    addedOn: {
      type: Date,
      default: Date.now,
    },
    isActivated: {
      type: Boolean,
      default: true,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },

    // PACKING STAFF SPECIFIC
    isAvailable: {
      type: Boolean,
      default: true,
    },

    currentAssignments: {
      type: Number,
      default: 0,
    },

    maxAssignments: {
      type: Number,
      default: 5,
    },

    assignedOrders: [
      {
        orderId: String,
        customerId: String,
        customerName: String,
        assignedAt: Date,
        estimatedCompletionTime: Date,
        status: {
          type: String,
          enum: ["assigned", "in-progress", "completed", "failed", "on-hold"],
          default: "assigned",
        },
      },
    ],

    // PACKING WORK HISTORY
    packingHistory: [
      {
        orderId: String,
        customerId: String,
        customerName: String,
        startedAt: Date,
        completedAt: Date,
        totalItems: Number,
        packedItems: Number,
        status: {
          type: String,
          enum: ["completed", "failed", "cancelled"],
          default: "completed",
        },
        notes: String,
        complaints: { type: Number, default: 0 },
      },
    ],

    // DRIVER SPECIFIC
    licenseNumber: {
      type: String,
      default: null,
    },
    licenseExpiry: {
      type: Date,
      default: null,
    },
    assignedVehicle: {
      vehicleId: String,
      vehicleType: String,
      registrationNumber: String,
      assignedAt: Date,
    },

    // PERFORMANCE METRICS
    performanceMetrics: {
      totalOrders: {
        type: Number,
        default: 0,
      },
      completedOrders: {
        type: Number,
        default: 0,
      },
      failedOrders: {
        type: Number,
        default: 0,
      },
      averagePackingTime: {
        type: Number,
        default: 0,
      },
      rating: {
        type: Number,
        default: 5,
        min: 1,
        max: 5,
      },
      complaintsCount: {
        type: Number,
        default: 0,
      },
      totalDeliveries: {
        type: Number,
        default: 0,
      },
      successfulDeliveries: {
        type: Number,
        default: 0,
      },
      failedDeliveries: {
        type: Number,
        default: 0,
      },
      averageDeliveryTime: {
        type: Number,
        default: 0,
      },
      lastWorkDate: Date,
    },

    availability: {
      status: {
        type: String,
        enum: ["available", "busy", "on-leave", "offline"],
        default: "available",
      },
      lastStatusUpdate: Date,
      leaveStartDate: Date,
      leaveEndDate: Date,
      leaveReason: String,
    },

    currentLocation: {
      latitude: Number,
      longitude: Number,
      address: String,
      updatedAt: Date,
    },

    workSchedule: {
      startTime: String,
      endTime: String,
      workDays: [String],
    },

    compensationInfo: {
      salaryType: {
        type: String,
        enum: ["fixed", "per-delivery", "hourly"],
      },
      amount: Number,
      currency: { type: String, default: "PKR" },
      paymentFrequency: {
        type: String,
        enum: ["weekly", "bi-weekly", "monthly"],
      },
      bankAccount: {
        accountNumber: String,
        bankName: String,
        accountHolder: String,
      },
    },

    shift: {
      type: String,
      enum: ["morning", "afternoon", "evening", "night", "flexible"],
      default: "flexible",
    },

    documents: {
      drivingLicense: {
        fileUrl: String,
        expiryDate: Date,
        verified: Boolean,
      },
      insuranceCertificate: {
        fileUrl: String,
        expiryDate: Date,
        verified: Boolean,
      },
      backgroundCheck: {
        completed: Boolean,
        completedDate: Date,
        result: String,
      },
    },

    activityLog: [
      {
        action: String,
        timestamp: Date,
        orderId: String,
        details: String,
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Indexes
EmployeeSchema.index({ roles: 1, isAvailable: 1 });
EmployeeSchema.index({ "availability.status": 1 });
EmployeeSchema.index({ employeeCategory: 1 });
EmployeeSchema.index({ employeeId: 1 });

module.exports = mongoose.model("Employee", EmployeeSchema);
