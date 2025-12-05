const mongoose = require("mongoose");

// ✅ MASTER STATUS LIST - SINGLE SOURCE OF TRUTH
const ORDER_STATUSES = [
  "cart-not-paid",
  "order-made-not-paid",
  "pay-not-confirmed",
  "order-confirmed",
  "order-not-picked",
  "issue-customer",
  "customer-confirmed",
  "order-refunded",
  "picking-order",
  "allocated-driver",
  "assigned-dispatch-officer-2",
  "ready-to-pickup",
  "order-not-pickedup",
  "order-picked-up",
  "on-way",
  "driver-confirmed",
  "order-processed",
  "refund",
  "complain-order",
  "issue-driver",
  "parcel-returned",
  "order-complete",
];

// Helper function to generate unique referral code
async function generateUniqueReferralCode(phoneNumber, customerId) {
  const Customer = mongoose.model("Customer");
  let attempts = 0;
  const maxAttempts = 20;

  while (attempts < maxAttempts) {
    let code;

    if (attempts === 0) {
      const phoneDigits = phoneNumber.replace(/\D/g, "").slice(-4) || "0000";
      const randomSuffix = Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase();
      code = `CM${phoneDigits}${randomSuffix}`;
    } else if (attempts < 10) {
      const timestamp = Date.now().toString().slice(-6);
      const random = Math.random().toString(36).substring(2, 4).toUpperCase();
      code = `CM${timestamp}${random}`;
    } else {
      const objectIdStr = customerId.toString();
      const counter = (attempts - 10).toString().padStart(2, "0");
      code = `CM${objectIdStr.slice(-6)}${counter}`;
    }

    try {
      const existingCustomer = await Customer.findOne({
        referralCode: code,
        _id: { $ne: customerId },
      });

      if (!existingCustomer) {
        return code;
      }
    } catch (error) {
      console.error("Error checking referral code uniqueness:", error);
    }

    attempts++;
  }

  const fallbackCode = `CM${customerId.toString().slice(-6)}${Date.now()
    .toString()
    .slice(-6)}`;
  console.warn(`Using fallback referral code: ${fallbackCode}`);
  return fallbackCode;
}

// Enhanced support ticket schema with media support
const supportTicketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
      default: function () {
        return "TICK" + Date.now().toString().slice(-8);
      },
    },
    orderId: String,
    type: {
      type: String,
      enum: [
        "delivery_issue",
        "product_issue",
        "payment_problem",
        "agent_request",
        "complaint",
        "address_change",
        "delivery_reschedule",
        "other",
      ],
      required: true,
    },
    subType: {
      type: String,
      enum: [
        "track_order",
        "delivery_delayed",
        "change_delivery_address",
        "driver_location_issue",
        "marked_delivered_not_received",
        "reschedule_delivery",
        "broken_item",
        "missing_wrong_amount",
        "wrong_item",
        "product_other",
        "paid_no_confirmation",
        "payment_failed",
        "paid_different_name",
        "charged_twice",
        "unsure_payment",
        "use_credited_funds",
      ],
    },
    issueDetails: String,
    customerMessage: String,

    mediaAttachments: [
      {
        mediaId: String,
        mediaType: {
          type: String,
          enum: ["image", "video", "voice", "document"],
          required: true,
        },
        mimetype: String,
        filename: String,
        caption: String,
        base64Data: String,
        fileSize: Number,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
        ultraMsgUrl: String,
      },
    ],

    paymentData: {
      paymentScreenshot: {
        base64Data: String,
        mimetype: String,
        uploadedAt: Date,
      },
      payerName: String,
      isInternationalTransfer: Boolean,
      transactionId: String,
      bankName: String,
      paymentAmount: Number,
    },

    deliveryData: {
      currentAddress: String,
      newAddress: String,
      newDeliveryDate: String,
      newDeliveryTime: String,
      nearbyLandmark: String,
      googleMapLink: String,
      isOrderDispatched: Boolean,
      extraChargesApplicable: Boolean,
      estimatedExtraCharge: Number,
    },

    productData: {
      affectedItems: [String],
      issueDescription: String,
      damagePhotos: [
        {
          base64Data: String,
          mimetype: String,
          uploadedAt: Date,
        },
      ],
      customerPreference: {
        type: String,
        enum: ["keep_and_pay", "replace", "refund", "bring_to_facility"],
      },
    },

    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "closed", "escalated"],
      default: "open",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
    agentNotes: String,
    createdAt: {
      type: Date,
      default: Date.now,
    },
    lastUpdated: {
      type: Date,
      default: Date.now,
    },
    resolution: String,
    resolvedAt: Date,
    estimatedResolutionTime: String,
  },
  { _id: false }
);

