const express = require("express");
const router = express.Router();

/**
 * Chatbot Messages Viewer API
 * Returns a list of all chatbot messages with their code locations
 * for easy reference when making code changes
 */

// Pre-defined message list with code locations
// File: backend/routes/chatbot-router.js
const CHATBOT_MESSAGES = [
  // ============== WELCOME & ONBOARDING ==============
  {
    key: "welcome_greeting",
    category: "welcome",
    displayName: "Welcome Greeting",
    content: "Hello! Welcome to Construction Materials Hub, your one-stop shop for construction materials. 😊 How can I assist you today?",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2053
  },
  {
    key: "welcome_ask_name",
    category: "welcome",
    displayName: "First Time Name Request",
    content: "I see this is your first time contacting us, can I ask your name?",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2059
  },
  {
    key: "welcome_personalized",
    category: "welcome",
    displayName: "Personalized Greeting",
    content: "Hi {{name}}, how can I assist you?",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2094
  },

  // ============== MAIN MENU ==============
  {
    key: "menu_invalid_choice",
    category: "menu",
    displayName: "Invalid Menu Selection",
    content: "I didn't understand that choice. Please select a number from the menu or type 0 to see the main menu again.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2218
  },
  {
    key: "menu_no_order_history",
    category: "menu",
    displayName: "No Order History",
    content: "You don't have any order history yet. Start shopping to create your first order!",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2118
  },

  // ============== REFERRAL PROGRAM ==============
  {
    key: "referral_intro",
    category: "referral",
    displayName: "Referral Program Introduction",
    content: "🎉 Welcome to our Referral Program!\n\n🎥 Share videos with friends and earn rewards!\n\n📱 Please record and send your referral video now\n\n📏 Max size: 15MB\n⏱️ Keep it under 1 minute for best results!",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2134
  },
  {
    key: "referral_send_video_prompt",
    category: "referral",
    displayName: "Send Referral Video Prompt",
    content: "📱 Send your video now or type '0' to return to main menu",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2150
  },

  // ============== SUPPORT ==============
  {
    key: "support_menu",
    category: "support",
    displayName: "Customer Support Menu",
    content: "📞 *Customer Support* 📞\n\nHow can we help you today?\n\n1. Delivery & Product Issues\n2. Check My Delivery\n3. Payment Problems\n4. Speak to an Agent\n5. Submit a Complaint\n6. FAQs\n\nType the number to continue or 0 to return to main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2160
  },

  // ============== PROFILE ==============
  {
    key: "profile_menu",
    category: "profile",
    displayName: "Profile Menu Options",
    content: "What would you like to do?\n\n1. Update Name\n2. Update Email\n3. Manage Addresses\n4. My Account\n5. Manage Bank Accounts\n6. Return to Main Menu",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2198
  },

  // ============== CART ==============
  {
    key: "cart_empty",
    category: "cart",
    displayName: "Cart Already Empty",
    content: "Your cart is already empty.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2837
  },
  {
    key: "cart_confirm_empty",
    category: "cart",
    displayName: "Confirm Empty Cart",
    content: "Are you sure you want to empty your cart?\n\n1. Yes, empty my cart\n2. No, keep my items",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2863
  },
  {
    key: "cart_no_details",
    category: "cart",
    displayName: "No Product Details in Cart",
    content: "Your cart is empty. There are no product details to view.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2892
  },
  {
    key: "cart_invalid_option",
    category: "cart",
    displayName: "Invalid Cart Option",
    content: "Please select a valid option (A-E) or type 0 to return to the main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2912
  },
  {
    key: "cart_empty_for_checkout",
    category: "cart",
    displayName: "Cart Empty For Checkout",
    content: "❌ Your cart is empty. Please add items to your cart before checkout.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 4335
  },

  // ============== PICKUP FLOW ==============
  {
    key: "pickup_date_invalid",
    category: "pickup",
    displayName: "Invalid Pickup Date Selection",
    content: "❌ Please choose a valid option:\n1. Today\n2. Tomorrow\n3. Later",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2921
  },
  {
    key: "pickup_time_slots",
    category: "pickup",
    displayName: "Pickup Time Slot Selection",
    content: "✅ Got it! You're picking up on *{{date}}*.\n\n🕒 Now select your preferred pickup time slot:\n\n1. 6 AM – 9 AM\n2. 9 AM – 12 PM\n3. 12 PM – 3 PM\n4. 3 PM – 6 PM\n5. 6 PM – 9 PM",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2976
  },
  {
    key: "pickup_invalid_time",
    category: "pickup",
    displayName: "Invalid Pickup Time Selection",
    content: "❌ Please select a valid time slot (1–5).",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2800
  },
  {
    key: "pickup_date_list_missing",
    category: "pickup",
    displayName: "Pickup Date List Missing Error",
    content: "⚠️ Something went wrong (date list missing). Please type *menu* and try again.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2751
  },
  {
    key: "pickup_invalid_list_selection",
    category: "pickup",
    displayName: "Invalid Pickup List Selection",
    content: "❌ Please select a valid number from the list (1–13).",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2760
  },
  {
    key: "pickup_confirmation",
    category: "pickup",
    displayName: "Pickup Order Confirmation",
    content: "✅ Your order is in progress and will be confirmed once payment is verified!\n\n🧾 Order ID: *#{{orderId}}*\n📦 We'll expect you on *{{date}}* between *{{timeSlot}}*.\n\nThank you for shopping with us! 😊",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2812
  },

  // ============== REMINDERS ==============
  {
    key: "reminder_cart_cleared",
    category: "reminder",
    displayName: "Cart Cleared Due to Inactivity",
    content: "⏰ Your cart was cleared due to inactivity (no payment for 24 hours).\n\nType 'hi' to start fresh shopping! 🛍️",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 485
  },
  {
    key: "reminder_pickup",
    category: "reminder",
    displayName: "Pickup Reminder",
    content: "📦 *Pickup Reminder!* 📦\n\nHi {{name}}, just a reminder that your order is ready for pickup *today* between *{{timeSlot}}*.\n\nOrder ID: #{{orderId}}\n\nIf you need help, just reply with *support* anytime.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2039
  },

  // ============== ORDER NOTIFICATIONS ==============
  {
    key: "order_confirmed_header",
    category: "order",
    displayName: "Order Confirmed Header",
    content: "🎉 *ORDER CONFIRMED!* 🎉\n\n📄 Please find your order confirmation PDF attached.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 1115
  },
  {
    key: "order_confirmed_thank_you",
    category: "order",
    displayName: "Order Confirmed Thank You",
    content: "Thank you for choosing Construction Materials Hub! 🏗️",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 1144
  },

  // ============== DELIVERY NOTIFICATIONS ==============
  {
    key: "delivery_on_way",
    category: "delivery",
    displayName: "Order On The Way",
    content: "🚚 *Your Order is On the Way!* 🚚\n\nOrder #{{orderId}}\n📦 Status: On Delivery\n\nYour product is on the way and will be delivered to you soon.\n\n📍 Delivery Area: {{location}}\n⏰ Expected Time: {{timeFrame}}\n\nPlease be at the location today. Thank you!",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 1545
  },
  {
    key: "delivery_complete_intro",
    category: "delivery",
    displayName: "Delivery Complete Introduction",
    content: "✅ *Product Confirmed & Delivered!* ✅\n\nYour order #{{orderId}} has been confirmed by our driver and delivered to your location.\n\n📸 *Evidence Provided:*\nWe've documented the delivery process with photos and video for your records.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 1439
  },
  {
    key: "delivery_video_caption",
    category: "delivery",
    displayName: "Delivery Video Caption",
    content: "📹 *Delivery Video*\n\nThis video shows the delivery confirmation, receipt verification, and customer acknowledgment.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 1452
  },
  {
    key: "delivery_receipt_in_hand",
    category: "delivery",
    displayName: "Receipt In Hand Photo Caption",
    content: "🧾 *Receipt in Hand*\n\nThis confirms the delivery was handed to someone at your location.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 1472
  },
  {
    key: "delivery_receipt_closeup",
    category: "delivery",
    displayName: "Receipt Close-Up Photo Caption",
    content: "🧾 *Receipt Close-Up*\n\nClear view of your order receipt for verification.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 1476
  },
  {
    key: "delivery_proof_of_delivery",
    category: "delivery",
    displayName: "Proof of Delivery Photo Caption",
    content: "👤 *Proof of Delivery*\n\nReceipt held by the recipient for identity verification.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 1480
  },
  {
    key: "delivery_entrance_photo",
    category: "delivery",
    displayName: "Entrance Photo Caption",
    content: "🏠 *Delivery Location*\n\nPhoto of the entrance where your order was delivered.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 1484
  },
  {
    key: "delivery_thank_you",
    category: "delivery",
    displayName: "Delivery Thank You Message",
    content: "Thank you — we appreciate having you as our customer.\nWe would love to serve you again soon. ❤️\n\nIf you have any questions about this delivery, please contact our support team.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 1512
  },
  {
    key: "pickup_confirmed",
    category: "delivery",
    displayName: "Pickup Confirmation Message",
    content: "✅ *Order Pickup Confirmed!*\n\nThank you for picking up your order.\n\n📦 *Order ID:* #{{orderId}}\n📅 *Pickup Date & Time:* {{dateTime}}\n\nWe hope everything is perfect! If you have any questions, feel free to contact support.\n\nThank you for choosing us! 😊",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 987
  },

  // ============== ERROR MESSAGES ==============
  {
    key: "error_media_processing",
    category: "error",
    displayName: "Media Processing Error",
    content: "❌ Unable to process your media file. Please try sending it again.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 621
  },
  {
    key: "error_video_processing",
    category: "error",
    displayName: "Video Processing Error",
    content: "❌ Unable to process your video file. Please try sending it again.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 644
  },
  {
    key: "error_document_processing",
    category: "error",
    displayName: "Document Processing Error",
    content: "❌ Unable to process your document. Please try sending it again.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 669
  },
  {
    key: "error_invalid_bank",
    category: "error",
    displayName: "Invalid Bank Selection",
    content: "❌ Invalid input. Please enter a valid bank number from the list.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 4452
  },

  // ============== DISCOUNT FLOW ==============
  {
    key: "discount_invalid_category",
    category: "discount",
    displayName: "Invalid Discount Category",
    content: "❌ Invalid category. Please choose a valid letter from the list or type *0* for main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2252
  },
  {
    key: "discount_product_not_found",
    category: "discount",
    displayName: "Discount Product Not Found",
    content: "❌ Product not found. Please try again or type *0* for main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2280
  },
  {
    key: "discount_loading",
    category: "discount",
    displayName: "Loading Discount Products",
    content: "Loading discount products...",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2287
  },
  {
    key: "discount_invalid_selection",
    category: "discount",
    displayName: "Invalid Discount Selection",
    content: "❌ Invalid selection. Please choose a product number or category letter from the list, or type *0* for main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2293
  },
  {
    key: "discount_fetching_all",
    category: "discount",
    displayName: "Fetching All Discount Products",
    content: "📦 *Fetching all your eligible discount products...*",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2312
  },
  {
    key: "discount_invalid_category_selection",
    category: "discount",
    displayName: "Invalid Category Selection",
    content: "❌ Invalid selection. Please choose a category number from the list, type *A* for all products, or *0* for main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2329
  },

  // ============== SHOPPING FLOW ==============
  {
    key: "shopping_invalid_category",
    category: "shopping",
    displayName: "Invalid Category Selection",
    content: "Please select a valid category number, 'view cart', or 0 for main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2393
  },
  {
    key: "shopping_invalid_subcategory",
    category: "shopping",
    displayName: "Invalid Subcategory Selection",
    content: "Please select a valid subcategory number, type 'view cart' or 0 for main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2415
  },
  {
    key: "shopping_invalid_product",
    category: "shopping",
    displayName: "Invalid Product Selection",
    content: "Please select a valid product number, type 'view cart' or 0 for main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2435
  },
  {
    key: "shopping_categories_header",
    category: "shopping",
    displayName: "Categories List Header",
    content: "What are you looking for? This is the main shopping list\\n\\nPlease enter the category name or number to view its details.\\nType 0 to return to main menu or type \"View cart\" to view your cart",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 1785
  },

  // ============== PRODUCT DETAILS ==============
  {
    key: "product_not_found",
    category: "product",
    displayName: "Product Not Found",
    content: "Oops, I can't find that product right now. Let's start over.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2450
  },
  {
    key: "product_invalid_choice",
    category: "product",
    displayName: "Invalid Product Choice",
    content: "Invalid choice. Reply 1 to add to cart, 2 for subcategories, 3 for categories, or 0 for main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2518
  },
  {
    key: "product_quantity_prompt",
    category: "product",
    displayName: "Quantity Selection Prompt",
    content: "How many *{{productName}}* would you like? (Enter a number)",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2499
  },
  {
    key: "product_details_not_found",
    category: "product",
    displayName: "Product Details Not Found",
    content: "Product details not found. Returning to cart.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3294
  },
  {
    key: "product_cant_retrieve",
    category: "product",
    displayName: "Product Retrieval Error",
    content: "Sorry, couldn't retrieve product details. Returning to cart...",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 1737
  },

  // ============== WEIGHT SELECTION ==============
  {
    key: "weight_selection_prompt",
    category: "product",
    displayName: "Weight Selection Prompt",
    content: "Please pick the weight option for *{{productName}}*:\\n\\n{{options}}\\nType the number of your choice or 0 to go back.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2470
  },
  {
    key: "weight_selection_confirmation",
    category: "product",
    displayName: "Weight Selection Confirmation",
    content: "You have chosen *{{weight}}* option at Rp {{price}}. Great choice!",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2549
  },
  {
    key: "weight_not_found_error",
    category: "product",
    displayName: "Weight Product Not Found",
    content: "Sorry, couldn't find that product. Let's start over.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2538
  },

  // ============== QUANTITY SELECTION ==============
  {
    key: "quantity_invalid",
    category: "product",
    displayName: "Invalid Quantity",
    content: "Please enter a valid quantity (a positive number), or 0 for main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2634
  },
  {
    key: "quantity_after_weight",
    category: "product",
    displayName: "Quantity Prompt After Weight",
    content: "How many *{{productName}}* would you like to order? (Enter a number)",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2554
  },

  // ============== CART ADDED ==============
  {
    key: "cart_item_added",
    category: "cart",
    displayName: "Item Added to Cart",
    content: "added to your cart:\\n{{productName}}\\n{{quantity}} bags\\nfor {{total}}",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2614
  },
  {
    key: "cart_next_action",
    category: "cart",
    displayName: "Post Add to Cart Options",
    content: "\\nWhat do you want to do next?\\n1- View cart\\n2- Proceed to pay\\n3- Shop more (return to shopping list)\\n0- Main menu",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2624
  },
  {
    key: "cart_invalid_next_action",
    category: "cart",
    displayName: "Invalid Post Cart Option",
    content: "Please select a valid option (1, 2, or 3), or type 0 to return to the main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 2659
  },
  {
    key: "cart_item_removed",
    category: "cart",
    displayName: "Cart Item Removed",
    content: "✅ Removed {{productName}}{{weight}} from your cart.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3199
  },
  {
    key: "cart_delete_invalid_item",
    category: "cart",
    displayName: "Invalid Cart Delete Selection",
    content: "Please select a valid item number, or type 0 to return to the main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3209
  },
  {
    key: "cart_emptied",
    category: "cart",
    displayName: "Cart Emptied Message",
    content: "🗑️ Your cart has been completely emptied.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3221
  },
  {
    key: "cart_items_kept",
    category: "cart",
    displayName: "Cart Items Kept",
    content: "✅ Your cart items have been kept.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3227
  },
  {
    key: "cart_empty_confirm_invalid",
    category: "cart",
    displayName: "Invalid Empty Cart Selection",
    content: "Please select 1 to empty cart or 2 to keep items, or type 0 for main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3233
  },
  {
    key: "cart_invalid_selection",
    category: "cart",
    displayName: "Invalid Cart View Selection",
    content: "Invalid selection.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3299
  },

  // ============== CHECKOUT/DELIVERY OPTIONS ==============
  {
    key: "checkout_delivery_options",
    category: "checkout",
    displayName: "Delivery Speed Options",
    content: "1. Normal Delivery\\n2. Speed Delivery\\n3. Early Morning Delivery\\n4. Eco Delivery\\n5. Self Pickup",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3308
  },
  {
    key: "checkout_invalid_delivery",
    category: "checkout",
    displayName: "Invalid Delivery Selection",
    content: "Please choose a valid delivery speed (1–5), or type 0 to return to main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3455
  },
  {
    key: "checkout_eco_discount_applied",
    category: "checkout",
    displayName: "Eco Discount Applied",
    content: "5% eco-discount applied! Delivery in 8-10 days.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3416
  },
  {
    key: "checkout_first_order_discount",
    category: "checkout",
    displayName: "First Order Discount Applied",
    content: "First order 10% discount applied!",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3420
  },
  {
    key: "checkout_pickup_date",
    category: "checkout",
    displayName: "Pickup Date Options",
    content: "📅 When would you like to pick up your order?\\n\\n1. Today\\n2. Tomorrow\\n3. Later (choose from calendar)",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3433
  },
  {
    key: "checkout_eco_date_format",
    category: "checkout",
    displayName: "Eco Delivery Date Format",
    content: "Please enter date in YYYY-MM-DD format (e.g., 2025-01-20)",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3465
  },
  {
    key: "checkout_eco_scheduled",
    category: "checkout",
    displayName: "Eco Delivery Scheduled",
    content: "✅ Eco delivery scheduled for {{date}}. 5% discount applied!",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3500
  },

  // ============== REGENCY/AREA SELECTION ==============
  {
    key: "checkout_no_areas_in_regency",
    category: "checkout",
    displayName: "No Areas in Regency",
    content: "No areas found in {{regencyName}}. Please select a different regency.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3570
  },
  {
    key: "checkout_invalid_regency",
    category: "checkout",
    displayName: "Invalid Regency Selection",
    content: "Please select a valid regency number (1-{{total}}):",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3596
  },
  {
    key: "checkout_select_regency_first",
    category: "checkout",
    displayName: "Select Regency First",
    content: "Please select a regency first:",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3645
  },
  {
    key: "checkout_area_free_delivery",
    category: "checkout",
    displayName: "Free Delivery Area",
    content: "Free delivery to this area.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3694
  },
  {
    key: "checkout_google_map_prompt",
    category: "checkout",
    displayName: "Google Map Location Prompt",
    content: "📍 Please provide your exact location using Google Maps link for precise delivery.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3703
  },

  // ============== SAVED ADDRESS ==============
  {
    key: "checkout_saved_address_prompt",
    category: "checkout",
    displayName: "Saved Address Selection",
    content: "Please select one of your saved addresses:",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3523
  },
  {
    key: "checkout_invalid_saved_address",
    category: "checkout",
    displayName: "Invalid Saved Address",
    content: "Please select a valid address number from the list or type 0 to return to the main menu.",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3727
  },
  {
    key: "checkout_address_selected",
    category: "checkout",
    displayName: "Address Selected Confirmation",
    content: "✅ Address selected: {{nickname}}\\nArea: {{area}}\\nDelivery charge: {{charge}}",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 3781
  },

  // ============== CHECKOUT/BANK ==============
  {
    key: "checkout_enter_bank_manual",
    category: "checkout",
    displayName: "Enter Bank Name Manually",
    content: "Please enter the name of your bank:",
    filePath: "backend/routes/chatbot-router.js",
    lineNumber: 4464
  }
];

