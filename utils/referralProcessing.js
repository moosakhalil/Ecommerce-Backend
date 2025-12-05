// middleware/orderProcessing.js
const Customer = require("../models/customer");

/**
 * Middleware to process orders and handle referral commissions
 */
class OrderProcessingMiddleware {
  /**
   * Process a new order and handle all related operations
   * @param {Object} orderData - The order information
   * @param {String} customerId - The customer placing the order
   * @returns {Object} - Processing result
   */
  static async processNewOrder(orderData, customerId) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        throw new Error("Customer not found");
      }

      // 1. Add order to customer's shopping history
      const enhancedOrderData = {
        ...orderData,
        orderId: orderData.orderId || "ORD" + Date.now().toString().slice(-8),
        orderDate: new Date(),
        status: orderData.status || "order-confirmed",
        paymentStatus: orderData.paymentStatus || "paid",
      };

      await customer.addToShoppingHistory(enhancedOrderData);

      // 2. Process referral commission if applicable
      const commissionResult = await this.processReferralCommission(
        customer,
        enhancedOrderData
      );

      // 3. Update first-time customer status
      if (customer.isFirstTimeCustomer) {
        customer.isFirstTimeCustomer = false;
        await customer.save();
      }

      return {
        success: true,
        orderId: enhancedOrderData.orderId,
        commissionProcessed: commissionResult.processed,
        commissionAmount: commissionResult.amount,
        referrerInfo: commissionResult.referrerInfo,
      };
    } catch (error) {
      console.error("Error processing order:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Process referral commission for an order
   * @param {Object} customer - The customer who placed the order
   * @param {Object} orderData - The order information
   * @returns {Object} - Commission processing result
   */
  static async processReferralCommission(customer, orderData) {
    try {
      // Check if customer was referred
      const primaryReferrer = customer.referralTracking?.primaryReferrer;
      if (!primaryReferrer) {
        return { processed: false, amount: 0, referrerInfo: null };
      }

      // Find the referrer customer
      const referrerCustomer = await Customer.findById(
        primaryReferrer.customerId
      );
      if (!referrerCustomer) {
        console.log("Referrer customer not found");
        return { processed: false, amount: 0, referrerInfo: null };
      }

      // Check if referrer is eligible for commission
      if (!referrerCustomer.foremanStatus?.isCommissionEligible) {
        console.log("Referrer not eligible for commission");
        return {
          processed: false,
          amount: 0,
          referrerInfo: referrerCustomer.name,
        };
      }

      // Check if order date is after commission eligibility date
      const eligibilityDate =
        referrerCustomer.foremanStatus.commissionEligibilityDate;
      const orderDate = new Date(orderData.orderDate);

      if (eligibilityDate && orderDate < eligibilityDate) {
        console.log("Order placed before commission eligibility date");
        return {
          processed: false,
          amount: 0,
          referrerInfo: referrerCustomer.name,
        };
      }

      // Update referrer's customersReferred array
      await this.updateReferrerRecord(referrerCustomer, customer, orderData);

      // Calculate and add commission
      const commissionAmount = await referrerCustomer.addCommissionEarned(
        orderData,
        {
          customerId: customer._id,
          customerName: customer.name,
        }
      );

      console.log(
        `Commission of ${commissionAmount} processed for referrer ${referrerCustomer.name}`
      );

      return {
        processed: true,
        amount: commissionAmount,
        referrerInfo: {
          id: referrerCustomer._id,
          name: referrerCustomer.name,
          totalCommission:
            referrerCustomer.commissionTracking?.totalCommissionEarned || 0,
        },
      };
    } catch (error) {
      console.error("Error processing referral commission:", error);
      return { processed: false, amount: 0, referrerInfo: null };
    }
  }

  /**
   * Update referrer's customer record with new referral data
   * @param {Object} referrerCustomer - The referrer customer
   * @param {Object} referredCustomer - The referred customer
   * @param {Object} orderData - The order data
   */
  static async updateReferrerRecord(
    referrerCustomer,
    referredCustomer,
    orderData
  ) {
    // Initialize customersReferred array if not exists
    if (!referrerCustomer.customersReferred) {
      referrerCustomer.customersReferred = [];
    }

    // Find existing referral record
    let referralRecord = referrerCustomer.customersReferred.find(
      (r) => r.customerId === referredCustomer._id.toString()
    );

    if (referralRecord) {
      // Update existing record
      if (!referralRecord.hasPlacedOrder) {
        referralRecord.hasPlacedOrder = true;
        referralRecord.firstOrderDate = new Date();
      }
      referralRecord.totalOrdersCount =
        (referralRecord.totalOrdersCount || 0) + 1;
      referralRecord.totalSpentAmount =
        (referralRecord.totalSpentAmount || 0) + orderData.totalAmount;
    } else {
      // Create new referral record
      const primaryReferrer =
        referredCustomer.referralTracking?.primaryReferrer;
      referralRecord = {
        customerId: referredCustomer._id.toString(),
        customerName: referredCustomer.name,
        phoneNumber: referredCustomer.phoneNumber[0],
        referralDate: primaryReferrer?.referralDate || new Date(),
        hasPlacedOrder: true,
        firstOrderDate: new Date(),
        totalOrdersCount: 1,
        totalSpentAmount: orderData.totalAmount,
        commissionGenerated: 0,
      };
      referrerCustomer.customersReferred.push(referralRecord);
    }

    // Calculate commission for this order
    const eligibleAmount = orderData.items.reduce((sum, item) => {
      return sum + (item.isDiscountedProduct ? 0 : item.totalPrice);
    }, 0);

    const commissionRate = referrerCustomer.foremanStatus?.commissionRate || 5;
    const orderCommission = (eligibleAmount * commissionRate) / 100;

    referralRecord.commissionGenerated =
      (referralRecord.commissionGenerated || 0) + orderCommission;

    await referrerCustomer.save();
  }

  /**
   * Process order refund and update commission
   * @param {String} customerId - Customer ID
   * @param {String} orderId - Order ID
   * @param {Object} refundData - Refund information
   * @param {Object} staffInfo - Staff signature information
   */
  static async processOrderRefund(customerId, orderId, refundData, staffInfo) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        throw new Error("Customer not found");
      }

      // Find the order in shopping history
      const orderIndex = customer.shoppingHistory.findIndex(
        (order) => order.orderId === orderId
      );
      if (orderIndex === -1) {
        throw new Error("Order not found");
      }

      const order = customer.shoppingHistory[orderIndex];

      // Add refund to order
      const refund = {
        refundId: "REF" + Date.now().toString().slice(-8),
        refundDate: new Date(),
        refundAmount: refundData.refundAmount,
        refundReason: refundData.refundReason,
        refundedItems: refundData.refundedItems || [],
        staffSignature: {
          ...staffInfo,
          signatureDate: new Date(),
        },
        isImmutable: true,
      };

      if (!order.refunds) {
        order.refunds = [];
      }
      order.refunds.push(refund);

      // Update order status if fully refunded
      const totalRefunded = order.refunds.reduce(
        (sum, ref) => sum + ref.refundAmount,
        0
      );
      if (totalRefunded >= order.totalAmount) {
        order.status = "order-refunded";
      }

      await customer.save();

      // Handle commission adjustment if customer was referred
      await this.adjustCommissionForRefund(customer, order, refundData);

      return {
        success: true,
        refundId: refund.refundId,
        message: "Refund processed successfully",
      };
    } catch (error) {
      console.error("Error processing refund:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Adjust commission when an order is refunded
   * @param {Object} customer - The customer who got refunded
   * @param {Object} order - The refunded order
   * @param {Object} refundData - Refund information
   */
  static async adjustCommissionForRefund(customer, order, refundData) {
    try {
      const primaryReferrer = customer.referralTracking?.primaryReferrer;
      if (!primaryReferrer) return;

      const referrerCustomer = await Customer.findById(
        primaryReferrer.customerId
      );
      if (
        !referrerCustomer ||
        !referrerCustomer.foremanStatus?.isCommissionEligible
      )
        return;

      // Calculate commission reduction
      const commissionRate = referrerCustomer.foremanStatus.commissionRate || 5;
      const commissionReduction =
        (refundData.refundAmount * commissionRate) / 100;

      // Reduce available commission
      if (referrerCustomer.commissionTracking) {
        referrerCustomer.commissionTracking.availableCommission -=
          commissionReduction;

        // Add adjustment record
        referrerCustomer.commissionTracking.commissionHistory.push({
          type: "adjustment",
          amount: -commissionReduction,
          date: new Date(),
          relatedOrderId: order.orderId,
          referredCustomerId: customer._id.toString(),
          referredCustomerName: customer.name,
          notes: `Commission adjustment for refund ${
            refundData.refundId || "N/A"
          }`,
          isPaid: false,
        });

        await referrerCustomer.save();
      }
    } catch (error) {
      console.error("Error adjusting commission for refund:", error);
    }
  }

  /**
   * Process order replacement
   * @param {String} customerId - Customer ID
   * @param {String} orderId - Order ID
   * @param {Object} replacementData - Replacement information
   * @param {Object} staffInfo - Staff signature information
   */
  static async processOrderReplacement(
    customerId,
    orderId,
    replacementData,
    staffInfo
  ) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        throw new Error("Customer not found");
      }

      const orderIndex = customer.shoppingHistory.findIndex(
        (order) => order.orderId === orderId
      );
      if (orderIndex === -1) {
        throw new Error("Order not found");
      }

      const order = customer.shoppingHistory[orderIndex];

      // Add replacement to order
      const replacement = {
        replacementId: "REP" + Date.now().toString().slice(-8),
        replacementDate: new Date(),
        replacementReason: replacementData.replacementReason,
        originalItems: replacementData.originalItems || [],
        replacementItems: replacementData.replacementItems || [],
        priceDifference: replacementData.priceDifference || 0,
        staffSignature: {
          ...staffInfo,
          signatureDate: new Date(),
        },
        isImmutable: true,
      };

      if (!order.replacements) {
        order.replacements = [];
      }
      order.replacements.push(replacement);

      await customer.save();

      return {
        success: true,
        replacementId: replacement.replacementId,
        message: "Replacement processed successfully",
      };
    } catch (error) {
      console.error("Error processing replacement:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Add correction to an order
   * @param {String} customerId - Customer ID
   * @param {String} orderId - Order ID
   * @param {Object} correctionData - Correction information
   * @param {Object} staffInfo - Staff signature information
   */
  static async addOrderCorrection(
    customerId,
    orderId,
    correctionData,
    staffInfo
  ) {
    try {
      const customer = await Customer.findById(customerId);
      if (!customer) {
        throw new Error("Customer not found");
      }

      const orderIndex = customer.shoppingHistory.findIndex(
        (order) => order.orderId === orderId
      );
      if (orderIndex === -1) {
        throw new Error("Order not found");
      }

      const order = customer.shoppingHistory[orderIndex];

      // Add correction to order
      const correction = {
        correctionId: "COR" + Date.now().toString().slice(-8),
        correctionDate: new Date(),
        originalField: correctionData.originalField,
        originalValue: correctionData.originalValue,
        newValue: correctionData.newValue,
        correctionReason: correctionData.correctionReason,
        staffSignature: {
          ...staffInfo,
          signatureDate: new Date(),
        },
        isImmutable: true,
      };

      if (!order.corrections) {
        order.corrections = [];
      }
      order.corrections.push(correction);

      await customer.save();

      return {
        success: true,
        correctionId: correction.correctionId,
        message: "Correction added successfully",
      };
    } catch (error) {
      console.error("Error adding correction:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get comprehensive order analytics
   * @param {String} customerId - Customer ID (optional)
   * @returns {Object} - Analytics data
   */
  static async getOrderAnalytics(customerId = null) {
    try {
      let matchCondition = {};
      if (customerId) {
        matchCondition._id = mongoose.Types.ObjectId(customerId);
      }

      const analytics = await Customer.aggregate([
        { $match: matchCondition },
        {
          $project: {
            name: 1,
            totalOrders: { $size: { $ifNull: ["$shoppingHistory", []] } },
            totalSpent: {
              $reduce: {
                input: { $ifNull: ["$shoppingHistory", []] },
                initialValue: 0,
                in: { $add: ["$value", { $ifNull: ["$this.totalAmount", 0] }] },
              },
            },
            totalRefunded: {
              $reduce: {
                input: { $ifNull: ["$shoppingHistory", []] },
                initialValue: 0,
                in: {
                  $add: [
                    "$value",
                    {
                      $reduce: {
                        input: { $ifNull: ["$this.refunds", []] },
                        initialValue: 0,
                        in: {
                          $add: [
                            "$value",
                            { $ifNull: ["$this.refundAmount", 0] },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
            avgOrderValue: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ["$shoppingHistory", []] } }, 0] },
                {
                  $divide: [
                    {
                      $reduce: {
                        input: { $ifNull: ["$shoppingHistory", []] },
                        initialValue: 0,
                        in: {
                          $add: [
                            "$value",
                            { $ifNull: ["$this.totalAmount", 0] },
                          ],
                        },
                      },
                    },
                    { $size: { $ifNull: ["$shoppingHistory", []] } },
                  ],
                },
                0,
              ],
            },
            commissionGenerated: {
              $ifNull: ["$commissionTracking.totalCommissionEarned", 0],
            },
            isForeman: { $ifNull: ["$foremanStatus.isForemanApproved", false] },
            isCommissionEligible: {
              $ifNull: ["$foremanStatus.isCommissionEligible", false],
            },
          },
        },
      ]);

      return {
        success: true,
        analytics: analytics,
      };
    } catch (error) {
      console.error("Error getting analytics:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

module.exports = OrderProcessingMiddleware;