// Complaint schema for order-specific complaints
const complaintSchema = new mongoose.Schema(
  {
    complaintId: {
      type: String,
      required: true,
      default: function () {
        return "COMP" + Date.now().toString().slice(-8);
      },
    },
    orderId: String,

    mediaAttachments: [
      {
        mediaId: String,
        mediaType: {
          type: String,
          enum: ["video", "voice", "image"],
          required: true,
        },
        mimetype: String,
        filename: String,
        base64Data: String,
        fileSize: Number,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    textSummary: String,
    isOrderRelated: Boolean,
    complaintCategory: String,
    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
    },

    customerContactDetails: {
      preferredContactMethod: String,
      alternatePhone: String,
      email: String,
    },

    status: {
      type: String,
      enum: ["submitted", "under_review", "in_progress", "resolved"],
      default: "submitted",
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    resolution: String,
    resolvedAt: Date,
  },
  { _id: false }
);

// Original complaint schema for order-specific complaints
const originalComplaintSchema = new mongoose.Schema(
  {
    complaintId: {
      type: String,
      required: true,
    },
    issueTypes: [
      {
        type: String,
        enum: ["broken", "not_what_ordered", "missing_amount", "other"],
        required: true,
      },
    ],
    additionalDetails: String,
    solutions: [
      {
        type: String,
        enum: ["customer_keeps_product", "customer_returns_with_truck"],
      },
    ],
    solutionDetails: String,
    customerRequests: [
      {
        type: String,
        enum: ["customer_asks_cancellation", "customer_asks_replacement"],
      },
    ],
    customerRequestDetails: String,
    reportedBy: {
      driverId: String,
      driverName: String,
    },
    reportedAt: {
      type: Date,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved"],
      default: "open",
    },
    resolution: String,
    resolvedAt: Date,
  },
  { _id: false }
);

// ✅ FIXED: Enhanced shopping history schema with full traceability
const shoppingHistorySchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
    },
    orderDate: {
      type: Date,
      required: true,
      default: Date.now,
    },

    items: [
      {
        productId: String,
        productName: String,
        category: String,
        subCategory: String,
        weight: String,
        quantity: Number,
        unitPrice: Number,
        totalPrice: Number,
        isDiscountedProduct: {
          type: Boolean,
          default: false,
        },
        onTruck: {
          type: Boolean,
          default: false,
        },
        packingStatus: {
          type: String,
          enum: ["pending", "packing", "packed", "unavailable"],
          default: "pending",
        },
        packedAt: Date,
        packedBy: {
          staffId: String,
          staffName: String,
          timestamp: Date,
        },
        packingNotes: String,
        // ... other item fields
        storageVerified: {
          type: Boolean,
          default: false,
        },
        loadingVerified: {
          type: Boolean,
          default: false,
        },
        // ... rest of item fields
      },
    ], // ← items array ENDS here

    // ✅ CORRECT: deliveryMedia goes HERE, AFTER items array, at ORDER level
    deliveryMedia: {
      // 1. DELIVERY VIDEO (MANDATORY)
      deliveryVideo: {
        videoId: String,
        filename: String,
        mimetype: String,
        fileSize: Number,
        base64Data: String, // Store video as base64
        uploadedAt: Date,
        uploadedBy: {
          driverId: String,
          driverName: String,
        },
        videoDetails: {
          driverVisibleInVideo: { type: Boolean, default: false },
          receiverVisibleInVideo: { type: Boolean, default: false },
          orderReceivedStatementClear: { type: Boolean, default: false },
          allItemsShown: { type: Boolean, default: false },
          everythingCheckedConfirmed: { type: Boolean, default: false },
          customerIssuesMentioned: String,
        },
        verificationStatus: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
        verifiedBy: {
          staffId: String,
          staffName: String,
          verifiedAt: Date,
        },
        rejectionReason: String,
      },

      // 2. COMPLAINT VIDEO (CONDITIONAL)
      complaintVideo: {
        videoId: String,
        filename: String,
        mimetype: String,
        fileSize: Number,
        base64Data: String,
        uploadedAt: Date,
        uploadedBy: {
          driverId: String,
          driverName: String,
        },
        complaintDetails: {
          issuesFocused: String,
          problemShownClearly: { type: Boolean, default: false },
          allDetailsRecorded: { type: Boolean, default: false },
          evidenceVisible: { type: Boolean, default: false },
        },
        verificationStatus: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
        verifiedBy: {
          staffId: String,
          staffName: String,
          verifiedAt: Date,
        },
      },

      // 3. ENTRANCE PHOTO (MANDATORY)
      entrancePhoto: {
        photoId: String,
        filename: String,
        mimetype: String,
        fileSize: Number,
        base64Data: String,
        uploadedAt: Date,
        uploadedBy: {
          driverId: String,
          driverName: String,
        },
        photoQuality: {
          clearVisible: { type: Boolean, default: false },
          entranceIdentifiable: { type: Boolean, default: false },
        },
        verificationStatus: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
        verifiedBy: {
          staffId: String,
          staffName: String,
          verifiedAt: Date,
        },
      },

      // 4. PHOTO WITH RECEIPT IN HAND (MANDATORY)
      receiptInHandPhoto: {
        photoId: String,
        filename: String,
        mimetype: String,
        fileSize: Number,
        base64Data: String,
        uploadedAt: Date,
        uploadedBy: {
          driverId: String,
          driverName: String,
        },
        photoQuality: {
          customerFaceVisible: { type: Boolean, default: false },
          receiptClearlyVisible: { type: Boolean, default: false },
          receiptHeldProperly: { type: Boolean, default: false },
        },
        verificationStatus: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
        verifiedBy: {
          staffId: String,
          staffName: String,
          verifiedAt: Date,
        },
      },

      // 5. RECEIPT CLOSE-UP PHOTO (MANDATORY)
      receiptCloseUpPhoto: {
        photoId: String,
        filename: String,
        mimetype: String,
        fileSize: Number,
        base64Data: String,
        uploadedAt: Date,
        uploadedBy: {
          driverId: String,
          driverName: String,
        },
        photoQuality: {
          receiptTextReadable: { type: Boolean, default: false },
          allDetailsVisible: { type: Boolean, default: false },
          properLighting: { type: Boolean, default: false },
        },
        verificationStatus: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
        verifiedBy: {
          staffId: String,
          staffName: String,
          verifiedAt: Date,
        },
      },

      // 6. RECEIPT NEXT TO FACE PHOTO (MANDATORY)
      receiptNextToFacePhoto: {
        photoId: String,
        filename: String,
        mimetype: String,
        fileSize: Number,
        base64Data: String,
        uploadedAt: Date,
        uploadedBy: {
          driverId: String,
          driverName: String,
        },
        photoQuality: {
          faceAndReceiptBothVisible: { type: Boolean, default: false },
          receiptReadable: { type: Boolean, default: false },
          faceIdentifiable: { type: Boolean, default: false },
        },
        verificationStatus: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
        verifiedBy: {
          staffId: String,
          staffName: String,
          verifiedAt: Date,
        },
      },

      // OVERALL VERIFICATION STATUS
      allMediaUploaded: {
        type: Boolean,
        default: false,
      },
      allMediaVerified: {
        type: Boolean,
        default: false,
      },
      uploadCompletedAt: Date,
      verificationCompletedAt: Date,

      // Customer complaint flag
      hasCustomerComplaints: {
        type: Boolean,
        default: false,
      },
      complaintDescription: String,
    }, // ← deliveryMedia ENDS here

    // Continue with other ORDER-level fields
    storageDetails: {
      verificationStartedAt: Date,
      verificationCompletedAt: Date,
      verificationStaff: {
        staffId: String,
        staffName: String,
      },
      storageNotes: String,
      storageLocation: String,
      totalItemsVerified: {
        type: Number,
        default: 0,
      },
      totalItemsRequested: {
        type: Number,
        default: 0,
      },
      verificationProgress: {
        type: Number,
        default: 0,
      },
      hasStorageComplaints: {
        type: Boolean,
        default: false,
      },
    },

    assignmentDetails: {
      assignedVehicle: {
        vehicleId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "VehicleType",
        },
        vehicleName: String,
        displayName: String,
        category: {
          type: String,
          enum: ["scooter", "truck"],
        },
        specifications: {
          maxVolume: Number,
          maxWeight: Number,
          maxPackages: Number,
        },
      },
      assignedDriver: {
        employeeId: String,
        employeeName: String,
        phone: String,
        currentAssignments: Number,
        expertise: [String],
      },
      assignedAt: Date,
      assignedBy: {
        employeeId: String,
        employeeName: String,
      },
      notes: String,
    },

    routeStartedAt: Date,
    routeStartedBy: {
      driverId: String,
      driverName: String,
    },

    arrivedAt: Date,
    arrivedBy: {
      driverId: String,
      driverName: String,
    },

    deliveryPhotos: [
      {
        photoId: String,
        filename: String,
        mimetype: String,
        fileSize: Number,
        base64Data: String,
        uploadedAt: Date,
        uploadedBy: {
          driverId: String,
          driverName: String,
        },
        notes: String,
      },
    ],

    deliveredAt: Date,
    deliveredBy: {
      driverId: String,
      driverName: String,
    },
    customerConfirmed: {
      type: Boolean,
      default: false,
    },
    deliveryNotes: String,
    customerSatisfaction: {
      type: Number,
      min: 1,
      max: 5,
      default: 5,
    },

    totalAmount: {
      type: Number,
      required: true,
    },
    deliveryCharge: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: ORDER_STATUSES,
      default: "cart-not-paid",
    },

    deliveryAddress: {
      nickname: String,
      area: String,
      fullAddress: String,
      googleMapLink: String,
    },

    deliveryDate: Date,
    timeSlot: { type: String, default: null },

    driver1: { type: String, default: null },
    driver2: { type: String, default: null },
    pickupType: {
      type: String,
      enum: [
        "heavy-pickup",
        "medium-pickup",
        "light-pickup",
        "three-wheeler",
        "scooter-heavy-delivery",
        "scooter",
      ],
      default: "heavy-pickup",
    },
    truckOnDeliver: { type: Boolean, default: false },
    adminReason: String,
    pickupAllocated: {
      type: Boolean,
      default: false,
    },
    allocatedAt: Date,
    accountHolderName: {
      type: String,
      default: "",
    },
    paidBankName: {
      type: String,
      default: "",
    },
    receiptImage: {
      data: String,
      contentType: String,
    },
    receiptImageMetadata: {
      mimetype: String,
      timestamp: Date,
    },

    refunds: [
      {
        refundId: {
          type: String,
          required: true,
          default: function () {
            return "REF" + Date.now().toString().slice(-8);
          },
        },
        refundDate: {
          type: Date,
          default: Date.now,
        },
        refundAmount: Number,
        refundReason: {
          type: String,
          required: true,
        },
        refundedItems: [
          {
            productId: String,
            productName: String,
            quantity: Number,
            refundAmount: Number,
          },
        ],
        staffSignature: {
          staffId: {
            type: String,
            required: true,
          },
          staffName: String,
          signatureDate: {
            type: Date,
            default: Date.now,
          },
        },
        isImmutable: {
          type: Boolean,
          default: true,
        },
      },
    ],

    replacements: [
      {
        replacementId: {
          type: String,
          required: true,
          default: function () {
            return "REP" + Date.now().toString().slice(-8);
          },
        },
        replacementDate: {
          type: Date,
          default: Date.now,
        },
        replacementReason: {
          type: String,
          required: true,
        },
        originalItems: [
          {
            productId: String,
            productName: String,
            quantity: Number,
          },
        ],
        replacementItems: [
          {
            productId: String,
            productName: String,
            quantity: Number,
            newPrice: Number,
          },
        ],
        priceDifference: Number,
        staffSignature: {
          staffId: {
            type: String,
            required: true,
          },
          staffName: String,
          signatureDate: {
            type: Date,
            default: Date.now,
          },
        },
        isImmutable: {
          type: Boolean,
          default: true,
        },
      },
    ],

    corrections: [
      {
        correctionId: {
          type: String,
          required: true,
          default: function () {
            return "COR" + Date.now().toString().slice(-8);
          },
        },
        correctionDate: {
          type: Date,
          default: Date.now,
        },
        originalField: String,
        originalValue: mongoose.Schema.Types.Mixed,
        newValue: mongoose.Schema.Types.Mixed,
        correctionReason: {
          type: String,
          required: true,
        },
        staffSignature: {
          staffId: {
            type: String,
            required: true,
          },
          staffName: String,
          signatureDate: {
            type: Date,
            default: Date.now,
          },
        },
        isImmutable: {
          type: Boolean,
          default: true,
        },
      },
    ],

    complaints: [originalComplaintSchema],
  },
  { _id: false }
);