// Get all unique categories
const getCategories = () => {
  const categories = [...new Set(CHATBOT_MESSAGES.map(m => m.category))];
  return categories.sort();
};

// GET /api/chatbot-message-viewer - Get all messages with optional category filter
router.get("/", (req, res) => {
  try {
    const { category, search } = req.query;
    
    let messages = [...CHATBOT_MESSAGES];
    
    // Filter by category if provided
    if (category && category !== "all") {
      messages = messages.filter(m => m.category === category);
    }
    
    // Filter by search term if provided
    if (search) {
      const searchLower = search.toLowerCase();
      messages = messages.filter(m => 
        m.displayName.toLowerCase().includes(searchLower) ||
        m.content.toLowerCase().includes(searchLower) ||
        m.key.toLowerCase().includes(searchLower)
      );
    }
    
    res.json({
      success: true,
      total: messages.length,
      categories: getCategories(),
      messages
    });
  } catch (error) {
    console.error("Error fetching chatbot messages:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/chatbot-message-viewer/categories - Get list of categories
router.get("/categories", (req, res) => {
  try {
    const categories = getCategories();
    const categoryCounts = {};
    
    categories.forEach(cat => {
      categoryCounts[cat] = CHATBOT_MESSAGES.filter(m => m.category === cat).length;
    });
    
    res.json({
      success: true,
      categories,
      counts: categoryCounts,
      total: CHATBOT_MESSAGES.length
    });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/chatbot-message-viewer/stats - Get message statistics
router.get("/stats", (req, res) => {
  try {
    const categories = getCategories();
    const stats = {
      totalMessages: CHATBOT_MESSAGES.length,
      totalCategories: categories.length,
      categoryBreakdown: {}
    };
    
    categories.forEach(cat => {
      stats.categoryBreakdown[cat] = CHATBOT_MESSAGES.filter(m => m.category === cat).length;
    });
    
    res.json({ success: true, stats });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
