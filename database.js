// Run this script to fix existing customers:
const Customer = require("./models/customer");

async function fixReferralCodes() {
  try {
    const customers = await Customer.find({});

    for (let customer of customers) {
      if (
        !customer.referralCode ||
        customer.referralCode.startsWith("CM68789a")
      ) {
        const timestamp = Date.now().toString().slice(-6);
        const random = Math.random().toString(36).substring(2, 4).toUpperCase();
        const phoneDigits = customer.phoneNumber[0]
          ? customer.phoneNumber[0].slice(-2)
          : "00";

        customer.referralCode = `CM${phoneDigits}${timestamp}${random}`;
        await customer.save();
        console.log(
          `Fixed referral code for ${customer.name}: ${customer.referralCode}`
        );
      }
    }

    console.log("All referral codes fixed!");
  } catch (error) {
    console.error("Error fixing referral codes:", error);
  }
}

// Run this function
fixReferralCodes();