// Enhanced referral tracking schema
const referralTrackingSchema = new mongoose.Schema(
  {
    primaryReferrer: {
      customerId: String,
      customerName: String,
      phoneNumber: String,
      referralCode: String,
      referralDate: Date,
      videoId: String,
    },
    additionalReferrers: [
      {
        customerId: String,
        customerName: String,
        phoneNumber: String,
        referralCode: String,
        referralDate: Date,
        videoId: String,
      },
    ],
    allReferralSources: [
      {
        customerId: String,
        customerName: String,
        phoneNumber: String,
        referralCode: String,
        referralDate: Date,
        method: {
          type: String,
          enum: ["video", "code", "direct"],
          default: "video",
        },
      },
    ],
  },
  { _id: false }
);

// Enhanced foreman status tracking
const foremanStatusSchema = new mongoose.Schema(
  {
    isForemanApproved: {
      type: Boolean,
      default: false,
    },
    foremanApprovalDate: Date,
    foremanApprovedBy: {
      staffId: String,
      staffName: String,
    },

    isCommissionEligible: {
      type: Boolean,
      default: false,
    },
    commissionEligibilityDate: Date,
    commissionApprovedBy: {
      staffId: String,
      staffName: String,
    },

    commissionRate: {
      type: Number,
      default: 5,
    },

    statusHistory: [
      {
        action: {
          type: String,
          enum: [
            "foreman_approved",
            "foreman_revoked",
            "commission_approved",
            "commission_revoked",
          ],
          required: true,
        },
        actionDate: {
          type: Date,
          default: Date.now,
        },
        staffSignature: {
          staffId: String,
          staffName: String,
        },
        reason: String,
        isImmutable: {
          type: Boolean,
          default: true,
        },
      },
    ],
  },
  { _id: false }
);

// Commission tracking schema
const commissionTrackingSchema = new mongoose.Schema(
  {
    totalCommissionEarned: {
      type: Number,
      default: 0,
    },
    totalCommissionPaid: {
      type: Number,
      default: 0,
    },
    availableCommission: {
      type: Number,
      default: 0,
    },

    commissionHistory: [
      {
        commissionId: {
          type: String,
          required: true,
          default: function () {
            return "COM" + Date.now().toString().slice(-8);
          },
        },
        type: {
          type: String,
          enum: ["earned", "paid", "adjustment"],
          required: true,
        },
        amount: {
          type: Number,
          required: true,
        },
        date: {
          type: Date,
          default: Date.now,
        },
        relatedOrderId: String,
        referredCustomerId: String,
        referredCustomerName: String,
        commissionRate: Number,
        baseAmount: Number,
        notes: String,
        isPaid: {
          type: Boolean,
          default: false,
        },
        paidDate: Date,
        staffSignature: {
          staffId: String,
          staffName: String,
          signatureDate: Date,
        },
        isImmutable: {
          type: Boolean,
          default: true,
        },
      },
    ],
  },
  { _id: false }
);

// Main customer schema with all enhancements
const customerSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: [String],
      required: true,
      index: true,
      validate: [
        function (val) {
          return val.length > 0;
        },
        "{PATH} must have at least one phone number",
      ],
    },

    currentOrderStatus: {
      type: String,
      enum: ORDER_STATUSES,
      default: "cart-not-paid",
    },

    isFirstTimeCustomer: {
      type: Boolean,
      default: true,
    },
    firstOrderDiscountApplied: {
      type: Boolean,
      default: false,
      description:
        "Marks if first order discount has been used. Set to true only after first payment receipt uploaded.",
    },

    latestOrderId: {
      type: String,
      default: null,
      index: true,
    },

    numberLinkedHistory: [
      {
        number: String,
        dateLinked: Date,
      },
    ],

    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: String,

    conversationState: {
      type: String,
      default: "new",
    },

    currentSupportFlow: {
      mainCategory: String,
      subCategory: String,
      specificIssue: String,
      currentStep: String,
      tempData: mongoose.Schema.Types.Mixed,
      mediaExpected: Boolean,
      lastInteraction: Date,
      sessionId: String,
    },

    supportTickets: [supportTicketSchema],

    complaints: [complaintSchema],

    supportInteractionHistory: [
      {
        sessionId: String,
        startTime: Date,
        endTime: Date,
        category: String,
        issueResolved: Boolean,
        satisfaction: Number,
        agentInvolved: Boolean,
        totalMessages: Number,
        mediaShared: Number,
        lastAction: String,
        lastActionTime: Date,
      },
    ],

    supportPreferences: {
      preferredLanguage: {
        type: String,
        default: "english",
      },
      contactMethod: {
        type: String,
        enum: ["whatsapp", "phone", "email"],
        default: "whatsapp",
      },
      allowMediaSharing: {
        type: Boolean,
        default: true,
      },
    },

    faqInteractions: [
      {
        question: String,
        category: String,
        timestamp: Date,
        helpful: Boolean,
      },
    ],

    addressChangeHistory: [
      {
        orderId: String,
        oldAddress: String,
        newAddress: String,
        requestedAt: Date,
        status: {
          type: String,
          enum: ["pending", "approved", "rejected", "too_late"],
          default: "pending",
        },
        extraCharges: Number,
        approvedAt: Date,
      },
    ],

    paymentIssues: [
      {
        issueId: String,
        orderId: String,
        issueType: String,
        description: String,
        paymentScreenshot: {
          base64Data: String,
          mimetype: String,
          uploadedAt: Date,
        },
        payerName: String,
        isInternationalTransfer: Boolean,
        status: {
          type: String,
          enum: ["reported", "investigating", "resolved"],
          default: "reported",
        },
        reportedAt: Date,
        resolvedAt: Date,
      },
    ],

    supportMedia: [
      {
        mediaId: String,
        ticketId: String,
        mediaType: String,
        base64Data: String,
        mimetype: String,
        fileSize: Number,
        uploadedAt: Date,
        description: String,
      },
    ],

    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    referralTracking: referralTrackingSchema,

    customersReferred: [
      {
        customerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Customer",
          required: true,
        },
        customerName: String,
        phoneNumber: String,
        referralDate: Date,
        videoUsed: String,
        hasPlacedOrder: {
          type: Boolean,
          default: false,
        },
        firstOrderDate: Date,
        totalOrdersCount: {
          type: Number,
          default: 0,
        },
        totalSpentAmount: {
          type: Number,
          default: 0,
        },
        commissionGenerated: {
          type: Number,
          default: 0,
        },
        _id: false,
      },
    ],

    referraldemovideos: [
      {
        videoId: mongoose.Schema.Types.ObjectId,
        title: String,
        mimetype: String,
        filename: String,
        fileSize: Number,
        base64Data: String,
        status: {
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
        uploadDate: {
          type: Date,
          default: Date.now,
        },
        ultraMsgCompatible: Boolean,
      },
    ],

    referralvideos: [
      {
        imageId: {
          type: String,
          required: true,
        },
        mediaType: {
          type: String,
          default: "video",
        },
        mimetype: {
          type: String,
          default: "video/mp4",
        },
        filename: String,
        ultraMsgMediaId: String,
        base64Data: {
          type: String,
          required: true,
        },
        fileSize: {
          type: Number,
          required: true,
        },
        approvalDate: {
          type: Date,
          default: Date.now,
        },
        status: {
          type: String,
          enum: ["unverified", "verified", "manager", "spam"],
          default: "unverified",
        },
        statusUpdatedAt: {
          type: Date,
          default: Date.now,
        },
        statusHistory: [
          {
            status: {
              type: String,
              enum: ["unverified", "verified", "manager", "spam"],
            },
            updatedAt: {
              type: Date,
              default: Date.now,
            },
            updatedBy: String,
            reason: String,
          },
        ],
        adminNotes: String,
        sharedWith: [
          {
            name: {
              type: String,
              default: "Contact",
            },
            phoneNumber: {
              type: String,
              required: true,
            },
            dateShared: {
              type: Date,
              default: Date.now,
            },
            status: {
              type: String,
              enum: ["pending", "sent", "failed"],
              default: "pending",
            },
            dateSent: Date,
            errorMessage: String,
          },
        ],
      },
    ],

    referredBy: {
      customerId: String,
      phoneNumber: String,
      name: String,
      videoId: String,
      dateReferred: Date,
    },

    referralRewards: [
      {
        amount: Number,
        issuedDate: Date,
        expiryDate: Date,
        used: Boolean,
        usedDate: Date,
        orderId: String,
      },
    ],

    foremanStatus: foremanStatusSchema,
    commissionTracking: commissionTrackingSchema,

    shoppingHistory: [shoppingHistorySchema],

    orderHistory: [
      {
        orderId: String,
        items: [
          {
            productId: String,
            productName: String,
            quantity: Number,
            price: Number,
            weight: String,
            loadingVerified: {
              type: Boolean,
              default: false,
            },
            loadingNotes: {
              type: String,
              default: "",
            },
            loadingVerifiedAt: Date,
            loadingVerifiedBy: {
              staffId: String,
              staffName: String,
              timestamp: Date,
            },
            totalPrice: Number,
            onTruck: {
              type: Boolean,
              default: false,
            },
          },
        ],
        totalAmount: Number,
        deliveryOption: String,
        deliveryLocation: String,
        deliveryCharge: Number,
        deliveryTimeFrame: String,
        deliveryType: {
          type: String,
          enum: ["truck", "scooter", "self_pickup"],
          default: "truck",
        },
        deliverySpeed: {
          type: String,
          enum: ["normal", "speed", "early_morning", "eco"],
          default: "normal",
        },
        deliveryAddress: {
          nickname: String,
          area: String,
          fullAddress: String,
          googleMapLink: String,
        },
        ecoDeliveryDiscount: {
          type: Number,
          default: 0,
        },
        adminReason: String,
        pickupAllocated: {
          type: Boolean,
          default: false,
        },
        allocatedAt: Date,
        complaints: [originalComplaintSchema],
      },
    ],

    cart: {
      items: [
        {
          productId: String,
          productName: String,
          category: String,
          subCategory: String,
          weight: String,
          quantity: Number,
          price: Number,
          totalPrice: Number,
          imageUrl: String,
        },
      ],
      totalAmount: {
        type: Number,
        default: 0,
        set: function (v) {
          const num = Number(v);
          return isNaN(num) ? 0 : num;
        },
      },
      deliveryCharge: {
        type: Number,
        default: 0,
        set: function (v) {
          const num = Number(v);
          return isNaN(num) ? 0 : num;
        },
      },

      deliveryOption: {
        type: String,
        default: "Normal Delivery",
      },
      deliveryLocation: {
        type: String,
        default: "",
      },
      deliveryType: {
        type: String,
        enum: ["truck", "scooter", "self_pickup"],
        default: "truck",
      },
      deliverySpeed: {
        type: String,
        enum: ["normal", "speed", "early_morning", "eco"],
        default: "normal",
      },
      firstOrderDiscount: {
        type: Number,
        default: 0,
      },
      ecoDeliveryDiscount: {
        type: Number,
        default: 0,
      },
      deliveryTimeFrame: {
        type: String,
        default: "",
      },
      deliveryAddress: {
        nickname: String,
        area: String,
        fullAddress: String,
        googleMapLink: String,
      },
    },

    currentDiscountProductId: String,
    currentDiscountProductName: String,
    currentDiscountProductPrice: Number,
    currentDiscountProductOriginalPrice: Number,
    currentDiscountCategory: String,

    pickupPlan: {
      date: { type: String, default: null },
      timeSlot: { type: String, default: null },
      reminderSent: { type: Boolean, default: false },
    },

    tempVerificationTries: { type: Number, default: 0 },
    pendingVerificationOldNumber: { type: String, default: null },
    tempNumberToSwitch: { type: String, default: null },

    ecoDeliveryDiscount: {
      type: Number,
      default: 0,
    },

    pickupDateList: {
      type: [String],
      default: [],
    },

    contextData: {
      categoryId: String,
      categoryName: String,
      subCategoryId: String,
      subCategoryName: String,
      productId: String,
      productName: String,
      selectedWeight: String,
      quantity: Number,
      deliveryOption: String,
      numberSwitchIndex: Number,

      categoryList: { type: [String], default: [] },
      subcategoryList: { type: [String], default: [] },
      productList: { type: [String], default: [] },
      weightOptions: { type: [String], default: [] },

      editAddressIndex: Number,
      editAddressField: String,
      editBankIndex: {
        type: Number,
        default: null,
      },
      tempBankAccount: {
        type: {
          accountHolderName: { type: String, default: "" },
          bankName: { type: String, default: "" },
          accountNumber: { type: String, default: "" },
        },
        adminReason: String,
        default: () => ({
          accountHolderName: "",
          bankName: "",
          accountNumber: "",
        }),
      },

      tempAddress: {
        type: {
          nickname: { type: String, default: "" },
          fullAddress: { type: String, default: "" },
          area: { type: String, default: "" },
          googleMapLink: { type: String, default: "" },
        },
        default: () => ({
          nickname: "",
          fullAddress: "",
          area: "",
          googleMapLink: "",
        }),
      },

      deliveryLocation: String,
      locationDetails: String,
      paymentMethod: String,
      email: String,
      bankName: String,
      transactionId: String,
      temporaryItemDetails: Object,

      reportingOrderId: String,
      issueType: String,
      issueDetails: String,
      complaintDetails: String,
      paymentScreenshot: Object,
      payerName: String,
      isInternationalTransfer: Boolean,
      complaintMedia: Object,
      textSummary: String,
      isOrderRelated: Boolean,
    },

    bankAccounts: [
      {
        accountHolderName: { type: String },
        bankName: { type: String },
        accountNumber: { type: String },
      },
    ],

    payerNames: {
      type: [String],
      default: [],
    },

    bankNames: {
      type: [String],
      default: [],
    },

    lastInteraction: {
      type: Date,
      default: Date.now,
    },

    chatHistory: [
      {
        message: String,
        sender: {
          type: String,
          enum: ["customer", "bot"],
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    addresses: [
      {
        nickname: String,
        fullAddress: String,
        area: String,
        googleMapLink: String,
        isDefault: Boolean,
      },
    ],

    discountCodes: [
      {
        code: String,
        discountPercentage: Number,
        validUntil: Date,
        isUsed: {
          type: Boolean,
          default: false,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// PRE-SAVE MIDDLEWARE - Guarantees unique referral codes
customerSchema.pre("save", async function (next) {
  try {
    if (!this.referralCode && this.phoneNumber && this.phoneNumber.length > 0) {
      console.log(
        `Generating referral code for customer: ${this.name || "Unknown"}`
      );

      this.referralCode = await generateUniqueReferralCode(
        this.phoneNumber[0],
        this._id
      );

      console.log(`Generated referral code: ${this.referralCode}`);
    }

    next();
  } catch (error) {
    console.error("Error in referral code generation:", error);
    next(error);
  }
});

// POST-SAVE MIDDLEWARE - Handle any remaining issues
customerSchema.post("save", function (error, doc, next) {
  if (
    error &&
    error.code === 11000 &&
    error.keyPattern &&
    error.keyPattern.referralCode
  ) {
    console.error("Duplicate referral code detected, attempting retry...");

    generateUniqueReferralCode(doc.phoneNumber[0], doc._id)
      .then((newCode) => {
        doc.referralCode = newCode;
        return doc.save();
      })
      .then(() => next())
      .catch((retryError) => {
        console.error("Failed to resolve duplicate referral code:", retryError);
        next(new Error("Could not generate unique referral code"));
      });
  } else {
    next(error);
  }
});

// MIGRATION SCRIPT - Fix existing customers
customerSchema.statics.fixAllReferralCodes = async function () {
  try {
    console.log("Starting referral code migration...");

    const customersToFix = await this.find({
      $or: [
        { referralCode: { $exists: false } },
        { referralCode: null },
        { referralCode: "" },
        { referralCode: /^CM68789a/ },
      ],
    });

    console.log(`Found ${customersToFix.length} customers to fix`);

    for (let i = 0; i < customersToFix.length; i++) {
      const customer = customersToFix[i];

      try {
        if (customer.phoneNumber && customer.phoneNumber.length > 0) {
          const newCode = await generateUniqueReferralCode(
            customer.phoneNumber[0],
            customer._id
          );

          await this.updateOne(
            { _id: customer._id },
            { $set: { referralCode: newCode } }
          );

          console.log(`Fixed customer ${customer.name}: ${newCode}`);
        }
      } catch (error) {
        console.error(`Failed to fix customer ${customer._id}:`, error);
      }
    }

    console.log("Referral code migration completed");
  } catch (error) {
    console.error("Error in referral code migration:", error);
    throw error;
  }
};

// UTILITY METHOD - Regenerate referral code for specific customer
customerSchema.methods.regenerateReferralCode = async function () {
  try {
    const newCode = await generateUniqueReferralCode(
      this.phoneNumber[0],
      this._id
    );

    this.referralCode = newCode;
    await this.save();

    return newCode;
  } catch (error) {
    console.error("Error regenerating referral code:", error);
    throw error;
  }
};

customerSchema.methods.verifyItemForLoading = function (
  orderId,
  itemIndex,
  verified,
  notes,
  staffInfo
) {
  const orderIndex = this.shoppingHistory.findIndex(
    (o) => o.orderId === orderId
  );

  if (orderIndex === -1) {
    throw new Error("Order not found");
  }

  if (!this.shoppingHistory[orderIndex].items[itemIndex]) {
    throw new Error("Item not found");
  }

  this.shoppingHistory[orderIndex].items[itemIndex].loadingVerified = verified;
  this.shoppingHistory[orderIndex].items[itemIndex].loadingNotes = notes || "";
  this.shoppingHistory[orderIndex].items[itemIndex].loadingVerifiedAt =
    new Date();
  this.shoppingHistory[orderIndex].items[itemIndex].loadingVerifiedBy = {
    ...staffInfo,
    timestamp: new Date(),
  };

  const order = this.shoppingHistory[orderIndex];
  const verifiedItems = order.items.filter(
    (item) => item.loadingVerified === true
  ).length;
  const totalItems = order.items.length;

  if (!order.loadingDetails) order.loadingDetails = {};
  order.loadingDetails.totalItemsLoaded = verifiedItems;
  order.loadingDetails.totalItemsRequested = totalItems;
  order.loadingDetails.loadingProgress = Math.round(
    (verifiedItems / totalItems) * 100
  );

  return this.save();
};

customerSchema.methods.completeOrderLoading = function (
  orderId,
  loadingNotes,
  staffInfo
) {
  const orderIndex = this.shoppingHistory.findIndex(
    (o) => o.orderId === orderId
  );

  if (orderIndex === -1) {
    throw new Error("Order not found");
  }

  const order = this.shoppingHistory[orderIndex];

  const allItemsVerified = order.items.every(
    (item) => item.loadingVerified === true
  );

  if (!allItemsVerified) {
    throw new Error(
      "Cannot complete loading. Some items are still pending verification."
    );
  }

  this.shoppingHistory[orderIndex].status = "ready-to-pickup";

  if (!this.shoppingHistory[orderIndex].loadingDetails) {
    this.shoppingHistory[orderIndex].loadingDetails = {};
  }

  this.shoppingHistory[orderIndex].loadingDetails.verificationCompletedAt =
    new Date();
  this.shoppingHistory[orderIndex].loadingDetails.loadingNotes = loadingNotes;
  this.shoppingHistory[orderIndex].loadingDetails.loadingProgress = 100;
  this.shoppingHistory[orderIndex].loadingDetails.isReadyForDispatch = true;

  return this.save();
};

customerSchema.statics.getOrdersForVerification = async function () {
  const customers = await this.find({
    "shoppingHistory.status": {
      $in: ["assigned-dispatch-officer-2", "ready-to-pickup"],
    },
  }).lean();

  let orders = [];

  for (let customer of customers) {
    for (let order of customer.shoppingHistory) {
      if (
        ["assigned-dispatch-officer-2", "ready-to-pickup"].includes(
          order.status
        )
      ) {
        orders.push({
          customerId: customer._id,
          customerName: customer.name,
          customerPhone: customer.phoneNumber[0] || "",
          ...order,
        });
      }
    }
  }

  return orders;
};

customerSchema.statics.getVehicleAssignments = async function () {
  const customers = await this.find({
    "shoppingHistory.status": {
      $in: ["assigned-dispatch-officer-2", "ready-to-pickup"],
    },
  }).lean();

  let vehicleAssignments = {};

  for (let customer of customers) {
    for (let order of customer.shoppingHistory) {
      if (
        ["assigned-dispatch-officer-2", "ready-to-pickup"].includes(
          order.status
        )
      ) {
        const assignmentDetails = order.assignmentDetails;

        if (assignmentDetails && assignmentDetails.assignedVehicle) {
          const vehicleId = assignmentDetails.assignedVehicle.vehicleId;

          if (!vehicleAssignments[vehicleId]) {
            vehicleAssignments[vehicleId] = {
              vehicleInfo: assignmentDetails.assignedVehicle,
              orders: [],
            };
          }

          vehicleAssignments[vehicleId].orders.push({
            orderId: order.orderId,
            customerName: customer.name,
            status: order.status,
            items: order.items || [],
            loadingDetails: order.loadingDetails || {},
          });
        }
      }
    }
  }

  return vehicleAssignments;
};

customerSchema.methods.addToChatHistory = function (message, sender) {
  this.chatHistory.push({
    message,
    sender,
    timestamp: new Date(),
  });
  this.lastInteraction = new Date();
  return this.save();
};

customerSchema.methods.updateConversationState = function (newState) {
  this.conversationState = newState;
  this.lastInteraction = new Date();
  return this.save();
};

customerSchema.methods.addToCart = function (product, quantity, weight) {
  const existingItemIndex = this.cart.items.findIndex(
    (item) => item.productId === product.id && item.weight === weight
  );

  if (existingItemIndex > -1) {
    this.cart.items[existingItemIndex].quantity += quantity;
    this.cart.items[existingItemIndex].totalPrice =
      this.cart.items[existingItemIndex].price *
      this.cart.items[existingItemIndex].quantity;
  } else {
    this.cart.items.push({
      productId: product.id,
      productName: product.name,
      category: product.category,
      subCategory: product.subCategory,
      weight: weight,
      quantity: quantity,
      price: product.price,
      totalPrice: product.price * quantity,
      imageUrl: product.imageUrl,
    });
  }

  this.cart.totalAmount = this.cart.items.reduce(
    (total, item) => total + item.totalPrice,
    0
  );

  return this.save();
};

customerSchema.methods.removeFromCart = function (productId, weight) {
  this.cart.items = this.cart.items.filter(
    (item) => !(item.productId === productId && item.weight === weight)
  );

  this.cart.totalAmount = this.cart.items.reduce(
    (total, item) => total + item.totalPrice,
    0
  );

  return this.save();
};

customerSchema.methods.emptyCart = function () {
  this.cart.items = [];
  this.cart.totalAmount = 0;
  this.cart.deliveryCharge = 0;
  this.cart.deliveryOption = "Normal Delivery";
  this.cart.deliveryLocation = "";

  return this.save();
};

customerSchema.methods.createOrder = function () {
  const orderId = "ORD" + Date.now().toString().slice(-8);

  const newOrder = {
    orderId: orderId,
    items: [...this.cart.items],
    totalAmount: this.cart.totalAmount + (this.cart.deliveryCharge || 0),
    deliveryOption: this.cart.deliveryOption,
    deliveryLocation: this.cart.deliveryLocation,
    deliveryCharge: this.cart.deliveryCharge,
    paymentStatus: "pending",
    orderDate: new Date(),
  };

  this.orderHistory.push(newOrder);

  return this.save().then(() => orderId);
};

customerSchema.methods.addToShoppingHistory = function (orderData) {
  this.shoppingHistory.push(orderData);
  this.isFirstTimeCustomer = false;
  return this.save();
};

customerSchema.methods.addReferral = function (referrerData, isPrimary = true) {
  if (!this.referralTracking) {
    this.referralTracking = {
      primaryReferrer: null,
      additionalReferrers: [],
      allReferralSources: [],
    };
  }

  const referralEntry = {
    ...referrerData,
    referralDate: new Date(),
  };

  this.referralTracking.allReferralSources.push(referralEntry);

  if (isPrimary && !this.referralTracking.primaryReferrer) {
    this.referralTracking.primaryReferrer = referralEntry;
  } else {
    this.referralTracking.additionalReferrers.push(referralEntry);
  }

  return this.save();
};

customerSchema.methods.updateForemanStatus = function (
  isApproved,
  staffInfo,
  reason = ""
) {
  if (!this.foremanStatus) {
    this.foremanStatus = {
      isForemanApproved: false,
      isCommissionEligible: false,
      commissionRate: 5,
      statusHistory: [],
    };
  }

  this.foremanStatus.isForemanApproved = isApproved;

  if (isApproved) {
    this.foremanStatus.foremanApprovalDate = new Date();
    this.foremanStatus.foremanApprovedBy = staffInfo;
  }

  this.foremanStatus.statusHistory.push({
    action: isApproved ? "foreman_approved" : "foreman_revoked",
    actionDate: new Date(),
    staffSignature: staffInfo,
    reason: reason,
  });

  return this.save();
};

customerSchema.methods.updateCommissionEligibility = function (
  isEligible,
  staffInfo,
  reason = ""
) {
  if (!this.foremanStatus) {
    this.foremanStatus = {
      isForemanApproved: false,
      isCommissionEligible: false,
      commissionRate: 5,
      statusHistory: [],
    };
  }

  this.foremanStatus.isCommissionEligible = isEligible;

  if (isEligible) {
    this.foremanStatus.commissionEligibilityDate = new Date();
    this.foremanStatus.commissionApprovedBy = staffInfo;

    if (!this.commissionTracking) {
      this.commissionTracking = {
        totalCommissionEarned: 0,
        totalCommissionPaid: 0,
        availableCommission: 0,
        commissionHistory: [],
      };
    }
  }

  this.foremanStatus.statusHistory.push({
    action: isEligible ? "commission_approved" : "commission_revoked",
    actionDate: new Date(),
    staffSignature: staffInfo,
    reason: reason,
  });

  return this.save();
};

customerSchema.methods.addCommissionEarned = function (
  orderData,
  referredCustomerData
) {
  if (!this.foremanStatus?.isCommissionEligible) {
    return Promise.resolve();
  }

  const eligibilityDate = this.foremanStatus.commissionEligibilityDate;
  const orderDate = new Date(orderData.orderDate);

  if (eligibilityDate && orderDate < eligibilityDate) {
    console.log(
      `Order ${orderData.orderId} placed before commission eligibility date`
    );
    return Promise.resolve();
  }

  const eligibleAmount = orderData.items.reduce((sum, item) => {
    return sum + (item.isDiscountedProduct ? 0 : item.totalPrice);
  }, 0);

  const commissionRate = this.foremanStatus.commissionRate || 5;
  const commissionAmount = (eligibleAmount * commissionRate) / 100;

  if (commissionAmount <= 0) {
    return Promise.resolve();
  }

  if (!this.commissionTracking) {
    this.commissionTracking = {
      totalCommissionEarned: 0,
      totalCommissionPaid: 0,
      availableCommission: 0,
      commissionHistory: [],
    };
  }

  this.commissionTracking.totalCommissionEarned += commissionAmount;
  this.commissionTracking.availableCommission += commissionAmount;

  this.commissionTracking.commissionHistory.push({
    type: "earned",
    amount: commissionAmount,
    date: new Date(),
    relatedOrderId: orderData.orderId,
    referredCustomerId: referredCustomerData.customerId,
    referredCustomerName: referredCustomerData.customerName,
    commissionRate: commissionRate,
    baseAmount: eligibleAmount,
    notes: `Commission earned from order ${orderData.orderId}`,
    isPaid: false,
  });

  return this.save();
};

customerSchema.methods.payCommission = function (
  amount,
  staffInfo,
  notes = ""
) {
  if (!this.commissionTracking) {
    throw new Error("No commission tracking found");
  }

  if (amount > this.commissionTracking.availableCommission) {
    throw new Error("Cannot pay more than available commission");
  }

  this.commissionTracking.totalCommissionPaid += amount;
  this.commissionTracking.availableCommission -= amount;

  this.commissionTracking.commissionHistory.push({
    type: "paid",
    amount: amount,
    date: new Date(),
    notes: notes,
    isPaid: true,
    paidDate: new Date(),
    staffSignature: {
      ...staffInfo,
      signatureDate: new Date(),
    },
  });

  return this.save();
};

customerSchema.methods.canSeeCommissionOptions = function () {
  return this.foremanStatus?.isCommissionEligible === true;
};

customerSchema.methods.getReferralDashboard = function () {
  return {
    referralCode: this.referralCode,
    customersReferred: this.customersReferred || [],
    totalReferrals: this.customersReferred?.length || 0,
    successfulReferrals:
      this.customersReferred?.filter((r) => r.hasPlacedOrder).length || 0,
    totalCommissionGenerated:
      this.customersReferred?.reduce(
        (sum, r) => sum + (r.commissionGenerated || 0),
        0
      ) || 0,
    isForemanApproved: this.foremanStatus?.isForemanApproved || false,
    isCommissionEligible: this.foremanStatus?.isCommissionEligible || false,
    commissionData: this.commissionTracking || {
      totalCommissionEarned: 0,
      totalCommissionPaid: 0,
      availableCommission: 0,
    },
  };
};

customerSchema.methods.createSupportTicket = function (ticketData) {
  if (!this.supportTickets) {
    this.supportTickets = [];
  }

  const ticket = {
    ticketId: "TICK" + Date.now().toString().slice(-8),
    ...ticketData,
    createdAt: new Date(),
    lastUpdated: new Date(),
  };

  this.supportTickets.push(ticket);
  return this.save().then(() => ticket.ticketId);
};

customerSchema.methods.addMediaToTicket = function (ticketId, mediaData) {
  const ticket = this.supportTickets.find((t) => t.ticketId === ticketId);
  if (ticket) {
    if (!ticket.mediaAttachments) {
      ticket.mediaAttachments = [];
    }
    ticket.mediaAttachments.push({
      ...mediaData,
      uploadedAt: new Date(),
    });
    ticket.lastUpdated = new Date();
    return this.save();
  }
  return Promise.reject(new Error("Ticket not found"));
};

customerSchema.methods.createComplaint = function (complaintData) {
  if (!this.complaints) {
    this.complaints = [];
  }

  const complaint = {
    complaintId: "COMP" + Date.now().toString().slice(-8),
    ...complaintData,
    submittedAt: new Date(),
  };

  this.complaints.push(complaint);
  return this.save().then(() => complaint.complaintId);
};

customerSchema.methods.updateSupportFlow = function (flowData) {
  if (!this.currentSupportFlow) {
    this.currentSupportFlow = {};
  }

  this.currentSupportFlow = {
    ...this.currentSupportFlow,
    ...flowData,
    lastInteraction: new Date(),
  };
  return this.save();
};

customerSchema.methods.clearSupportFlow = function () {
  this.currentSupportFlow = {
    mainCategory: null,
    subCategory: null,
    specificIssue: null,
    currentStep: null,
    tempData: {},
    mediaExpected: false,
    lastInteraction: new Date(),
    sessionId: null,
  };
  return this.save();
};

customerSchema.methods.logSupportInteraction = function (action, details = {}) {
  if (!this.supportInteractionHistory) {
    this.supportInteractionHistory = [];
  }

  const sessionId = this.currentSupportFlow?.sessionId || "SESS" + Date.now();

  let currentSession = this.supportInteractionHistory.find(
    (session) => session.sessionId === sessionId
  );

  if (currentSession) {
    currentSession.totalMessages += 1;
    currentSession.lastAction = action;
    currentSession.lastActionTime = new Date();
    if (details.mediaShared) {
      currentSession.mediaShared += 1;
    }
  } else {
    this.supportInteractionHistory.push({
      sessionId: sessionId,
      startTime: new Date(),
      category: this.currentSupportFlow?.mainCategory || "unknown",
      totalMessages: 1,
      mediaShared: details.mediaShared ? 1 : 0,
      lastAction: action,
      lastActionTime: new Date(),
    });

    if (this.currentSupportFlow) {
      this.currentSupportFlow.sessionId = sessionId;
    }
  }

  return this.save();
};

customerSchema.methods.addPaymentIssue = function (issueData) {
  if (!this.paymentIssues) {
    this.paymentIssues = [];
  }

  const paymentIssue = {
    issueId: "PAY" + Date.now().toString().slice(-8),
    ...issueData,
    reportedAt: new Date(),
  };

  this.paymentIssues.push(paymentIssue);
  return this.save().then(() => paymentIssue.issueId);
};

customerSchema.methods.addAddressChangeRequest = function (changeData) {
  if (!this.addressChangeHistory) {
    this.addressChangeHistory = [];
  }

  const addressChange = {
    ...changeData,
    requestedAt: new Date(),
    status: "pending",
  };

  this.addressChangeHistory.push(addressChange);
  return this.save();
};

customerSchema.methods.addFAQInteraction = function (question, category) {
  if (!this.faqInteractions) {
    this.faqInteractions = [];
  }

  this.faqInteractions.push({
    question: question,
    category: category,
    timestamp: new Date(),
    helpful: true,
  });

  return this.save();
};

customerSchema.methods.saveSupportMedia = function (mediaData) {
  if (!this.supportMedia) {
    this.supportMedia = [];
  }

  const supportMediaItem = {
    ...mediaData,
    uploadedAt: new Date(),
  };

  this.supportMedia.push(supportMediaItem);
  return this.save();
};

customerSchema.methods.updateOrderStatus = function (orderId, status) {
  const orderIndex = this.orderHistory.findIndex(
    (order) => order.orderId === orderId
  );

  if (orderIndex > -1) {
    this.orderHistory[orderIndex].status = status;
    return this.save();
  }

  return Promise.reject(new Error("Order not found"));
};

customerSchema.methods.calculatePerformanceScore = function () {
  const referrals = this.customersReferred?.length || 0;
  const videos = this.referralvideos ? this.referralvideos.length : 0;
  const totalSpent = this.getTotalSpent();
  const orders = this.shoppingHistory ? this.shoppingHistory.length : 0;

  const referralScore = Math.min(referrals * 10, 40);
  const videoScore = Math.min(videos * 5, 20);
  const spendingScore = Math.min(totalSpent / 50, 25);
  const loyaltyScore = Math.min(orders * 3, 15);

  const totalScore = referralScore + videoScore + spendingScore + loyaltyScore;

  return Math.round(totalScore);
};

customerSchema.methods.getTotalSpent = function () {
  if (!this.shoppingHistory || this.shoppingHistory.length === 0) {
    return 0;
  }

  return this.shoppingHistory.reduce((total, order) => {
    return total + (order.totalAmount || 0);
  }, 0);
};

customerSchema.methods.calculateOrderRequirements = function (orderId) {
  const order = this.shoppingHistory.find((o) => o.orderId === orderId);
  if (!order) return null;

  const items = order.items || [];

  let totalVolume = 0;
  let totalWeight = 0;
  let totalPackages = items.length;

  items.forEach((item) => {
    totalVolume += (item.quantity || 1) * 0.1;

    if (item.weight) {
      const weightMatch = item.weight.match(/(\d+(?:\.\d+)?)/);
      if (weightMatch) {
        totalWeight += parseFloat(weightMatch[1]) * (item.quantity || 1);
      }
    } else {
      totalWeight += (item.quantity || 1) * 0.5;
    }
  });

  const requirements = {
    calculatedVolume: Math.round(totalVolume * 100) / 100,
    calculatedWeight: Math.round(totalWeight * 100) / 100,
    totalPackages: totalPackages,
    lastCalculated: new Date(),
  };

  const orderIndex = this.shoppingHistory.findIndex(
    (o) => o.orderId === orderId
  );
  if (orderIndex !== -1) {
    this.shoppingHistory[orderIndex].orderRequirements = requirements;
  }

  return requirements;
};

customerSchema.methods.assignVehicleAndDriver = function (
  orderId,
  assignmentData
) {
  const orderIndex = this.shoppingHistory.findIndex(
    (o) => o.orderId === orderId
  );

  if (orderIndex === -1) {
    throw new Error("Order not found");
  }

  this.shoppingHistory[orderIndex].assignmentDetails = {
    ...assignmentData,
    assignedAt: new Date(),
  };

  this.shoppingHistory[orderIndex].status = "assigned-dispatch-officer-2";

  this.shoppingHistory[orderIndex].driver1 =
    assignmentData.assignedDriver.employeeName;

  return this.save();
};

customerSchema.statics.getOrdersReadyForAssignment = async function () {
  const customers = await this.find({
    "shoppingHistory.status": "ready-to-pickup",
  }).lean();

  let orders = [];

  for (let customer of customers) {
    for (let order of customer.shoppingHistory) {
      if (order.status === "ready-to-pickup") {
        if (
          !order.assignmentDetails ||
          !order.assignmentDetails.assignedVehicle
        ) {
          orders.push({
            customerId: customer._id,
            customerName: customer.name,
            customerPhone: customer.phoneNumber[0] || "",
            ...order,
          });
        }
      }
    }
  }

  return orders;
};

customerSchema.methods.isEligibleForForeman = function () {
  const performanceScore = this.calculatePerformanceScore();
  const totalSpent = this.getTotalSpent();
  const hasVideos = this.referralvideos && this.referralvideos.length > 0;
  const hasOrders = this.shoppingHistory && this.shoppingHistory.length >= 2;

  return performanceScore >= 30 && totalSpent >= 100 && hasVideos && hasOrders;
};

customerSchema.methods.getCommissionDashboard = function () {
  return {
    commissionEarned: this.commissionTracking?.totalCommissionEarned || 0,
    commissionPaid: this.commissionTracking?.totalCommissionPaid || 0,
    availableCommission: this.commissionTracking?.availableCommission || 0,
    commissionApproved: this.foremanStatus?.isCommissionEligible || false,
    commissionRate: this.foremanStatus?.commissionRate || 5,
    successfulReferrals:
      this.customersReferred?.filter((r) => r.hasPlacedOrder).length || 0,
    totalReferrals: this.customersReferred?.length || 0,
    commissionHistory: this.commissionTracking?.commissionHistory || [],
  };
};

customerSchema.methods.getSupportDashboard = function () {
  return {
    activeTickets:
      this.supportTickets?.filter((t) => t.status === "open").length || 0,
    totalTickets: this.supportTickets?.length || 0,
    complaints: this.complaints?.length || 0,
    paymentIssues:
      this.paymentIssues?.filter((p) => p.status === "reported").length || 0,
    addressChanges:
      this.addressChangeHistory?.filter((a) => a.status === "pending").length ||
      0,
    supportPreferences: this.supportPreferences || {},
    lastSupportInteraction: this.currentSupportFlow?.lastInteraction || null,
  };
};

customerSchema.methods.addReferredCustomer = async function (
  referredCustomerData
) {
  const referredCustomer = await mongoose
    .model("Customer")
    .findById(referredCustomerData.customerId);

  if (!referredCustomer) {
    throw new Error("Referred customer not found");
  }

  referredCustomer.referredBy = {
    customerId: this._id,
    phoneNumber: this.phoneNumber[0],
    name: this.name,
    videoId: referredCustomerData.videoUsed,
    dateReferred: new Date(),
  };

  await referredCustomer.save();

  if (!this.customersReferred) {
    this.customersReferred = [];
  }

  const existingReferralIndex = this.customersReferred.findIndex(
    (ref) =>
      ref.customerId.toString() === referredCustomerData.customerId.toString()
  );

  if (existingReferralIndex === -1) {
    this.customersReferred.push({
      customerId: referredCustomer._id,
      customerName: referredCustomer.name,
      phoneNumber: referredCustomer.phoneNumber[0],
      referralDate: new Date(),
      videoUsed: referredCustomerData.videoUsed,
      hasPlacedOrder: false,
      firstOrderDate: null,
      totalOrdersCount: 0,
      totalSpentAmount: 0,
      commissionGenerated: 0,
    });
  }

  return this.save();
};

customerSchema.methods.updateReferredCustomerOrder = async function (
  referredCustomerId,
  orderAmount
) {
  if (!this.customersReferred) {
    return;
  }

  const referral = this.customersReferred.find(
    (ref) => ref.customerId.toString() === referredCustomerId.toString()
  );

  if (referral) {
    if (!referral.hasPlacedOrder) {
      referral.hasPlacedOrder = true;
      referral.firstOrderDate = new Date();
    }

    referral.totalOrdersCount += 1;
    referral.totalSpentAmount += orderAmount;

    if (this.foremanStatus?.isCommissionEligible) {
      const commissionRate = this.foremanStatus.commissionRate || 5;
      const commission = (orderAmount * commissionRate) / 100;
      referral.commissionGenerated += commission;
    }

    await this.save();
  }
};

customerSchema.pre("save", async function (next) {
  if (this.isNew && this.referredBy) {
    try {
      const referrer = await mongoose
        .model("Customer")
        .findById(this.referredBy.customerId);
      if (referrer) {
        await referrer.addReferredCustomer({
          customerId: this._id,
          videoUsed: this.referredBy.videoId,
        });
      }
    } catch (error) {
      console.error("Error updating referrer:", error);
    }
  }
  next();
});

customerSchema.methods.checkDeliveryMediaComplete = function (orderId) {
  const order = this.shoppingHistory.find((o) => o.orderId === orderId);
  if (!order || !order.deliveryMedia) return false;

  const media = order.deliveryMedia;

  // Check mandatory items
  const hasDeliveryVideo =
    media.deliveryVideo && media.deliveryVideo.base64Data;
  const hasEntrancePhoto =
    media.entrancePhoto && media.entrancePhoto.base64Data;
  const hasReceiptInHand =
    media.receiptInHandPhoto && media.receiptInHandPhoto.base64Data;
  const hasReceiptCloseUp =
    media.receiptCloseUpPhoto && media.receiptCloseUpPhoto.base64Data;
  const hasReceiptNextToFace =
    media.receiptNextToFacePhoto && media.receiptNextToFacePhoto.base64Data;

  // Check if complaint video is needed and uploaded
  const needsComplaintVideo = media.hasCustomerComplaints === true;
  const hasComplaintVideo =
    media.complaintVideo && media.complaintVideo.base64Data;

  const complaintVideoOk = needsComplaintVideo ? hasComplaintVideo : true;

  return (
    hasDeliveryVideo &&
    hasEntrancePhoto &&
    hasReceiptInHand &&
    hasReceiptCloseUp &&
    hasReceiptNextToFace &&
    complaintVideoOk
  );
};

// Export for reference
module.exports = {
  DELIVERY_MEDIA_REQUIREMENTS: {
    DELIVERY_VIDEO: "deliveryVideo",
    COMPLAINT_VIDEO: "complaintVideo",
    ENTRANCE_PHOTO: "entrancePhoto",
    RECEIPT_IN_HAND: "receiptInHandPhoto",
    RECEIPT_CLOSE_UP: "receiptCloseUpPhoto",
    RECEIPT_NEXT_TO_FACE: "receiptNextToFacePhoto",
  },
};

const Customer = mongoose.model("Customer", customerSchema);

module.exports = Customer;
