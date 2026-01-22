const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const axios = require("axios"); // For HTTP requests to Ultramsg API
const path = require("path");
const PDFDocument = require("pdfkit");
const OrderProcessingMiddleware = require("../middleware/orderProcessing");

// Import all static methods from OrderProcessingMiddleware
const {
  processReferralCommission,
  updateReferrerRecord,
  processOrderRefund,
  adjustCommissionForRefund,
  processOrderReplacement,
  addOrderCorrection,
  getOrderAnalytics,
} = OrderProcessingMiddleware;
const fs = require("fs");
const Video = require("../models/video"); // Add this with other requires
const moment = require("moment");
const Category = require("../models/Category");
const Product = require("../models/Product");
const Customer = require("../models/customer");
const { processNewOrder } = require("../utils/referralProcessing");
// Area model removed (deprecated)
const { Regency, AreaB } = require("../models/AreaManagement");
const BatchDiscount = require("../models/BatchDiscount");
const DiscountEligibility = require("../models/DiscountEligibility");
const mkdirp = require("mkdirp");

// Ultramsg Configuration
const ULTRAMSG_CONFIG = {
  instanceId: "instance143389",
  token: "e5qifsg0mzq0ylng",
  baseURL: "https://api.ultramsg.com",
  botNumber: "6281818185522",
  mediaUploadURL: "https://api.ultramsg.com/upload", // Add this line
};

// Create referral images directory
const referralvideosDir = path.join(__dirname, "../referral_images");
mkdirp.sync(referralvideosDir);

const TEMP_DOCS_DIR = path.join(__dirname, "../temp_docs");

// 2. Ensure temp directory exists on startup
if (!fs.existsSync(TEMP_DOCS_DIR)) {
  fs.mkdirSync(TEMP_DOCS_DIR, { recursive: true });
  console.log(`📂 Created temp docs directory at ${TEMP_DOCS_DIR}`);
}
// NOTE: MongoDB connection is handled in server.js - removed duplicate connection here

// Start checking for confirmations every 1 minute
setInterval(checkAndSendConfirmations, 1 * 60 * 1000);
console.log("🔄 Enabled automatic confirmation checks every 1 minute");

// Run initial check
checkAndSendConfirmations();

// Counter model for order IDs
const Counter = mongoose.model(
  "Counter",
  new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 },
  })
);

async function getNextSequence(name) {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
}

// Import ChatbotMonitor model for message monitoring
const ChatbotMonitor = require("../models/ChatbotMonitor");

// ============================================================================
// ULTRAMSG API FUNCTIONS
// ============================================================================

/**
 * Send message to a single recipient (internal helper - no monitoring)
 */
async function sendMessageDirect(to, content) {
  try {
    const cleanTo = to.replace(/@c\.us|@s\.whatsapp\.net/g, "");
    
    const response = await axios.post(
      `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/chat`,
      `token=${ULTRAMSG_CONFIG.token}&to=${cleanTo}&body=${encodeURIComponent(content)}`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    return response.data.sent ? { success: true, data: response.data } : { success: false, error: response.data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Send copies of message to all active monitor numbers
 */
async function sendToMonitorNumbers(originalTo, content) {
  try {
    const monitors = await ChatbotMonitor.getActiveMonitors();
    
    if (monitors.length === 0) return;

    const timestamp = new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" });
    
    for (const monitor of monitors) {
      // Skip if monitor number is the same as recipient (avoid loops)
      if (monitor.phoneNumber === originalTo.replace(/\D/g, "")) continue;
      
      // Build monitor copy message with metadata header
      const monitorMessage = `📊 *CHATBOT MONITOR*
━━━━━━━━━━━━━━━━━━━━
📱 To: ${originalTo}
⏰ Time: ${timestamp}
━━━━━━━━━━━━━━━━━━━━

${content}`;

      // Send to monitor (use direct to avoid infinite loop)
      await sendMessageDirect(monitor.phoneNumber, monitorMessage);
      
      // Update monitor stats
      await monitor.recordMessage();
    }
  } catch (error) {
    console.error("❌ Error sending to monitors:", error.message);
    // Don't throw - monitoring failure shouldn't break main message
  }
}

/**
 * Send a text message via Ultramsg API (with monitoring and retry logic)
 * Includes automatic retry for transient network errors like ECONNRESET
 */
async function sendWhatsAppMessage(to, content, retryCount = 0) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000; // 1 second base delay
  
  try {
    // Clean phone number (remove @ symbols if present)
    const cleanTo = to.replace(/@c\.us|@s\.whatsapp\.net/g, "");

    console.log(
      `📤 Sending message to ${cleanTo}: "${content.substring(0, 50)}..."${retryCount > 0 ? ` (retry ${retryCount}/${MAX_RETRIES})` : ''}`
    );

    const response = await axios.post(
      `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/chat`,
      `token=${ULTRAMSG_CONFIG.token}&to=${cleanTo}&body=${encodeURIComponent(
        content
      )}`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 30000, // 30 second timeout
      }
    );

    if (response.data.sent) {
      console.log(`✅ Message sent successfully to ${cleanTo}`);
      
      // Send copy to monitor numbers (async, don't wait)
      sendToMonitorNumbers(cleanTo, content).catch(err => 
        console.error("Monitor copy error:", err.message)
      );
      
      return { success: true, data: response.data };
    } else {
      console.error(`❌ Failed to send message:`, response.data);
      return { success: false, error: response.data };
    }
  } catch (error) {
    const errorMessage = error.response?.data || error.message;
    const isRetryableError = 
      error.code === 'ECONNRESET' || 
      error.code === 'ETIMEDOUT' || 
      error.code === 'ECONNREFUSED' ||
      error.code === 'ENOTFOUND' ||
      (error.response && error.response.status >= 500);
    
    // Retry on transient network errors
    if (isRetryableError && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, retryCount); // Exponential backoff
      console.log(`⚠️ Network error (${error.code || error.message}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return sendWhatsAppMessage(to, content, retryCount + 1);
    }
    
    console.error(
      `❌ Error sending WhatsApp message to ${to}:`,
      errorMessage
    );
    return { success: false, error: error.message };
  }
}


/**
 * Send an image with caption via Ultramsg API
 */
async function sendImageWithCaption(to, imagePath, caption) {
  try {
    const cleanTo = to.replace(/@c\.us|@s\.whatsapp\.net/g, "");

    // Check if image exists
    if (!fs.existsSync(imagePath)) {
      console.error(`Image does not exist: ${imagePath}`);
      await sendWhatsAppMessage(to, caption);
      return;
    }

    // Convert image to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString("base64");
    const mimeType = "image/jpeg";

    const formData = new URLSearchParams();
    formData.append("token", ULTRAMSG_CONFIG.token);
    formData.append("to", cleanTo);
    formData.append("image", `data:${mimeType};base64,${base64Image}`);
    formData.append("caption", caption);

    const response = await axios.post(
      `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/image`,
      formData,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    console.log("📸 Image sent successfully");
    return { success: true, data: response.data };
  } catch (error) {
    console.error("❌ Error sending image:", error);
    // Fallback to sending just the text
    await sendWhatsAppMessage(to, caption);
    return { success: false, error: error.message };
  }
}

/**
 * Helper function to send image with retry logic
 * Now properly validates API response
 */
async function sendImageWithRetry(to, base64Image, contentType, caption, retryCount = 0) {

  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;
  
  // Detect actual image type from base64 magic bytes
  let normalizedType = 'image/jpeg'; // Default
  if (base64Image.startsWith('/9j/')) {
    normalizedType = 'image/jpeg'; // JPEG magic bytes
  } else if (base64Image.startsWith('iVBORw0')) {
    normalizedType = 'image/png'; // PNG magic bytes
  } else if (base64Image.startsWith('R0lGOD')) {
    normalizedType = 'image/gif'; // GIF magic bytes
  } else {
    // Fallback to declared content type with normalization
    normalizedType = contentType?.toLowerCase() || 'image/jpeg';
    if (normalizedType.includes('jfif') || normalizedType.includes('pjpeg') || normalizedType.includes('pjp')) {
      normalizedType = 'image/jpeg';
    } else if (normalizedType.includes('webp') || normalizedType.includes('bmp') || normalizedType.includes('tiff')) {
      normalizedType = 'image/jpeg';
    } else if (!['image/jpeg', 'image/png', 'image/gif'].includes(normalizedType)) {
      normalizedType = 'image/jpeg';
    }
  }
  
  console.log(`📷 Sending image: type=${normalizedType}, size=${base64Image.length} chars`);
  
  try {
    const formData = new URLSearchParams();
    formData.append("token", ULTRAMSG_CONFIG.token);
    formData.append("to", to);
    formData.append("image", `data:${normalizedType};base64,${base64Image}`);
    formData.append("caption", caption || "");


    const response = await axios.post(
      `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/image`,
      formData,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 60000, // 60 second timeout for image uploads
      }
    );
    
    // Check if API actually confirmed delivery
    if (response.data && response.data.sent === true) {
      console.log(`✅ Image confirmed sent to ${to}`);
      return { success: true, data: response.data };
    } else if (response.data && response.data.sent === "true") {
      // Sometimes API returns string instead of boolean
      console.log(`✅ Image confirmed sent to ${to}`);
      return { success: true, data: response.data };
    } else {
      // API returned but didn't confirm delivery
      console.error(`⚠️ Image API response uncertain:`, JSON.stringify(response.data));
      throw new Error(`Image not confirmed sent: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    const isRetryableError = 
      error.code === 'ECONNRESET' || 
      error.code === 'ETIMEDOUT' || 
      error.code === 'ECONNREFUSED' ||
      error.message?.includes('not confirmed') ||
      (error.response && error.response.status >= 500);
    
    if (isRetryableError && retryCount < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
      console.log(`⚠️ Image upload error (${error.code || error.message}), retrying in ${delay}ms... (${retryCount + 1}/${MAX_RETRIES})`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return sendImageWithRetry(to, base64Image, contentType, caption, retryCount + 1);
    }
    throw error;
  }
}


/**
 * Send product images (master + additional images) with retry logic
 * @param {string} to - Recipient phone number
 * @param {Object} product - Product object with masterImage and moreImages
 * @param {string} caption - Caption for the first image
 */
async function sendProductImages(to, product, caption) {
  try {
    const cleanTo = to.replace(/@c\.us|@s\.whatsapp\.net/g, "");
    const images = [];

    // Add master image if available
    if (product.masterImage && product.masterImage.data) {
      images.push({
        buffer: Buffer.isBuffer(product.masterImage.data)
          ? product.masterImage.data
          : Buffer.from(product.masterImage.data),
        contentType: product.masterImage.contentType || "image/jpeg",
      });
    }

    // Add more images if available
    if (product.moreImages && Array.isArray(product.moreImages)) {
      product.moreImages.forEach((img) => {
        if (img && img.data) {
          images.push({
            buffer: Buffer.isBuffer(img.data)
              ? img.data
              : Buffer.from(img.data),
            contentType: img.contentType || "image/jpeg",
          });
        }
      });
    }

    if (images.length === 0) {
      // No images, send text only
      await sendWhatsAppMessage(to, caption);
      return;
    }

    // Send first image with caption (with retry)
    const firstImage = images[0];
    const base64 = firstImage.buffer.toString("base64");
    await sendImageWithRetry(cleanTo, base64, firstImage.contentType, caption);
    console.log(`📸 Sent image 1/${images.length}`);

    // Send additional images without caption (with small delay and retry)
    for (let i = 1; i < images.length; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
      const img = images[i];
      const imgBase64 = img.buffer.toString("base64");
      await sendImageWithRetry(cleanTo, imgBase64, img.contentType, `Image ${i + 1}/${images.length}`);
      console.log(`📸 Sent image ${i + 1}/${images.length}`);
    }

    console.log(`✅ Sent all ${images.length} product images`);
  } catch (error) {
    console.error("❌ Error sending product images:", error);
    // Fallback to text only message
    await sendWhatsAppMessage(to, caption);
  }
}


/**
 * Download media from Ultramsg
 */

setInterval(clearAbandonedCarts, 60 * 60 * 1000); // Check every hour

async function clearAbandonedCarts() {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

    // Find customers with unpaid carts older than 24 hours
    const customersWithAbandonedCarts = await Customer.find({
      $or: [
        {
          currentOrderStatus: "cart-not-paid",
          "orderHistory.status": "cart-not-paid",
          "orderHistory.orderDate": { $lt: twentyFourHoursAgo },
        },
        {
          currentOrderStatus: "order-made-not-paid",
          "orderHistory.status": "order-made-not-paid",
          "orderHistory.orderDate": { $lt: twentyFourHoursAgo },
        },
      ],
    });

    console.log(
      `🧹 Found ${customersWithAbandonedCarts.length} customers with abandoned carts`
    );

    for (const customer of customersWithAbandonedCarts) {
      try {
        const latestOrder =
          customer.orderHistory[customer.orderHistory.length - 1];

        // Only clear if order timestamp is truly older than 24 hours
        // AND cart hasn't been recently updated
        if (
          latestOrder &&
          (latestOrder.status === "cart-not-paid" ||
            latestOrder.status === "order-made-not-paid") &&
          new Date(latestOrder.orderDate) < twentyFourHoursAgo &&
          (!latestOrder.lastCartUpdate ||
            new Date(latestOrder.lastCartUpdate) < twentyFourHoursAgo)
        ) {
          // Remove the unpaid order
          customer.orderHistory = customer.orderHistory.filter(
            (o) =>
              !(o.orderId === latestOrder.orderId && o.paymentStatus !== "paid")
          );

          // Clear cart
          customer.cart = {
            items: [],
            totalAmount: 0,
            deliveryCharge: 0,
            deliveryType: "truck",
            deliverySpeed: "normal",
            deliveryOption: "Normal Delivery",
            deliveryLocation: "",
            deliveryTimeFrame: "",
            firstOrderDiscount: 0,
            ecoDeliveryDiscount: 0,
            deliveryAddress: {},
          };

          customer.latestOrderId = null;
          customer.currentOrderStatus = "main_menu";

          await customer.save();

          console.log(
            `✅ Cleared abandoned cart for customer: ${customer.phoneNumber[0]}`
          );

          // Send notification
          try {
            await sendWhatsAppMessage(
              customer.phoneNumber[0],
              `⏰ Your cart was cleared due to inactivity (no payment for 24 hours).\n\nType 'hi' to start fresh shopping! 🛍️`
            );
          } catch (err) {
            console.error("Could not send notification:", err);
          }
        }
      } catch (error) {
        console.error(`Error processing customer ${customer._id}:`, error);
      }
    }
  } catch (error) {
    console.error("❌ Error in clearAbandonedCarts:", error);
  }
}

// ============================================================================
// TIMER RESET: Add this function to reset timer when items are added to cart
// ============================================================================

async function resetCartTimer(customer) {
  try {
    if (customer.orderHistory && customer.orderHistory.length > 0) {
      const latestOrder =
        customer.orderHistory[customer.orderHistory.length - 1];

      // Update the timestamp for the current order
      if (
        latestOrder.status === "cart-not-paid" ||
        latestOrder.status === "order-made-not-paid"
      ) {
        latestOrder.lastCartUpdate = new Date(); // ✅ RESET TIMER
        latestOrder.orderDate = new Date(); // Also reset orderDate to now

        console.log(
          `⏱️ Cart timer reset for customer: ${customer.phoneNumber[0]}`
        );
      }
    }

    await customer.save();
  } catch (error) {
    console.error("Error resetting cart timer:", error);
  }
}
async function downloadMedia(mediaUrl, filename) {
  try {
    const response = await axios({
      method: "GET",
      url: mediaUrl,
      responseType: "stream",
    });

    const filePath = path.join(referralvideosDir, filename);
    const writer = fs.createWriteStream(filePath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => resolve(filePath));
      writer.on("error", reject);
    });
  } catch (error) {
    console.error("❌ Error downloading media:", error);
    throw error;
  }
}

// ============================================================================
// WEBHOOK ROUTES FOR RECEIVING MESSAGES
// ============================================================================

/**
 * Webhook endpoint to receive messages from Ultramsg
 */

router.post("/webhook", express.json(), async (req, res) => {
  try {
    console.log("=== WEBHOOK RECEIVED ===");
    
    const data = req.body;

    // Handle UltraMsg webhook structure
    if (data.event_type === "message_received") {
      const messageData = data.data;
      
      // ========== MESSAGE DEDUPLICATION ==========
      // Prevent duplicate webhook processing
      const { hasProcessed, generateMessageId } = require("../utils/messageTracker");
      const msgId = generateMessageId(messageData);
      
      if (hasProcessed(msgId)) {
        console.log(`⏭️ Skipping duplicate webhook for: ${messageData.from}`);
        return res.status(200).json({ status: "duplicate_skipped" });
      }
      // ============================================
      
      const message = {
        from: messageData.from,
        body: messageData.body || "",
        hasMedia: messageData.media !== "",
        type: messageData.type || "text",
        timestamp: messageData.time,
        pushname: messageData.pushname || "",
      };

      console.log("=== MESSAGE RECEIVED ===");
      console.log("From:", message.from);
      console.log("Body:", message.body);
      console.log("Type:", message.type);
      console.log(
        "Timestamp:",
        new Date(message.timestamp * 1000).toISOString()
      );


      // Handle different message types
      if (messageData.media) {
        if (message.type === "image") {
          console.log("📎 Image detected - processing...");
          message.hasMedia = true;
          message.media = {
            mimetype: "image/jpeg",
            caption: messageData.caption || "",
            url: messageData.media,
          };

          try {
            const filename = `media_${Date.now()}_image.jpg`;
            const localPath = await downloadMedia(messageData.media, filename);
            message.localMediaPath = localPath;
            message.mediaInfo = message.media;
            console.log(`📹 Media downloaded: ${localPath}`);
          } catch (error) {
            console.error("❌ Error downloading media:", error);
            await sendWhatsAppMessage(
              message.from,
              "❌ Unable to process your media file. Please try sending it again."
            );
            return res.status(200).json({ status: "received" });
          }
        } else if (message.type === "video") {
          console.log("📎 Video detected - processing...");
          message.hasMedia = true;
          message.media = {
            mimetype: "video/mp4",
            caption: messageData.caption || "",
            url: messageData.media,
          };

          try {
            const filename = `media_${Date.now()}_video.mp4`;
            const localPath = await downloadMedia(messageData.media, filename);
            message.localMediaPath = localPath;
            message.mediaInfo = message.media;
            console.log(`📹 Video downloaded: ${localPath}`);
          } catch (error) {
            console.error("❌ Error downloading video:", error);
            await sendWhatsAppMessage(
              message.from,
              "❌ Unable to process your video file. Please try sending it again."
            );
            return res.status(200).json({ status: "received" });
          }
        } else if (message.type === "document") {
          console.log("📎 Document detected - processing...");
          message.hasMedia = true;
          message.media = {
            mimetype: messageData.mimetype || "application/octet-stream",
            filename: messageData.filename || "document",
            url: messageData.media,
          };

          try {
            const filename = `media_${Date.now()}_${
              messageData.filename || "document"
            }`;
            const localPath = await downloadMedia(messageData.media, filename);
            message.localMediaPath = localPath;
            message.mediaInfo = message.media;
            console.log(`📄 Document downloaded: ${localPath}`);
          } catch (error) {
            console.error("❌ Error downloading document:", error);
            await sendWhatsAppMessage(
              message.from,
              "❌ Unable to process your document. Please try sending it again."
            );
            return res.status(200).json({ status: "received" });
          }
        }
      }

      // Clean phone number for processing
      const phone = message.from.replace(/@c\.us|@s\.whatsapp\.net/g, "");

      // Process the message using existing logic
      await processChatMessage(phone, message.body, message);
      return res.status(200).json({ status: "received" });
    }

    // Handle other webhook events (status updates, etc)
    if (data.event_type) {
      console.log(`Received ${data.event_type} event`);
      return res.status(200).json({ status: "ignored" });
    }

    console.log("Received invalid webhook payload");
    return res.status(400).json({ error: "Invalid payload" });
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
/**
 * Route to check webhook status
 */
router.get("/webhook-status", (req, res) => {
  res.json({
    status: "active",
    timestamp: new Date().toISOString(),
    config: {
      instanceId: ULTRAMSG_CONFIG.instanceId,
      hasToken: !!ULTRAMSG_CONFIG.token,
    },
  });
});

/**
 * Route to get instance info
 */
router.get("/instance-info", async (req, res) => {
  try {
    const response = await axios.get(
      `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/instance/status?token=${ULTRAMSG_CONFIG.token}`
    );

    res.json(response.data);
  } catch (error) {
    console.error("❌ Error getting instance info:", error);
    res.status(500).json({ error: "Failed to get instance info" });
  }
});
router.put("/api/orders/:orderId/status", async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  console.log(
    `🔄 Processing status update for ${orderId} to ${status} (server side)`
  );

  try {
    // Find customer with this order
    const customer = await Customer.findOne({
      $or: [
        { "orderHistory.orderId": orderId },
        { "shoppingHistory.orderId": orderId },
      ],
    });

    if (!customer) {
      console.error(`❌ Order ${orderId} not found`);
      return res.status(404).json({ error: "Order not found" });
    }

    // Update in orderHistory
    const orderHistoryIndex = customer.orderHistory.findIndex(
      (o) => o.orderId === orderId
    );
    if (orderHistoryIndex >= 0) {
      customer.orderHistory[orderHistoryIndex].status = status;
    }

    // Update in shoppingHistory
    const shoppingHistoryIndex = customer.shoppingHistory.findIndex(
      (o) => o.orderId === orderId
    );
    if (shoppingHistoryIndex >= 0) {
      customer.shoppingHistory[shoppingHistoryIndex].status = status;
    }

    await customer.save();
    console.log(`✅ Database update completed`);

    // ✅ TRIGGER APPROPRIATE MESSAGE BASED ON STATUS
    if (status === "order-confirmed") {
      console.log(`📨 Triggering confirmation for ${orderId}`);
      try {
        await sendOrderConfirmation(orderId, customer);
        console.log(`📩 Confirmation sent successfully`);
      } catch (confirmationError) {
        console.error(`❌ Confirmation failed:`, confirmationError);
      }
    } else if (status === "on-way") {
      console.log(`🚚 Triggering on-the-way message for ${orderId}`);
      try {
        await sendOnTheWayMessage(orderId, customer);
        console.log(`🚚 On-the-way message sent successfully`);
      } catch (onTheWayError) {
        console.error(`❌ On-the-way message failed:`, onTheWayError);
      }
    } else if (status === "order-complete") {
      console.log(`✅ Triggering delivery complete message for ${orderId}`);
      try {
        await sendDeliveryCompleteMessage(orderId, customer);
        console.log(`✅ Delivery complete message sent successfully`);
      } catch (completeError) {
        console.error(`❌ Delivery complete message failed:`, completeError);
      }
    }

    res.json({
      success: true,
      message: `Order status updated to ${status} and messages queued`,
    });
  } catch (error) {
    console.error(`❌ Status update failed:`, error);
    res.status(500).json({
      error: error.message,
      details: error.response?.data || "No additional details",
    });
  }
});
// Add this endpoint to trigger the check
router.get("/send-confirmations", async (req, res) => {
  try {
    await checkAndSendConfirmations();
    res.json({ success: true, message: "Confirmation check completed" });
  } catch (err) {
    console.error("❌ Error triggering confirmations:", err);
    res.status(500).json({ error: err.message });
  }
});
// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
// Add this new simplified function to your chatbot router

// Helper function to ensure valid numbers
function ensureValidNumber(value, defaultValue = 0) {
  if (value === null || value === undefined || value === "") {
    return defaultValue;
  }
  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

function cleanNumberForUltraMSG(phone) {
  // Remove all non-digit characters
  let clean = phone.replace(/\D/g, "");

  // Handle Indonesian numbers (replace leading 0 with 62)
  if (clean.startsWith("0")) {
    clean = "62" + clean.substring(1);
  }

  // Remove any country code prefix if already present
  clean = clean.replace(/^\+?62/, "62");

  return clean;
}
// NOTE: checkAndSendConfirmations is defined later at line ~960 with improved tracking

// Helper function to get all regencies for step 1 selection
const getAllRegencies = async () => {
  try {
    const regencies = await Regency.find().sort({ name: 1 });
    return regencies;
  } catch (error) {
    console.error("Error fetching regencies:", error);
    return [];
  }
};

// Helper function to format regencies list for display
const formatRegenciesForDisplay = (regencies) => {
  let message = "";
  regencies.forEach((regency, index) => {
    message += `${index + 1}. ${regency.name}\n`;
  });
  return message;
};

// Helper function to get areas by regency ID for step 2 selection
const getAreasByRegencyId = async (regencyId) => {
  try {
    const areas = await AreaB.find({ regencyId })
      .populate({ path: 'regencyId', select: 'name' })
      .sort({ name: 1 });
    
    return areas.map(area => ({
      ...area.toObject(),
      regencyName: area.regencyId?.name || 'Unknown',
      displayName: area.displayName || area.name,
      truckPrice: area.truckPrice || 0,
      scooterPrice: area.scooterPrice || 0
    }));
  } catch (error) {
    console.error("Error fetching areas by regency:", error);
    return [];
  }
};

// Helper function to format areas within a regency for display
const formatAreasInRegencyForDisplay = (areas) => {
  let message = "";
  areas.forEach((area, index) => {
    const feeText =
      area.truckPrice > 0 || area.scooterPrice > 0
        ? ` (Truck: ₹${area.truckPrice}, Scooter: ₹${area.scooterPrice})`
        : " (Free)";
    message += `${index + 1}. ${area.displayName}${feeText}\n`;
  });
  return message;
};

// Helper function to get active areas from AreaB (114 Delivery Fees) - for fallback
const getActiveAreas = async () => {
  try {
    // Fetch all areas from AreaB with regency info populated
    const areas = await AreaB.find()
      .populate({
        path: 'regencyId',
        select: 'name'
      })
      .sort({ 'regencyId.name': 1, name: 1 });
    
    // Map to include regency name for easier access
    return areas.map(area => ({
      ...area.toObject(),
      regencyName: area.regencyId?.name || 'Unknown',
      displayName: area.displayName || area.name,
      truckPrice: area.truckPrice || 0,
      scooterPrice: area.scooterPrice || 0
    }));
  } catch (error) {
    console.error("Error fetching areas from AreaB:", error);
    return [];
  }
};

// Helper function to format areas for display grouped by Regency - for fallback
const formatAreasForDisplay = (areas) => {
  // Group areas by regency
  const groupedByRegency = {};

  areas.forEach((area) => {
    const regencyName = area.regencyName || 'Unknown';
    if (!groupedByRegency[regencyName]) {
      groupedByRegency[regencyName] = [];
    }
    groupedByRegency[regencyName].push(area);
  });

  let message = "";
  let counter = 1;

  // Sort regencies alphabetically and display
  Object.keys(groupedByRegency)
    .sort()
    .forEach((regency) => {
      message += `\n📍 *${regency}*\n`;
      groupedByRegency[regency].forEach((area) => {
        const feeText =
          area.truckPrice > 0 || area.scooterPrice > 0
            ? ` (Truck: ₹${area.truckPrice}, Scooter: ₹${area.scooterPrice})`
            : " (Free)";
        message += `${counter}. ${area.displayName}${feeText}\n`;
        counter++;
      });
    });

  return message;
};

// Modified getActiveAreas to return flat list with state info for chatbot
const getActivAreasForChatbot = async () => {
  try {
    const areas = await Area.find({ isActive: true }).sort({
      state: 1,
      area: 1,
    });
    return areas.map((a) => ({
      ...a.toObject(),
      fullDisplay: `${a.state} - ${a.displayName}`,
    }));
  } catch (error) {
    console.error("Error fetching areas:", error);
    return [];
  }
};

// Helper function to send pickup confirmation message
async function sendPickupConfirmationMessage(customer, order) {
  try {
    const phoneNumber = customer.phoneNumber;
    const pickupDate = order.pickupPlan?.date || customer.pickupPlan?.date || new Date().toLocaleDateString();
    const pickupTime = order.pickupPlan?.timeSlot || customer.pickupPlan?.timeSlot || "Not specified";
    const currentDateTime = new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    const confirmationMessage = 
      `✅ *Order Pickup Confirmed!*\n\n` +
      `Thank you for picking up your order.\n\n` +
      `📦 *Order ID:* #${order.orderId}\n` +
      `📅 *Pickup Date & Time:* ${currentDateTime}\n\n` +
      `We hope everything is perfect! If you have any questions, feel free to contact support.\n\n` +
      `Thank you for choosing us! 😊`;

    await sendWhatsAppMessage(phoneNumber, confirmationMessage);
    console.log(`✅ Pickup confirmation sent for order ${order.orderId} to ${customer.phoneNumber}`);
    return true;
  } catch (error) {
    console.error(`❌ Error sending pickup confirmation:`, error);
    return false;
  }
}

async function checkAndSendConfirmations() {
  try {
    console.log("🔍 Checking for orders needing confirmation...");

    // Find orders with "order-confirmed" status
    const customers = await Customer.find({
      "orderHistory.status": "order-confirmed",
    });

    console.log(`📊 Found ${customers.length} customers with confirmed orders`);

    for (const customer of customers) {
      try {
        // Find confirmed orders that haven't been processed
        const confirmedOrders = customer.orderHistory.filter(
          (o) => o.status === "order-confirmed" && !o.confirmationSentAt
        );

        for (const order of confirmedOrders) {
          console.log(
            `📨 Sending confirmation for order ${order.orderId} to ${customer.name}`
          );

          try {
            await sendOrderConfirmation(order.orderId, customer);

            // Mark as sent
            order.confirmationSentAt = new Date();
            await customer.save();

            console.log(`✅ Confirmation sent for ${order.orderId}`);
          } catch (err) {
            console.error(
              `❌ Failed to send confirmation for ${order.orderId}:`,
              err.message
            );
          }
        }
      } catch (err) {
        console.error(`❌ Failed to process customer ${customer._id}:`, err);
      }
    }
  } catch (err) {
    console.error("❌ Error in checkAndSendConfirmations:", err);
  }
}

// ✅ FIX #2: IMPROVED sendDocumentWithMessage() with better validation

// Helper function to build detailed order message
function buildDetailedOrderMessage(order, customer, isFallback = false) {
  // Format dates
  const orderDate = new Date(order.orderDate);
  const formattedOrderDate = orderDate.toLocaleDateString("en-GB");
  const formattedOrderTime = orderDate.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Get delivery info
  let deliveryDateInfo = "Date to be confirmed";
  if (order.deliveryDate) {
    const deliveryDate = new Date(order.deliveryDate);
    deliveryDateInfo = deliveryDate.toLocaleDateString("en-GB");
  } else if (order.deliveryTimeFrame) {
    deliveryDateInfo = `Expected: ${order.deliveryTimeFrame}`;
  }

  const deliveryArea =
    (
      order.deliveryAddress?.area ||
      order.deliveryLocation ||
      "Area not specified"
    )
      .charAt(0)
      .toUpperCase() +
    (
      order.deliveryAddress?.area ||
      order.deliveryLocation ||
      "area not specified"
    ).slice(1);

  const deliveryAddress =
    order.deliveryAddress?.fullAddress ||
    order.deliveryLocation ||
    "Address not specified";
  const googleMapLink =
    order.deliveryAddress?.googleMapLink ||
    customer?.contextData?.locationDetails ||
    "";

  const deliveryType =
    order.deliveryType === "truck"
      ? "Truck"
      : order.deliveryType === "scooter"
      ? "Scooter"
      : order.deliveryType === "self_pickup"
      ? "Self Pickup"
      : "Standard";

  const deliverySpeed =
    order.deliverySpeed === "speed"
      ? "Speed Delivery"
      : order.deliverySpeed === "early_morning"
      ? "Early Morning Delivery"
      : order.deliverySpeed === "eco"
      ? "Eco Delivery"
      : "Normal Delivery";

  // Build message
  let message = isFallback
    ? `⚠️ Order Confirmed! (PDF unavailable)\n\n`
    : `🎉 *ORDER CONFIRMED!* 🎉\n\n📄 Please find your order confirmation PDF attached.\n\n`;

  message += `Order #${order.orderId}\n`;
  message += `📊 Status: ✅ Order Confirmed\n`;
  message += `💰 Amount: Rp ${Math.round(order.totalAmount).toLocaleString(
    "id-ID"
  )}\n`;
  message += `📅 Order Date: ${formattedOrderDate} at ${formattedOrderTime}\n`;
  message += `🚚 Delivery: ${deliverySpeed}\n`;
  message += `⏰ Delivery Date: ${deliveryDateInfo}\n`;
  message += `🌍 Area: ${deliveryArea}\n`;

  if (
    deliveryAddress !== deliveryArea &&
    deliveryAddress !== "Address not specified"
  ) {
    message += `📍 Address: ${deliveryAddress}\n`;
  }

  if (googleMapLink) {
    message += `🗺️ Location: ${googleMapLink}\n`;
  }

  if (order.deliveryTimeFrame) {
    message += `⏱️ Timeframe: ${order.deliveryTimeFrame}\n`;
  }

  message += `🚛 Type: ${deliveryType} - ${deliverySpeed}\n\n`;

  message += `Thank you for choosing Construction Materials Hub! 🏗️`;

  return message;
}

async function generateOrderConfirmationPDF(order, customer) {
  return new Promise((resolve, reject) => {
    console.log(
      `🛠️ [${new Date().toISOString()}] Creating PDF for ${order.orderId}`
    );

    try {
      const doc = new PDFDocument({ margin: 50 });
      const fileName = `order_${order.orderId}_confirmation.pdf`;
      const filePath = path.join(TEMP_DOCS_DIR, fileName);

      console.log(`📂 [${new Date().toISOString()}] Target path: ${filePath}`);

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // Add logo at the top with bottom margin
      try {
        const logoPath = path.join(__dirname, "../images/logo.png");
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, 50, 50, { width: 100, height: 100 });
          doc.moveDown(8); // Increased margin from bottom of image
        } else {
          console.warn("Logo not found at ../images/logo.png");
          doc.moveDown(3);
        }
      } catch (logoError) {
        console.warn("Could not load logo:", logoError);
        doc.moveDown(3);
      }

      // Header - Order Confirmation : paid (with red "paid" text)
      doc.fontSize(20).font("Helvetica-Bold");
      doc.fillColor("black").text("Order Confirmation : ", { continued: true });
      doc.fillColor("red").text("paid");
      doc.fillColor("black"); // Reset color to black for subsequent text
      doc.moveDown(1);

      // Order basic info
      doc.fontSize(12).font("Helvetica");
      doc.text(`Order #: ${order.orderId}`);
      doc.text(`Date: ${new Date(order.orderDate).toLocaleString()}`);
      doc.text(`Customer: ${customer.name}`);
      doc.moveDown(1);

      // Order Items section
      doc.fontSize(14).font("Helvetica-Bold").text("Order Items:");
      doc.moveDown(0.5);
      doc.font("Helvetica");

      let itemNumber = 1;
      order.items.forEach((item) => {
        const weight = item.weight ? `(${item.weight})` : "()";
        doc.text(`${itemNumber}. ${item.productName} ${weight}`);
        doc.text(
          `   Qty: ${item.quantity} × ${item.price.toFixed(
            2
          )} = ${item.totalPrice.toFixed(2)}`
        );
        doc.moveDown(0.3);
        itemNumber++;
      });

      doc.moveDown(0.5);

      // Delivery Information - Get real details from customer schema
      const deliveryAddress =
        order.deliveryAddress?.fullAddress ||
        customer.addresses?.find((addr) => addr.isDefault)?.fullAddress ||
        customer.addresses?.[0]?.fullAddress ||
        "N/A";

      const deliveryArea =
        order.deliveryAddress?.area ||
        customer.addresses?.find((addr) => addr.isDefault)?.area ||
        customer.addresses?.[0]?.area ||
        "Area not specified";

      const deliveryType =
        order.deliveryType === "truck"
          ? "Truck Delivery"
          : order.deliveryType === "scooter"
          ? "Scooter Delivery"
          : order.deliveryType === "self_pickup"
          ? "Self Pickup"
          : order.deliveryType || "Standard Delivery";

      const deliverySpeed =
        order.deliverySpeed === "normal"
          ? "Normal Delivery"
          : order.deliverySpeed === "speed"
          ? "Express Delivery"
          : order.deliverySpeed === "early_morning"
          ? "Early Morning Delivery"
          : order.deliverySpeed === "eco"
          ? "Eco Friendly Delivery"
          : order.deliverySpeed || "Standard";

      const timeSlot = order.timeSlot || "Time slot to be confirmed N/A";
      const googlemaplink = customer.contextData.locationDetails;

      doc.text(`Google Map Link Adress : ${googlemaplink}`);

      doc.text(`Delivery: ${deliveryAddress}`);
      doc.text(`Delivery Type: ${deliveryType}`);
      doc.text(`Deliver time: ${timeSlot}`);
      doc.text(`Delivery area: ${deliveryArea}`);
      doc.text(`Deliver type: ${deliverySpeed}`);
      doc.moveDown(1);

      // Order Summary
      doc.fontSize(14).font("Helvetica-Bold").text("Order Summary:");
      doc.moveDown(0.3);
      doc.font("Helvetica");

      const subtotal = order.totalAmount - (order.deliveryCharge || 0);
      doc.text(`Subtotal: ${subtotal.toFixed(2)}`);
      doc.text(`Delivery Fee: ${(order.deliveryCharge || 0).toFixed(2)}`);

      // ADD 10% FIRST ORDER DISCOUNT - ONLY ADDITION TO PDF
      if (order.firstOrderDiscount && order.firstOrderDiscount > 0) {
        doc.text(
          `First Order Discount (10%): -${order.firstOrderDiscount.toFixed(2)}`
        );
      }

      if (order.ecoDeliveryDiscount && order.ecoDeliveryDiscount > 0) {
        doc.text(`Discount: -${order.ecoDeliveryDiscount.toFixed(2)}`);
      }

      doc.moveDown(0.3);
      doc.font("Helvetica-Bold");
      doc.text(`Total: ${order.totalAmount.toFixed(2)}`);

      doc.moveDown(1);

      // Thank you message
      doc.font("Helvetica");
      doc.text("Thank you for your order!");
      doc.text("------------------------------------------------------");
      doc.moveDown(1.5);

      // Office section - exactly as provided
      doc.fontSize(14).font("Helvetica-Bold").text("Office:");
      doc.moveDown(0.3);
      doc.fontSize(12).font("Helvetica");
      doc.text("Address XXXX  XXXX");
      doc.text(
        "--------------------------------------------------------------"
      );
      doc.moveDown(1);

      // Bank account details - exactly as provided
      doc.fontSize(14).font("Helvetica-Bold").text("Bank account details:");
      doc.moveDown(0.3);
      doc.fontSize(12).font("Helvetica");
      doc.text("BCA");
      doc.text("# 555XXX XXXX");
      doc.text("bank code 14 XXXX");

      console.log(`✍️ [${new Date().toISOString()}] Writing PDF content...`);

      stream.on("finish", () => {
        console.log(
          `✅ [${new Date().toISOString()}] PDF generated successfully`
        );
        resolve(filePath);
      });

      stream.on("error", (err) => {
        console.error(
          `❌ [${new Date().toISOString()}] PDF stream error:`,
          err
        );
        reject(err);
      });

      doc.end();
    } catch (err) {
      console.error(
        `💥 [${new Date().toISOString()}] PDF generation failed:`,
        err
      );
      reject(err);
    }
  });
}

// Remove all phone number cleaning - just use the raw number from database
async function sendDocumentWithMessage(to, filePath, message) {
  try {
    console.log(`📤 Preparing to send document to ${to}`);

    // Verify document exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`Document not found at ${filePath}`);
    }

    console.log(`📄 Document found at ${filePath}`);
    const fileData = fs.readFileSync(filePath);
    const base64Data = fileData.toString("base64");

    // ✅ FIX: Validate phone format before sending
    if (!to || to.length < 8) {
      throw new Error(`Invalid phone number: ${to}`);
    }

    // Prepare payload - ensure phone is in correct format
    const cleanPhone = to.replace(/\D/g, "");
    const payload = new URLSearchParams();
    payload.append("token", ULTRAMSG_CONFIG.token);
    payload.append("to", cleanPhone); // ✅ Send clean number
    payload.append("document", `data:application/pdf;base64,${base64Data}`);
    payload.append("filename", `order_confirmation_${Date.now()}.pdf`);
    payload.append("caption", message);

    console.log(`⚡ Sending to UltraMsg API for ${cleanPhone}...`);
    console.log(`📄 File size: ${Math.round(fileData.length / 1024)}KB`);

    const response = await axios.post(
      `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/document`,
      payload,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 60000,
      }
    );

    console.log(`✅ UltraMsg response:`, response.data);

    // Check if response indicates success
    if (response.data.sent === false || response.data.error) {
      throw new Error(`UltraMsg API error: ${JSON.stringify(response.data)}`);
    }

    return response.data;
  } catch (error) {
    console.error(`❌ Document send failed for ${to}:`, error.message);

    if (error.response) {
      console.error(`API Response Status: ${error.response.status}`);
      console.error(`API Response Data:`, error.response.data);
    }

    throw error;
  }
}

// 4. Phone number normalizer for UltraMsg
function normalizePhoneForUltraMsg(phone) {
  // Remove all non-digit characters
  let clean = phone.replace(/\D/g, "");

  // Handle Indonesian numbers (replace leading 0 with 62)
  if (clean.startsWith("0")) {
    clean = "62" + clean.substring(1);
  }

  // Remove any country code prefix if already present
  clean = clean.replace(/^\+?62/, "62");

  return clean;
}
function normalizeWhatsAppId(rawPhone) {
  // For Ultramsg, we just need the clean phone number
  return rawPhone.replace(/\D/g, "");
}

async function sendDeliveryCompleteMessage(orderId, customer) {
  try {
    console.log(`📦 Sending delivery complete message for order ${orderId}`);

    const order = customer.shoppingHistory.find((o) => o.orderId === orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found in shopping history`);
    }

    const phone = customer.phoneNumber[0];
    if (!phone) throw new Error("No phone number available");

    // Get delivery media from order
    const deliveryMedia = order.deliveryMedia;
    if (!deliveryMedia) {
      throw new Error("No delivery media found for this order");
    }

    // ✅ STEP 1: Send intro message
    const introMessage =
      `✅ *Product Confirmed & Delivered!* ✅\n\n` +
      `Your order #${orderId} has been confirmed by our driver and delivered to your location.\n\n` +
      `📸 *Evidence Provided:*\n` +
      `We've documented the delivery process with photos and video for your records.`;

    await sendWhatsAppMessage(phone, introMessage);
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // ✅ STEP 2: Send delivery video if available
    if (deliveryMedia.deliveryVideo && deliveryMedia.deliveryVideo.base64Data) {
      try {
        console.log(`📹 Sending delivery video...`);
        const videoCaption =
          `📹 *Delivery Video*\n\n` +
          `This video shows the delivery confirmation, receipt verification, and customer acknowledgment.`;

        await sendVideoViaUltraMsg(
          phone,
          deliveryMedia.deliveryVideo.base64Data,
          deliveryMedia.deliveryVideo.mimetype || "video/mp4",
          videoCaption
        );

        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (videoError) {
        console.error(`⚠️ Error sending delivery video:`, videoError.message);
      }
    }

    // ✅ STEP 3: Send receipt photos in sequence
    const photoSequence = [
      {
        data: deliveryMedia.receiptInHandPhoto,
        caption: `🧾 *Receipt in Hand*\n\nThis confirms the delivery was handed to someone at your location.`,
      },
      {
        data: deliveryMedia.receiptCloseUpPhoto,
        caption: `🧾 *Receipt Close-Up*\n\nClear view of your order receipt for verification.`,
      },
      {
        data: deliveryMedia.receiptNextToFacePhoto,
        caption: `👤 *Proof of Delivery*\n\nReceipt held by the recipient for identity verification.`,
      },
      {
        data: deliveryMedia.entrancePhoto,
        caption: `🏠 *Delivery Location*\n\nPhoto of the entrance where your order was delivered.`,
      },
    ];

    for (const photo of photoSequence) {
      if (photo.data && photo.data.base64Data) {
        try {
          console.log(`📸 Sending photo: ${photo.caption.split("\n")[0]}`);

          await sendPhotoViaUltraMsg(
            phone,
            photo.data.base64Data,
            photo.data.mimetype || "image/jpeg",
            photo.caption
          );

          await new Promise((resolve) => setTimeout(resolve, 1500));
        } catch (photoError) {
          console.error(
            `⚠️ Error sending photo: ${photo.caption.split("\n")[0]}`,
            photoError.message
          );
        }
      }
    }

    // ✅ STEP 4: Send thank you message
    const thankYouMessage =
      `Thank you — we appreciate having you as our customer.\n` +
      `We would love to serve you again soon. ❤️\n\n` +
      `If you have any questions about this delivery, please contact our support team.`;

    await sendWhatsAppMessage(phone, thankYouMessage);
    console.log(`✅ Delivery complete message sequence sent to ${phone}`);

    return true;
  } catch (error) {
    console.error(`❌ Error sending delivery complete message:`, error);
    throw error;
  }
}

// ✅ FIX #4: NEW FUNCTION - Send On-the-Way Message
async function sendOnTheWayMessage(orderId, customer) {
  try {
    console.log(`🚚 Sending on-the-way message for order ${orderId}`);

    const order = customer.shoppingHistory.find((o) => o.orderId === orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const phone = customer.phoneNumber[0];
    if (!phone) throw new Error("No phone number available");

    // Get delivery details
    const deliveryLocation =
      order.deliveryAddress?.area || order.deliveryLocation || "your location";
    const deliveryTimeFrame = order.deliveryTimeFrame || "soon";

    const onTheWayMessage =
      `🚚 *Your Order is On the Way!* 🚚\n\n` +
      `Order #${orderId}\n` +
      `📦 Status: On Delivery\n\n` +
      `Your product is on the way and will be delivered to you soon.\n\n` +
      `📍 Delivery Area: ${deliveryLocation}\n` +
      `⏰ Expected Time: ${deliveryTimeFrame}\n\n` +
      `Please be at the location today. Thank you!`;

    await sendWhatsAppMessage(phone, onTheWayMessage);
    console.log(`✅ On-the-way message sent to ${phone}`);

    return true;
  } catch (error) {
    console.error(`❌ Error sending on-the-way message:`, error);
    throw error;
  }
}

// ✅ FIX #5: HELPER FUNCTIONS - Send media via UltraMsg
async function sendVideoViaUltraMsg(to, base64Data, mimetype, caption) {
  const cleanPhone = to.replace(/\D/g, "");
  const payload = new URLSearchParams();
  payload.append("token", ULTRAMSG_CONFIG.token);
  payload.append("to", cleanPhone);
  payload.append("video", `data:${mimetype};base64,${base64Data}`);
  payload.append("caption", caption);

  const response = await axios.post(
    `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/video`,
    payload,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 60000,
    }
  );

  if (!response.data?.sent) {
    throw new Error(`Video send failed: ${JSON.stringify(response.data)}`);
  }

  return response.data;
}

async function sendPhotoViaUltraMsg(to, base64Data, mimetype, caption) {
  const cleanPhone = to.replace(/\D/g, "");
  const payload = new URLSearchParams();
  payload.append("token", ULTRAMSG_CONFIG.token);
  payload.append("to", cleanPhone);
  payload.append("image", `data:${mimetype};base64,${base64Data}`);
  payload.append("caption", caption);

  const response = await axios.post(
    `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/image`,
    payload,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 30000,
    }
  );

  if (!response.data?.sent) {
    throw new Error(`Photo send failed: ${JSON.stringify(response.data)}`);
  }

  return response.data;
}
// Replace your cleanPhoneNumber function with:
function cleanPhoneNumber(phoneNumber) {
  // Remove WhatsApp suffixes if present
  let cleanNumber = phoneNumber.replace(/@(c\.us|s\.whatsapp\.net)$/, "");
  // Remove all non-digit characters
  cleanNumber = cleanNumber.replace(/\D/g, "");
  // Ensure it starts with country code without + or 00
  if (cleanNumber.startsWith("0")) {
    cleanNumber = "62" + cleanNumber.substring(1); // Replace leading 0 with 62 for Indonesia
  }
  return cleanNumber;
}

// Helper function for sending reliable sequential messages
async function sendSequentialMessages(
  phoneNumber,
  message1,
  message2,
  delayMs = 5000
) {
  try {
    console.log(`Sending first message`);
    await sendWhatsAppMessage(phoneNumber, message1);

    console.log(`Waiting ${delayMs}ms before sending second message`);
    setTimeout(async () => {
      try {
        await sendWhatsAppMessage(phoneNumber, message2);
        console.log(`Second message sent successfully`);
      } catch (error) {
        console.error(`Error sending second message: ${error.message}`);
      }
    }, delayMs);
  } catch (error) {
    console.error(`Error in sendSequentialMessages: ${error.message}`);
  }
}

async function findProductById(productId) {
  try {
    const product = await Product.findById(productId);
    return product; // Return as-is, no transformation
  } catch (error) {
    console.error(`Error finding product by ID ${productId}:`, error);
    return null;
  }
}

async function sendProductDetailsFromCart(to, customer, product) {
  try {
    let message = `📦 *Product Details*\n\n`;
    message += `*${product.productName || product.name}*\n\n`;

    if (product.description) {
      message += `${product.description}\n\n`;
    }

    message += `💰 *Price Information:*\n`;
    if (product.hasActiveDiscount && product.finalPrice < product.NormalPrice) {
      message += `   Original: Rp ${product.NormalPrice}\n`;
      message += `   Discounted: Rp ${product.finalPrice} ✨\n`;
      const savings = product.NormalPrice - product.finalPrice;
      message += `   You save: Rp ${savings}!\n`;
    } else {
      message += `   Rp ${product.finalPrice || product.price}\n`;
    }
    message += `\n`;

    if (product.Stock !== undefined) {
      message += `📊 *Stock:* ${
        product.Stock > 0 ? `${product.Stock} available` : "Out of stock"
      }\n\n`;
    }

    const details = [];
    if (product.weight) details.push(`⚖️ *Weight:* ${product.weight}`);
    if (product.material) details.push(`🧵 *Material:* ${product.material}`);
    if (product.brand) details.push(`🏷️ *Brand:* ${product.brand}`);
    if (product.color) details.push(`🎨 *Color:* ${product.color}`);
    if (product.size) details.push(`📏 *Size:* ${product.size}`);

    if (details.length > 0) {
      message += details.join("\n") + "\n\n";
    }

    if (product.care) {
      message += `🧼 *Care Instructions:*\n${product.care}\n\n`;
    }

    if (product.features && product.features.length > 0) {
      message += `✨ *Features:*\n`;
      product.features.forEach((feature) => {
        message += `   • ${feature}\n`;
      });
      message += `\n`;
    }

    if (product.category || product.subCategory) {
      message += `📁 *Category:* ${product.category || "N/A"}`;
      if (product.subCategory) {
        message += ` > ${product.subCategory}`;
      }
      message += `\n`;
    }

    // Send product images (master + additional)
    if (product.masterImage && product.masterImage.data) {
      try {
        await sendProductImages(to, product, message);
        console.log("📸 Product details with images sent successfully");
        return;
      } catch (error) {
        console.error("❌ Error sending product images from cart:", error);
      }
    }

    await sendWhatsAppMessage(to, message);
    console.log("📄 Product details sent as text");
  } catch (error) {
    console.error("❌ Error in sendProductDetailsFromCart:", error);
    await sendWhatsAppMessage(
      to,
      "Sorry, couldn't retrieve product details. Returning to cart..."
    );
  }
}

// Simplified function to get all discounted products
async function getDiscountedProducts() {
  console.log("Fetching all products with active discounts");

  try {
    // Query for products with active discounts
    const query = {
      hasActiveDiscount: true,
      "discountConfig.isActive": true,
      visibility: "Public",
      Stock: { $gt: 0 }, // Only show products with stock
    };

    // Fetch products from database
    const products = await Product.find(query)
      .select("_id productId productName discountConfig NormalPrice Stock")
      .limit(20) // Limit to 20 products for better UX
      .lean();

    console.log(`Found ${products.length} products with active discounts`);

    // Transform products to match the expected format - use _id for consistent lookup
    const transformedProducts = products.map((product) => ({
      id: product._id.toString(), // Use MongoDB _id for consistent lookup
      productId: product.productId, // Keep for reference
      name: product.productName,
      originalPrice:
        product.discountConfig.originalPrice || product.NormalPrice,
      discountPrice: product.discountConfig.newPrice,
      stock: product.Stock || 0,
      discountPercentage: product.discountConfig.discountPercentage || 0,
    }));

    return transformedProducts;
  } catch (error) {
    console.error("Error fetching discount products:", error);
    return [];
  }
}

// ─── Categories Menu ────────────────────────────────────────────────────────────
async function sendCategoriesList(phoneNumber, customer) {
  const categories = await Category.find({});
  let msg = "What are you looking for? This is the main shopping list\n\n";

  // store IDs for later mapping
  customer.contextData = customer.contextData || {};
  customer.contextData.categoryList = categories.map((c) => c._id.toString());

  categories.forEach((cat, idx) => {
    msg += `${idx + 1}. ${cat.name}\n`;
  });

  msg +=
    `\nPlease enter the category name or number to view its details.` +
    `\nType 0 to return to main menu or type "View cart" to view your cart`;

  await sendWhatsAppMessage(phoneNumber, msg);
  await customer.save();
}

async function sendSubcategoriesList(phoneNumber, customer, category) {
  const subcats = Array.isArray(category.subcategories)
    ? category.subcategories
    : [];

  customer.contextData.subcategoryList = subcats;
  await customer.save();

  // ✅ If no subcategories, show products directly using the CATEGORY NAME
  if (subcats.length === 0) {
    await customer.updateConversationState("product_list");
    return sendProductsList(phoneNumber, customer, category.name); // Pass category name
  }

  // Has subcategories, show subcategory menu
  let msg = `You selected category: ${category.name}\n\n`;
  msg += `This is the product divisions under category ${category.name}\n\n`;

  subcats.forEach((sub, idx) => {
    msg += `${idx + 1}. ${sub}\n`;
  });

  msg +=
    `\nPlease enter the subcategory number to view its products.` +
    `\nType 0 to return to main menu or type "View cart" to view your cart`;

  await sendWhatsAppMessage(phoneNumber, msg);
}
// Helper function to find category by ID
function findCategoryById(categoryId) {
  return productDatabase.categories.find((cat) => cat.id === categoryId);
}

// Helper function to find subcategory by ID within a category
function findSubCategoryById(categoryId, subCategoryId) {
  const category = findCategoryById(categoryId);
  if (!category) return null;
  return category.subCategories.find((sub) => sub.id === subCategoryId);
}

// Function to convert image into the required format (e.g., JPEG or PNG)
const convertImage = async (imageBuffer) => {
  try {
    const convertedImage = await sharp(imageBuffer)
      .resize({ width: 800 }) // Optional: Resize image if needed
      .toFormat("jpeg") // Convert image to JPEG format
      .toBuffer(); // Convert to buffer
    return convertedImage;
  } catch (error) {
    console.error("Error converting image:", error);
    throw new Error("Error converting image");
  }
};

// ALSO FIX: createOrder function to save correct totalAmount
async function createOrder(customer) {
  console.log("Starting order creation for customer:", customer._id);
  const seq = await getNextSequence("orderId");
  console.log("Generated sequence:", seq);
  const orderId = "ORD" + (10000 + seq);
  console.log("Generated order ID:", orderId);

  // After an order is created for a customer who was referred:
  if (customer.referredBy) {
    const referrer = await Customer.findById(customer.referredBy.customerId);
    if (referrer) {
      await referrer.updateReferredCustomerOrder(
        customer._id,
        order.totalAmount
      );
    }
  }

  // Calculate first time customer discount (10% of subtotal)
  let firstOrderDiscount = 0;
  if (customer.isFirstTimeCustomer && customer.orderHistory.length === 0) {
    firstOrderDiscount = Math.round(customer.cart.totalAmount * 0.1);
    customer.cart.firstOrderDiscount = firstOrderDiscount;
  }

  // Calculate eco delivery discount (5% of subtotal)
  let ecoDeliveryDiscount = 0;
  if (customer.cart.deliverySpeed === "eco") {
    ecoDeliveryDiscount = Math.round(customer.cart.totalAmount * 0.05);
    customer.cart.ecoDeliveryDiscount = ecoDeliveryDiscount;
  }

  // FIX: Calculate the FINAL total including delivery charges and discounts
  const finalTotalAmount =
    customer.cart.totalAmount +
    customer.cart.deliveryCharge -
    firstOrderDiscount -
    ecoDeliveryDiscount;

  console.log("Calculated final total amount:", finalTotalAmount);

  // Calculate delivery date based on delivery type
  let deliveryDays = 5; // default
  let deliveryTimeFrame = "";

  switch (customer.cart.deliverySpeed) {
    case "speed":
      deliveryDays = 2;
      deliveryTimeFrame = "24-48 hours";
      break;
    case "early_morning":
      deliveryDays = 2;
      deliveryTimeFrame = "4:00 AM–9:00 AM within 24-48 hours";
      break;
    case "eco":
      deliveryDays = 10;
      deliveryTimeFrame = "8-10 days";
      break;
    case "normal":
    default:
      deliveryDays = 5;
      deliveryTimeFrame = "3-5 days";
      break;
  }

  // For scooter delivery
  if (customer.cart.deliveryType === "scooter") {
    if (customer.cart.deliverySpeed === "speed") {
      deliveryDays = 0;
      deliveryTimeFrame = "30 minutes - 1 hour";
    } else {
      deliveryDays = 0;
      deliveryTimeFrame = "within 2.5 hours";
    }
  }

  // Store time frame in cart for reference
  customer.cart.deliveryTimeFrame = deliveryTimeFrame;

  const newOrder = {
    orderId,
    items: [...customer.cart.items],
    // FIX: Save the complete calculated total as totalAmount
    totalAmount: finalTotalAmount,
    deliveryType: customer.cart.deliveryType,
    deliverySpeed: customer.cart.deliverySpeed,
    deliveryOption: customer.cart.deliveryOption,
    deliveryLocation: customer.cart.deliveryLocation,
    deliveryCharge: customer.cart.deliveryCharge,
    deliveryTimeFrame: deliveryTimeFrame,
    deliveryAddress: customer.cart.deliveryAddress
      ? {
          nickname: customer.cart.deliveryAddress.nickname || "",
          area:
            customer.cart.deliveryAddress.area ||
            customer.cart.deliveryLocation ||
            "",
          fullAddress: customer.cart.deliveryAddress.fullAddress || "",
          googleMapLink: customer.cart.deliveryAddress.googleMapLink || "",
        }
      : {
          area: customer.cart.deliveryLocation || "",
        },
    firstOrderDiscount: firstOrderDiscount,
    ecoDeliveryDiscount: ecoDeliveryDiscount,
    paymentStatus: "pending",
    status: "order-made-not-paid",
    paymentMethod: "Bank Transfer",
    transactionId: customer.contextData.transactionId || "Pending verification",
    orderDate: new Date(),
    deliveryDate: new Date(Date.now() + deliveryDays * 24 * 60 * 60 * 1000),
  };

  customer.orderHistory.push(newOrder);
  customer.shoppingHistory.push(newOrder);
  customer.latestOrderId = orderId;
  customer.currentOrderStatus = "order-made-not-paid";

  // Clear cart completely
  customer.cart = {
    items: [],
    totalAmount: 0,
    deliveryCharge: 0,
    deliveryType: "truck",
    deliverySpeed: "normal",
    deliveryOption: "Normal Delivery",
    deliveryLocation: "",
    deliveryTimeFrame: "",
    firstOrderDiscount: 0,
    ecoDeliveryDiscount: 0,
    deliveryAddress: {},
  };

  customer.contextData = {
    ...(customer.contextData || {}),
    currentOrder: null,
    transactionId: null,
    paymentDetails: null,
  };

  customer.conversationState = "main_menu";

  await customer.save();
  return orderId;
}
async function processChatMessage(phoneNumber, text, message) {
  try {
    // Handle "0" to return to main menu from anywhere
    const isMainMenuRequest = text === "0";

    // Fetch or create customer
    let customer = await Customer.findOne({ phoneNumber });

    // If this is a new customer
    if (!customer) {
      // Only trigger the bot if first message is "hi" (case insensitive)
      if (text.toLowerCase() !== "hi") {
        return; // Don't respond if first message isn't "hi"
      }

      customer = new Customer({
        phoneNumber,
        name: "Guest", // Temporary name
        conversationState: "greeting",
      });
      await customer.save();

      // Check if we should send a pickup reminder
      if (
        customer.pickupPlan &&
        customer.pickupPlan.date === moment().format("YYYY-MM-DD") &&
        customer.cart.deliveryType === "self_pickup" &&
        !customer.pickupPlan.reminderSent
      ) {
        const timeSlot = customer.pickupPlan.timeSlot || "any time today";

        const lastOrder =
          customer.orderHistory?.[customer.orderHistory.length - 1];

        await sendWhatsAppMessage(
          customer.phoneNumber[0],
          `📦 *Pickup Reminder!* 📦\n\n` +
            `Hi ${customer.name}, just a reminder that your order is ready for pickup *today* between *${timeSlot}*.\n\n` +
            `Order ID: #${lastOrder?.orderId || "unknown"}\n\n` +
            `If you need help, just reply with *support* anytime.`
        );

        // Mark reminder as sent
        customer.pickupPlan.reminderSent = true;
        await customer.save();
      }

      // Send welcome message
      await sendWhatsAppMessage(
        phoneNumber,
        "Hello! Welcome to Construction Materials Hub, your one-stop shop for construction materials. 😊 How can I assist you today?"
      );

      // Ask for name if first time
      await sendWhatsAppMessage(
        phoneNumber,
        "I see this is your first time contacting us, can I ask your name?"
      );

      // Save bot messages to chat history
      await customer.addToChatHistory(
        "Hello! Welcome to Construction Materials Hub, your one-stop shop for construction materials. 😊 How can I assist you today?",
        "bot"
      );
      await customer.addToChatHistory(
        "I see this is your first time contacting us, can I ask your name?",
        "bot"
      );

      return;
    }

    // Save customer message to chat history
    await customer.addToChatHistory(text, "customer");

    // If user wants to return to main menu
    if (isMainMenuRequest) {
      await sendMainMenu(phoneNumber, customer);
      return;
    }

    // Process based on conversation state
    switch (customer.conversationState) {
      case "greeting":
        // Save customer name
        customer.name = text;
        await customer.save();

        // Send personalized greeting and main menu
        await sendWhatsAppMessage(
          phoneNumber,
          `Hi ${text}, how can I assist you?`
        );

        await sendMainMenu(phoneNumber, customer);
        break;

      case "main_menu":
        // Process main menu selection
        switch (text) {
          case "1":
            // Explore materials for shopping
            await customer.updateConversationState("shopping_categories");
            await sendCategoriesList(phoneNumber, customer);
            break;

          case "2":
            // Check order history
            if (customer.orderHistory && customer.orderHistory.length > 0) {
              await customer.updateConversationState("order_history");
              const orderListMessage = generateOrderHistoryList(customer);
              await sendWhatsAppMessage(phoneNumber, orderListMessage);
            } else {
              await sendWhatsAppMessage(
                phoneNumber,
                "You don't have any order history yet. Start shopping to create your first order!"
              );
              await sendMainMenu(phoneNumber, customer);
            }
            break;

          case "3":
            // Avail Discounts - Show discounted products and eligible categories
            // State will be updated inside sendBatchDiscountEligibility after products are shown
            await sendBatchDiscountEligibility(phoneNumber, customer);
            break;

          case "4":
            // Learn about referral program - send referral intro directly
            // FIX: Removed recursive processChatMessage call that caused duplicate messages
            const canSeeCommission = customer.foremanStatus?.isCommissionEligible || false;
            let referralIntroMessage = "🎉 Welcome to our Referral Program!\n\n";
            
            if (canSeeCommission) {
              const commissionRate = customer.foremanStatus?.commissionRate || 5;
              const availableCommission = customer.commissionTracking?.availableCommission || 0;
              referralIntroMessage += `💰 You're eligible to earn ${commissionRate}% commission!\n`;
              referralIntroMessage += `💼 Available commission: Rs. ${availableCommission.toFixed(2)}\n\n`;
            }
            
            referralIntroMessage +=
              `🎥 Share videos with friends and earn rewards!\n\n` +
              `📱 Please record and send your referral video now\n\n` +
              `📏 Max size: 15MB\n` +
              `⏱️ Keep it under 1 minute for best results!`;
            
            await sendWhatsAppMessage(phoneNumber, referralIntroMessage);
            await sendWhatsAppMessage(phoneNumber, "📱 Send your video now or type '0' to return to main menu");
            await customer.updateConversationState("create_video");
            break;

          case "5":
            // Support - Updated to match new comprehensive support system
            await customer.updateConversationState("support");
            await customer.clearSupportFlow(); // Clear any existing support flow
            await sendWhatsAppMessage(
              phoneNumber,
              "📞 *Customer Support* 📞\n\n" +
                "How can we help you today?\n\n" +
                "1. Delivery & Product Issues\n" +
                "2. Check My Delivery\n" +
                "3. Payment Problems\n" +
                "4. Speak to an Agent\n" +
                "5. Submit a Complaint\n" +
                "6. FAQs\n\n" +
                "Type the number to continue or 0 to return to main menu."
            );
            break;
          case "6":
            // My profile
            await customer.updateConversationState("profile");

            let updatedProfileMessage =
              `👤 *Your Profile* 👤\n\n` +
              `Name: ${customer.name}\n` +
              `📱 Master Number: ${cleanPhoneNumber(
                customer.phoneNumber?.[0] || ""
              )}\n`;

            if (customer.phoneNumber.length > 1) {
              updatedProfileMessage += `🔗 Connected Numbers:\n`;
              customer.phoneNumber.slice(1).forEach((num, index) => {
                updatedProfileMessage += `   ${index + 1}. ${cleanPhoneNumber(
                  num
                )}\n`;
              });
            }

            updatedProfileMessage +=
              `Email: ${customer.contextData?.email || "Not provided"}\n\n` +
              `Total Orders: ${customer.orderHistory.length}\n` +
              `Referral Code: ${
                customer.referralCode ||
                "CM" + customer._id.toString().substring(0, 6)
              }\n\n` +
              `What would you like to do?\n\n` +
              `1. Update Name\n` +
              `2. Update Email\n` +
              `3. Manage Addresses\n` +
              `4. My Account \n` +
              `5. Manage Bank Accounts\n` +
              `6. Return to Main Menu`;

            await sendWhatsAppMessage(phoneNumber, updatedProfileMessage);
            break;

          case "7":
            // Go to cart
            await goToCart(phoneNumber, customer);
            break;

          default:
            // Handle invalid input
            await sendWhatsAppMessage(
              phoneNumber,
              "I didn't understand that choice. Please select a number from the menu or type 0 to see the main menu again."
            );
            break;
        }
        break;

      // ============================================================================
      // BATCH DISCOUNT FLOW HANDLERS
      // ============================================================================
      case "batch_discount_menu": {
        let eligibleCats = customer.contextData?.eligibleBatchCategories || [];
        let discountProductList = customer.contextData?.discountProductList || [];
        const textUpper = text.toUpperCase().trim();
        
        console.log(`batch_discount_menu - Input: "${text}", Products: ${discountProductList.length}, Categories: ${eligibleCats.length}`);
        
        // If context data is empty, reload the discount menu
        if (discountProductList.length === 0 && eligibleCats.length === 0) {
          console.log("Context data empty, reloading discount menu...");
          await sendBatchDiscountEligibility(phoneNumber, customer);
          break;
        }
        
        // Check if input is a letter (A-Z) for category selection
        if (/^[A-Z]$/.test(textUpper)) {
          const catIdx = textUpper.charCodeAt(0) - 65; // Convert A=0, B=1, etc.
          if (catIdx >= 0 && catIdx < eligibleCats.length) {
            const selectedCat = eligibleCats[catIdx];
            customer.contextData.selectedBatchCategory = selectedCat;
            await customer.save();
            await sendBatchDiscountProducts(phoneNumber, customer, selectedCat);
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Invalid category. Please choose a valid letter from the list or type *0* for main menu."
            );
          }
          break;
        }
        
        // Check if input is a number for product selection
        const prodIdx = parseInt(text, 10) - 1;
        console.log(`Parsed product index: ${prodIdx}, list length: ${discountProductList.length}`);
        
        if (!isNaN(prodIdx) && prodIdx >= 0 && prodIdx < discountProductList.length) {
          const selectedProductId = discountProductList[prodIdx];
          console.log(`Looking up product with _id: "${selectedProductId}"`);
          
          // Now using findById since we store MongoDB _id
          const product = await Product.findById(selectedProductId);
          console.log(`Product found:`, product ? product.productName : 'NOT FOUND');
          
          if (product) {
            customer.contextData.productId = product._id.toString();
            customer.contextData.productName = product.productName;
            customer.conversationState = "product_details";
            customer.lastInteraction = new Date();
            await customer.save();
            await sendProductDetails(phoneNumber, customer, product);
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Product not found. Please try again or type *0* for main menu."
            );
          }
        } else if (discountProductList.length === 0) {
          // No products but user typed a number - reload the menu
          await sendWhatsAppMessage(
            phoneNumber,
            "Loading discount products..."
          );
          await sendBatchDiscountEligibility(phoneNumber, customer);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid selection. Please choose a product number or category letter from the list, or type *0* for main menu."
          );
        }
        break;
      }

      case "batch_discount_categories": {
        const eligibleCats = customer.contextData?.eligibleBatchCategories || [];
        const textLower = text.toLowerCase().trim();
        
        // If no categories, go back to main discount menu
        if (eligibleCats.length === 0) {
          console.log("eligibleBatchCategories empty, reloading discount menu");
          await sendBatchDiscountEligibility(phoneNumber, customer);
          break;
        }
        
        // Handle "A" to see all eligible products
        if (textLower === "a") {
          await sendWhatsAppMessage(phoneNumber, "📦 *Fetching all your eligible discount products...*");
          // Show products from all eligible categories
          for (const cat of eligibleCats) {
            await sendBatchDiscountProducts(phoneNumber, customer, cat);
          }
          break;
        }
        
        const catIdx = parseInt(text, 10) - 1;
        if (catIdx >= 0 && catIdx < eligibleCats.length) {
          const selectedCat = eligibleCats[catIdx];
          customer.contextData.selectedBatchCategory = selectedCat;
          await customer.save();
          await sendBatchDiscountProducts(phoneNumber, customer, selectedCat);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid selection. Please choose a category number from the list, type *A* for all products, or *0* for main menu."
          );
        }
        break;
      }

      case "batch_discount_product_select": {
        const batchProducts = customer.contextData?.batchProductList || [];
        const prodIdx = parseInt(text, 10) - 1;
        
        // If batchProducts is empty, go back to main discount menu
        if (batchProducts.length === 0) {
          console.log("batchProductList empty, returning to discount menu");
          await sendBatchDiscountEligibility(phoneNumber, customer);
          break;
        }
        
        if (prodIdx >= 0 && prodIdx < batchProducts.length) {
          const selectedProdId = batchProducts[prodIdx];
          const product = await Product.findById(selectedProdId);
          
          if (product) {
            customer.contextData.productId = selectedProdId;
            customer.contextData.productName = product.productName;
            customer.conversationState = "product_details";
            customer.lastInteraction = new Date();
            await customer.save();
            await sendProductDetails(phoneNumber, customer, product);
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Product not found. Please try again or type *0* for main menu."
            );
          }
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid selection. Please choose a product number from the list or type *0* for main menu."
          );
        }
        break;
      }

      case "shopping_categories":
        // if first time in this state, we have no categoryList yet
        if (!customer.contextData.categoryList) {
          await sendCategoriesList(phoneNumber, customer);
        } else {
          const idx = parseInt(text, 10) - 1;
          const ids = customer.contextData.categoryList;
          if (idx >= 0 && idx < ids.length) {
            const selId = ids[idx];
            const category = await Category.findById(selId);
            customer.contextData.categoryId = selId;
            customer.contextData.categoryName = category.name;
            await customer.save();

            await customer.updateConversationState("shopping_subcategories");
            await sendSubcategoriesList(phoneNumber, customer, category);
          } else if (text.toLowerCase() === "view cart") {
            return goToCart(phoneNumber, customer);
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              "Please select a valid category number, 'view cart', or 0 for main menu."
            );
          }
        }
        break;

      case "shopping_subcategories":
        const idxSub = parseInt(text) - 1;
        const subList = customer.contextData.subcategoryList || [];

        if (idxSub >= 0 && idxSub < subList.length) {
          const selSub = subList[idxSub];
          customer.contextData.subCategoryName = selSub;
          await customer.save();

          await customer.updateConversationState("product_list");
          await sendProductsList(phoneNumber, customer, selSub); // ✅ Pass subcategory name
        } else if (text.toLowerCase() === "view cart") {
          await goToCart(phoneNumber, customer);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please select a valid subcategory number, type 'view cart' or 0 for main menu."
          );
        }
        break;
      case "product_list":
        const idxProd = parseInt(text) - 1;
        const prodList = customer.contextData.productList || [];
        if (idxProd >= 0 && idxProd < prodList.length) {
          const selProdId = prodList[idxProd];
          const product = await Product.findById(selProdId);
          customer.contextData.productId = selProdId;
          customer.contextData.productName = product.productName;
          await customer.save();
          await customer.updateConversationState("product_details");
          await sendProductDetails(phoneNumber, customer, product);
        } else if (text.toLowerCase() === "view cart") {
          await goToCart(phoneNumber, customer);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please select a valid product number, type 'view cart' or 0 for main menu."
          );
        }
        break;

      case "product_details":
        // user answered "1- Add to cart"
        if (text === "1") {
          // fetch the real product
          const product = await Product.findById(
            customer.contextData.productId
          );
          if (!product) {
            await sendWhatsAppMessage(
              phoneNumber,
              "Oops, I can't find that product right now. Let's start over."
            );
            return sendMainMenu(phoneNumber, customer);
          }

          // if it's a Child product OR has specifications, show weight options
          if (product.productType === "Child" || (product.specifications && product.specifications.length > 0)) {
            // FIX: Use this specific product's specifications, NOT sibling variants
            const specifications = product.specifications || [];
            
            if (specifications.length === 0) {
              // No specifications, go straight to quantity
              await customer.updateConversationState("select_quantity");
              return sendWhatsAppMessage(
                phoneNumber,
                `How many *${product.productName}* would you like? (Enter a number)`
              );
            }
            
            // Build weight options from THIS product's specifications
            let weightMsg = `Please pick the weight option for *${product.productName}*:\n\n`;
            specifications.forEach((spec, i) => {
              const w = spec.weight ?? spec.size ?? spec.variant ?? "Option";
              const price = spec.price ?? product.NormalPrice ?? "N/A";
              weightMsg += `${i + 1}. ${w} - Rp ${price}\n`;
            });
            weightMsg += `\nType the number of your choice or 0 to go back.`;

            // Store the specifications for selection as JSON strings (schema expects [String])
            customer.contextData.weightOptions = specifications.map((spec, i) => 
              JSON.stringify({
                index: i,
                weight: spec.weight ?? spec.size ?? spec.variant,
                price: spec.price ?? product.NormalPrice,
                productId: product._id.toString()
              })
            );
            customer.contextData.selectedProductId = product._id.toString();
            await customer.save();
            await customer.updateConversationState("select_weight");
            return sendWhatsAppMessage(phoneNumber, weightMsg);

          }


          // otherwise it's a Normal (no‐weight) product: straight to quantity
          await customer.updateConversationState("select_quantity");
          await sendWhatsAppMessage(
            phoneNumber,
            `How many *${product.productName}* would you like? (Enter a number)`
          );
          return;
        }

        // user wants to go back…
        if (text === "2") {
          await customer.updateConversationState("shopping_subcategories");
          const cat = await Category.findById(customer.contextData.categoryId);
          return sendSubcategoriesList(phoneNumber, customer, cat);
        }
        if (text === "3") {
          await customer.updateConversationState("shopping_categories");
          return sendCategoriesList(phoneNumber, customer);
        }

        // invalid input
        return sendWhatsAppMessage(
          phoneNumber,
          "Invalid choice. Reply 1 to add to cart, 2 for subcategories, 3 for categories, or 0 for main menu."
        );

      case "select_weight": {
        const idxW = parseInt(text, 10) - 1;
        const weightOptionsRaw = customer.contextData.weightOptions || [];
        // Parse JSON strings (stored as strings because schema expects [String])
        const weightOptions = weightOptionsRaw.map(opt => {
          try {
            return typeof opt === 'string' ? JSON.parse(opt) : opt;
          } catch {
            return opt;
          }
        });

        if (idxW >= 0 && idxW < weightOptions.length) {
          const chosenOption = weightOptions[idxW];
          const product = await Product.findById(customer.contextData.selectedProductId || customer.contextData.productId);
          
          if (!product) {
            await sendWhatsAppMessage(phoneNumber, "Sorry, couldn't find that product. Let's start over.");
            return sendMainMenu(phoneNumber, customer);
          }

          // Store selected weight and price for cart
          customer.contextData.selectedWeight = chosenOption.weight || chosenOption;
          customer.contextData.selectedPrice = chosenOption.price || product.NormalPrice;
          await customer.save();

          await sendWhatsAppMessage(
            phoneNumber,
            `You have chosen *${chosenOption.weight || chosenOption}* option at Rp ${chosenOption.price || product.NormalPrice}. Great choice!`
          );
          await customer.updateConversationState("select_quantity");
          return sendWhatsAppMessage(
            phoneNumber,
            `How many *${product.productName}* would you like to order? (Enter a number)`
          );
        }


        if (text === "0") {
          // cancel weight, back to product details
          await customer.updateConversationState("product_details");
          const prod = await Product.findById(customer.contextData.selectedProductId || customer.contextData.productId);
          return sendProductDetails(phoneNumber, customer, prod);
        }

        // Invalid input - show options again
        const product = await Product.findById(customer.contextData.selectedProductId || customer.contextData.productId);
        let msg = `Please select a valid weight option for *${product?.productName || 'this product'}*:\n\n`;
        weightOptions.forEach((opt, i) => {
          msg += `${i + 1}. ${opt.weight} - Rp ${opt.price}\n`;
        });
        msg += `\nType the number of your choice or 0 to go back.`;

        return sendWhatsAppMessage(phoneNumber, msg);
      }


      case "select_quantity": {
        const buyQty = parseInt(text, 10);
        if (Number.isInteger(buyQty) && buyQty > 0) {
          const finalProd = await Product.findById(
            customer.contextData.productId
          );
          const unitPrice = finalProd.NormalPrice || 0;
          const totalLine = unitPrice * buyQty;

          // 1) Push item into cart
          const weightLabel = customer.contextData.selectedWeight || "";
          customer.cart.items.push({
            productId: finalProd._id.toString(),
            productName: finalProd.productName,
            weight: weightLabel,
            quantity: buyQty,
            price: unitPrice,
            totalPrice: totalLine,
            imageUrl: finalProd.masterImage,
          });
          customer.cart.totalAmount = customer.cart.items.reduce(
            (sum, i) => sum + i.totalPrice,
            0
          );
          await customer.save();

          // 2) Record cart order
          await recordCartOrder(customer);

          // 3) ✅ RESET TIMER WHEN ITEMS ADDED
          await resetCartTimer(customer);

          // 4) Move to post_add_to_cart state
          await customer.updateConversationState("post_add_to_cart");

          // 5) Confirmation message
          const addedMsg =
            `added to your cart:\n` +
            `${finalProd.productName}\n` +
            `${buyQty} bags\n` +
            `for ${formatRupiah(totalLine)}`;
          await sendWhatsAppMessage(phoneNumber, addedMsg);

          // 6) Next menu
          return sendWhatsAppMessage(
            phoneNumber,
            "\nWhat do you want to do next?\n" +
              "1- View cart\n" +
              "2- Proceed to pay\n" +
              "3- Shop more (return to shopping list)\n" +
              "0- Main menu"
          );
        }

        return sendWhatsAppMessage(
          phoneNumber,
          "Please enter a valid quantity (a positive number), or 0 for main menu."
        );
      }

      case "post_add_to_cart":
        switch (text) {
          case "1":
            // View cart
            await goToCart(phoneNumber, customer);
            break;

          case "2":
            // Proceed to payment
            await proceedToCheckout(phoneNumber, customer);
            break;

          case "3":
            // Return to shopping list
            await customer.updateConversationState("shopping_categories");
            await sendCategoriesList(phoneNumber, customer);
            break;

          default:
            await sendWhatsAppMessage(
              phoneNumber,
              "Please select a valid option (1, 2, or 3), or type 0 to return to the main menu."
            );
            break;
        }
        break;

      case "pickup_date_select": {
        if (!["1", "2", "3"].includes(text.trim())) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Please choose a valid option:\n1. Today\n2. Tomorrow\n3. Later"
          );
          return;
        }

        const today = moment().format("YYYY-MM-DD");
        const tomorrow = moment().add(1, "day").format("YYYY-MM-DD");

        switch (text.trim()) {
          case "1":
            customer.pickupPlan = { date: today };
            break;
          case "2":
            customer.pickupPlan = { date: tomorrow };
            break;
          case "3":
            // Go to extended 13-day calendar
            const dateOptions = [];
            for (let i = 0; i < 13; i++) {
              dateOptions.push(moment().add(i, "days"));
            }

            customer.pickupDateList = dateOptions.map((d) =>
              d.format("YYYY-MM-DD")
            );
            await customer.save();

            let msg = "📅 *Select a pickup date (from the next 13 days):*\n";
            msg += "--------------------------------------------\n";
            dateOptions.forEach((date, index) => {
              if (index === 0) {
                msg += `${index + 1}. Today\n`;
              } else if (index === 1) {
                msg += `${index + 1}. Tomorrow\n`;
              } else {
                msg += `${index + 1}. ${date.format("Do MMMM (ddd)")}\n`;
              }
            });

            await customer.updateConversationState(
              "pickup_date_select_confirm"
            );
            await sendWhatsAppMessage(phoneNumber, msg);
            return;

          default:
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Invalid selection. Please choose 1 (Today), 2 (Tomorrow), or 3 (Later)."
            );
            return;
        }

        await customer.updateConversationState("pickup_time_select");

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Got it! You're picking up on *${customer.pickupPlan.date}*.\n\n` +
            `🕒 Now select your preferred pickup time slot:\n\n` +
            `1. 6 AM – 9 AM\n` +
            `2. 9 AM – 12 PM\n` +
            `3. 12 PM – 3 PM\n` +
            `4. 3 PM – 6 PM\n` +
            `5. 6 PM – 9 PM`
        );
        break;
      }

      case "pickup_date_select_confirm": {
        console.log("🚨 [pickup_date_select_confirm] Raw text:", text);

        const idx = parseInt(text.trim()) - 1;
        console.log("📍 Parsed index:", idx);
        console.log("📍 customer.pickupDateList:", customer.pickupDateList);

        if (
          !customer.pickupDateList ||
          !Array.isArray(customer.pickupDateList)
        ) {
          console.log("❌ pickupDateList is missing or not an array");
          await sendWhatsAppMessage(
            phoneNumber,
            "⚠️ Something went wrong (date list missing). Please type *menu* and try again."
          );
          return;
        }

        if (isNaN(idx) || idx < 0 || idx >= customer.pickupDateList.length) {
          console.log("❌ Invalid index selected:", idx);
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Please select a valid number from the list (1–13)."
          );
          return;
        }

        const selectedDate = customer.pickupDateList[idx];
        console.log("✅ Selected date from list:", selectedDate);

        customer.pickupPlan.date = selectedDate;
        customer.pickupDateList = []; // cleanup
        await customer.save();

        await customer.updateConversationState("pickup_time_select");

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Got it! You're picking up on *${customer.pickupPlan.date}*.\n\n` +
            `🕒 Now select your preferred pickup time slot:\n\n` +
            `1. 6 AM – 9 AM\n` +
            `2. 9 AM – 12 PM\n` +
            `3. 12 PM – 3 PM\n` +
            `4. 3 PM – 6 PM\n` +
            `5. 6 PM – 9 PM`
        );
        break;
      }

      case "pickup_time_select": {
        const timeOptions = {
          1: "6 AM – 9 AM",
          2: "9 AM – 12 PM",
          3: "12 PM – 3 PM",
          4: "3 PM – 6 PM",
          5: "6 PM – 9 PM",
        };

        const timeSlot = timeOptions[text.trim()];
        if (!timeSlot) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Please select a valid time slot (1–5)."
          );
          return;
        }

        customer.pickupPlan.timeSlot = timeSlot;

        const lastOrder =
          customer.orderHistory[customer.orderHistory.length - 1];

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Your order is in progress and will be confirmed once payment is verified!\n\n` +
            `🧾 Order ID: *#${lastOrder.orderId}*\n` +
            `📦 We'll expect you on *${customer.pickupPlan.date}* between *${timeSlot}*.\n\n` +
            `Thank you for shopping with us! 😊`
        );

        await customer.updateConversationState("main_menu");
        await sendMainMenu(phoneNumber, customer);
        break;
      }

      case "cart_view":
        // Handle cart actions
        const cartChoice = text.toLowerCase().trim();

        // Accept both letters (A, B, C...) and full text
        if (
          cartChoice === "a" ||
          cartChoice === "delete an item" ||
          cartChoice.includes("delete")
        ) {
          // Delete item
          if (customer.cart.items.length === 0) {
            await sendWhatsAppMessage(
              phoneNumber,
              "Your cart is already empty."
            );
            await sendMainMenu(phoneNumber, customer);
          } else {
            await customer.updateConversationState("cart_delete_item");
            let deleteMessage =
              "Which item would you like to remove from your cart?\n\n";
            customer.cart.items.forEach((item, index) => {
              deleteMessage += `${index + 1}. ${item.productName} (${
                item.weight
              }) - ${item.quantity} units - ${item.totalPrice}\n`;
            });
            deleteMessage +=
              "\nEnter the number of the item you want to delete.";

            await sendWhatsAppMessage(phoneNumber, deleteMessage);
          }
        } else if (
          cartChoice === "b" ||
          cartChoice === "empty my cart fully" ||
          cartChoice.includes("empty")
        ) {
          // Empty cart
          await customer.updateConversationState("cart_confirm_empty");
          await sendWhatsAppMessage(
            phoneNumber,
            "Are you sure you want to empty your cart?\n\n1. Yes, empty my cart\n2. No, keep my items"
          );
        } else if (
          cartChoice === "c" ||
          cartChoice === "proceed to payment" ||
          cartChoice === "checkout" ||
          cartChoice.includes("proceed") ||
          cartChoice.includes("payment")
        ) {
          // Proceed to checkout
          await proceedToCheckout(phoneNumber, customer);
        } else if (
          cartChoice === "d" ||
          cartChoice === "go back to menu" ||
          cartChoice.includes("back") ||
          cartChoice.includes("menu")
        ) {
          // Go back to menu
          await sendMainMenu(phoneNumber, customer);
        } else if (
          cartChoice === "e" ||
          cartChoice === "view product details" ||
          cartChoice.includes("view") ||
          cartChoice.includes("details")
        ) {
          // View product details
          if (customer.cart.items.length === 0) {
            await sendWhatsAppMessage(
              phoneNumber,
              "Your cart is empty. There are no product details to view."
            );
            await goToCart(phoneNumber, customer);
          } else {
            await customer.updateConversationState("cart_view_details");
            let detailsMessage =
              "Which product details would you like to view?\n\n";
            customer.cart.items.forEach((item, index) => {
              detailsMessage += `${index + 1}. ${item.productName} (${
                item.weight
              })\n`;
            });

            await sendWhatsAppMessage(phoneNumber, detailsMessage);
          }
        } else if (cartChoice === "0") {
          await sendMainMenu(phoneNumber, customer);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please select a valid option (A-E) or type 0 to return to the main menu."
          );
        }
        break;

      case "pickup_date_select": {
        if (!["1", "2", "3"].includes(text.trim())) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Please choose a valid option:\n1. Today\n2. Tomorrow\n3. Later"
          );
          return;
        }

        const today = moment().format("YYYY-MM-DD");
        const tomorrow = moment().add(1, "day").format("YYYY-MM-DD");

        switch (text.trim()) {
          case "1":
            customer.pickupPlan = { date: today };
            break;
          case "2":
            customer.pickupPlan = { date: tomorrow };
            break;
          case "3":
            // Go to extended 13-day calendar
            const dateOptions = [];
            for (let i = 0; i < 13; i++) {
              dateOptions.push(moment().add(i, "days"));
            }

            customer.pickupDateList = dateOptions.map((d) =>
              d.format("YYYY-MM-DD")
            );
            await customer.save();

            let msg = "📅 *Select a pickup date (from the next 13 days):*\n";
            msg += "--------------------------------------------\n";
            dateOptions.forEach((date, index) => {
              if (index === 0) {
                msg += `${index + 1}. Today\n`;
              } else if (index === 1) {
                msg += `${index + 1}. Tomorrow\n`;
              } else {
                msg += `${index + 1}. ${date.format("Do MMMM (ddd)")}\n`;
              }
            });

            await customer.updateConversationState(
              "pickup_date_select_confirm"
            );
            await sendWhatsAppMessage(phoneNumber, msg);
            return;

          default:
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Invalid selection. Please choose 1 (Today), 2 (Tomorrow), or 3 (Later)."
            );
            return;
        }

        await customer.updateConversationState("pickup_time_select");

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Got it! You're picking up on *${customer.pickupPlan.date}*.\n\n` +
            `🕒 Now select your preferred pickup time slot:\n\n` +
            `1. 6 AM – 9 AM\n` +
            `2. 9 AM – 12 PM\n` +
            `3. 12 PM – 3 PM\n` +
            `4. 3 PM – 6 PM\n` +
            `5. 6 PM – 9 PM`
        );
        break;
      }
      case "pickup_date_select_confirm": {
        console.log("🚨 [pickup_date_select_confirm] Raw text:", text);

        const idx = parseInt(text.trim()) - 1;
        console.log("📍 Parsed index:", idx);
        console.log("📍 customer.pickupDateList:", customer.pickupDateList);

        if (
          !customer.pickupDateList ||
          !Array.isArray(customer.pickupDateList)
        ) {
          console.log("❌ pickupDateList is missing or not an array");
          await sendWhatsAppMessage(
            phoneNumber,
            "⚠️ Something went wrong (date list missing). Please type *menu* and try again."
          );
          return;
        }

        if (isNaN(idx) || idx < 0 || idx >= customer.pickupDateList.length) {
          console.log("❌ Invalid index selected:", idx);
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Please select a valid number from the list (1–13)."
          );
          return;
        }

        const selectedDate = customer.pickupDateList[idx];
        console.log("✅ Selected date from list:", selectedDate);

        customer.pickupPlan.date = selectedDate;
        customer.pickupDateList = []; // cleanup
        await customer.save();

        await customer.updateConversationState("pickup_time_select");

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Got it! You're picking up on *${customer.pickupPlan.date}*.\n\n` +
            `🕒 Now select your preferred pickup time slot:\n\n` +
            `1. 6 AM – 9 AM\n` +
            `2. 9 AM – 12 PM\n` +
            `3. 12 PM – 3 PM\n` +
            `4. 3 PM – 6 PM\n` +
            `5. 6 PM – 9 PM`
        );
        break;
      }

      case "pickup_time_select": {
        const timeOptions = {
          1: "6 AM – 9 AM",
          2: "9 AM – 12 PM",
          3: "12 PM – 3 PM",
          4: "3 PM – 6 PM",
          5: "6 PM – 9 PM",
        };

        const timeSlot = timeOptions[text.trim()];
        if (!timeSlot) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Please select a valid time slot (1–5)."
          );
          return;
        }

        customer.pickupPlan.timeSlot = timeSlot;

        const lastOrder =
          customer.orderHistory[customer.orderHistory.length - 1];

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Your order is in progress and will be confirmed once payment is verified!\n\n` +
            `🧾 Order ID: *#${lastOrder.orderId}*\n` +
            `📦 We'll expect you on *${customer.pickupPlan.date}* between *${timeSlot}*.\n\n` +
            `Thank you for shopping with us! 😊`
        );

        await customer.updateConversationState("main_menu");
        await sendMainMenu(phoneNumber, customer);
        break;
      }

      case "cart_view":
        // Handle cart actions
        switch (text.toLowerCase()) {
          case "delete an item":
            if (customer.cart.items.length === 0) {
              await sendWhatsAppMessage(
                phoneNumber,
                "Your cart is already empty."
              );
              await sendMainMenu(phoneNumber, customer);
            } else {
              await customer.updateConversationState("cart_delete_item");
              let deleteMessage =
                "Which item would you like to remove from your cart?\n\n";
              customer.cart.items.forEach((item, index) => {
                deleteMessage += `${index + 1}. ${item.productName} (${
                  item.weight
                }) - ${item.quantity} units - ${item.totalPrice}\n`;
              });
              deleteMessage +=
                "\nEnter the number of the item you want to delete.";

              await sendWhatsAppMessage(phoneNumber, deleteMessage);
            }
            break;

          case "empty my cart fully":
            await customer.updateConversationState("cart_confirm_empty");
            await sendWhatsAppMessage(
              phoneNumber,
              "Are you sure you want to empty your cart?\n\n1. Yes, empty my cart\n2. No, keep my items"
            );
            break;

          case "proceed to payment":
          case "checkout":
            await proceedToCheckout(phoneNumber, customer);
            break;

          case "go back to menu":
            await sendMainMenu(phoneNumber, customer);
            break;

          case "view product details":
            if (customer.cart.items.length === 0) {
              await sendWhatsAppMessage(
                phoneNumber,
                "Your cart is empty. There are no product details to view."
              );
              await goToCart(phoneNumber, customer);
            } else {
              await customer.updateConversationState("cart_view_details");
              let detailsMessage =
                "Which product details would you like to view?\n\n";
              customer.cart.items.forEach((item, index) => {
                detailsMessage += `${index + 1}. ${item.productName} (${
                  item.weight
                })\n`;
              });

              await sendWhatsAppMessage(phoneNumber, detailsMessage);
            }
            break;

          default:
            await sendWhatsAppMessage(
              phoneNumber,
              "Please select a valid option from the cart menu, or type 0 to return to the main menu."
            );
            break;
        }
        break;

      // ENHANCED cart_delete_item case
      case "cart_delete_item":
        const itemIndex = parseInt(text) - 1;
        if (itemIndex >= 0 && itemIndex < customer.cart.items.length) {
          const itemToDelete = customer.cart.items[itemIndex];

          // Remove the item
          customer.cart.items.splice(itemIndex, 1);

          // Recalculate cart total
          customer.cart.totalAmount = customer.cart.items.reduce(
            (total, item) => total + item.totalPrice,
            0
          );

          // Recalculate discounts
          if (
            customer.isFirstTimeCustomer &&
            customer.orderHistory.length === 0
          ) {
            customer.cart.firstOrderDiscount = Math.round(
              customer.cart.totalAmount * 0.1
            );
          }

          if (customer.cart.deliverySpeed === "eco") {
            customer.cart.ecoDeliveryDiscount = Math.round(
              customer.cart.totalAmount * 0.05
            );
          }

          // Update corresponding order in history
          const idx = customer.orderHistory.findIndex(
            (o) => o.orderId === customer.latestOrderId
          );
          if (idx >= 0) {
            customer.orderHistory[idx].items = [...customer.cart.items];
            customer.orderHistory[idx].totalAmount =
              customer.cart.totalAmount +
              customer.cart.deliveryCharge -
              customer.cart.firstOrderDiscount -
              customer.cart.ecoDeliveryDiscount;
            customer.orderHistory[idx].firstOrderDiscount =
              customer.cart.firstOrderDiscount;
            customer.orderHistory[idx].ecoDeliveryDiscount =
              customer.cart.ecoDeliveryDiscount;
          }

          await customer.save();

          await sendWhatsAppMessage(
            phoneNumber,
            `✅ Removed ${itemToDelete.productName}${
              itemToDelete.weight ? ` (${itemToDelete.weight})` : ""
            } from your cart.`
          );

          // Return to cart view
          await goToCart(phoneNumber, customer);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please select a valid item number, or type 0 to return to the main menu."
          );
        }
        break;

      case "cart_confirm_empty":
        if (text === "1") {
          // Empty the cart using the new method
          await customer.emptyCart();

          await sendWhatsAppMessage(
            phoneNumber,
            "🗑️ Your cart has been completely emptied."
          );
          await sendMainMenu(phoneNumber, customer);
        } else if (text === "2") {
          await sendWhatsAppMessage(
            phoneNumber,
            "✅ Your cart items have been kept."
          );
          await goToCart(phoneNumber, customer);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please select 1 to empty cart or 2 to keep items, or type 0 for main menu."
          );
        }
        break;

        function logCartState(customer, action) {
          console.log(
            `[CART DEBUG - ${action}] Customer: ${customer.phoneNumber[0]}`
          );
          console.log(`Items: ${customer.cart.items.length}`);
          console.log(`Subtotal: ${customer.cart.totalAmount}`);
          console.log(`Delivery Charge: ${customer.cart.deliveryCharge}`);
          console.log(
            `First Order Discount: ${customer.cart.firstOrderDiscount}`
          );
          console.log(
            `Eco Delivery Discount: ${customer.cart.ecoDeliveryDiscount}`
          );
          console.log(`Delivery Type: ${customer.cart.deliveryType}`);
          console.log(`Delivery Speed: ${customer.cart.deliverySpeed}`);
          console.log(`Delivery Location: ${customer.cart.deliveryLocation}`);
          console.log(`Time Frame: ${customer.cart.deliveryTimeFrame}`);
          console.log(`Latest Order ID: ${customer.latestOrderId}`);
          console.log("---");
        }

      case "cart_view_details":
        const detailsIndex = parseInt(text) - 1;
        if (detailsIndex >= 0 && detailsIndex < customer.cart.items.length) {
          const item = customer.cart.items[detailsIndex];
          const product = await Product.findById(item.productId);

          if (product) {
            // Build simple message: name + description + price
            const price =
              product.finalPrice != null
                ? product.finalPrice
                : product.NormalPrice || product.price;

            const caption =
              `*${product.productName || product.name}*\n` +
              `${product.description || ""}\n\n` +
              `💰 Price: Rp ${price}`;

            // Send with images if available
            if (product.masterImage && product.masterImage.data) {
              try {
                await sendProductImages(phoneNumber, product, caption);
              } catch (error) {
                await sendWhatsAppMessage(phoneNumber, caption);
              }
            } else {
              await sendWhatsAppMessage(phoneNumber, caption);
            }

            setTimeout(async () => {
              await goToCart(phoneNumber, customer);
            }, 2000);
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              "Product details not found. Returning to cart."
            );
            await goToCart(phoneNumber, customer);
          }
        } else {
          await sendWhatsAppMessage(phoneNumber, "Invalid selection.");
          await goToCart(phoneNumber, customer);
        }
        break;

      case "checkout_delivery":
        // ✅ NEW: Handle delivery speed selection only (vehicle already auto-assigned)
        if (["1", "2", "3", "4", "5"].includes(text)) {
          const deliveryOptions = {
            1: "Normal Delivery",
            2: "Speed Delivery",
            3: "Early Morning Delivery",
            4: "Eco Delivery",
            5: "Self Pickup",
          };

          const deliveryCharges = {
            1: 0,
            2: 50000,
            3: 50000,
            4: 0,
            5: 0,
          };

          const deliveryTimeFrames = {
            1: "3-5 days",
            2: "24-48 hours",
            3: "4:00 AM–9:00 AM within 24-48 hours",
            4: "8-10 days",
            5: "Self pickup - schedule your time",
          };

          // ✅ CRITICAL FIX: Ensure all cart values are valid numbers FIRST
          customer.cart.totalAmount = ensureValidNumber(
            customer.cart.totalAmount,
            0
          );
          customer.cart.deliveryCharge = 0; // Reset to 0 before setting new value

          // ✅ NEW: Vehicle type already set, only update delivery speed
          let deliverySpeed;
          switch (text) {
            case "1":
              deliverySpeed = "normal";
              break;
            case "2":
              deliverySpeed = "speed";
              break;
            case "3":
              deliverySpeed = "early_morning";
              break;
            case "4":
              deliverySpeed = "eco";
              // Ensure totalAmount is valid before calculating discount
              const validTotal = ensureValidNumber(
                customer.cart.totalAmount,
                0
              );
              customer.cart.ecoDeliveryDiscount = Math.round(validTotal * 0.05);
              break;
            case "5":
              // Self pickup - override vehicle type
              customer.cart.deliveryType = "self_pickup";
              deliverySpeed = "normal";
              break;
          }

          // ✅ Set delivery charge with validation
          const selectedCharge = deliveryCharges[text];
          customer.cart.deliveryCharge = ensureValidNumber(selectedCharge, 0);
          customer.cart.deliveryOption = deliveryOptions[text];
          // Keep existing deliveryType unless it's self_pickup
          if (text !== "5") {
            // Don't change vehicle type for options 1-4
          }
          customer.cart.deliverySpeed = deliverySpeed;
          customer.cart.deliveryTimeFrame = deliveryTimeFrames[text];

          // Apply first time customer discount if applicable
          if (
            customer.isFirstTimeCustomer &&
            customer.orderHistory.length === 0
          ) {
            const subtotal = ensureValidNumber(customer.cart.totalAmount, 0);
            customer.cart.firstOrderDiscount = Math.round(subtotal * 0.1);
          }

          // Update current order in orderHistory if exists
          const idx = customer.orderHistory.findIndex(
            (o) => o.orderId === customer.latestOrderId
          );
          if (idx >= 0) {
            customer.orderHistory[idx].deliveryType = customer.cart.deliveryType;
            customer.orderHistory[idx].deliverySpeed = deliverySpeed;
            customer.orderHistory[idx].deliveryOption = deliveryOptions[text];
            customer.orderHistory[idx].deliveryCharge =
              customer.cart.deliveryCharge;
            customer.orderHistory[idx].deliveryTimeFrame =
              deliveryTimeFrames[text];
            customer.orderHistory[idx].ecoDeliveryDiscount =
              customer.cart.ecoDeliveryDiscount || 0;
            customer.orderHistory[idx].firstOrderDiscount =
              customer.cart.firstOrderDiscount || 0;
          }

          await customer.save();

          // Provide confirmation message
          let confirmationMsg = `You've chosen ${deliveryOptions[text]}.`;

          if (customer.cart.deliveryCharge > 0) {
            confirmationMsg += ` A ${formatRupiah(
              customer.cart.deliveryCharge
            )} charge will be added.`;
          }

          if (text === "4") {
            confirmationMsg += ` 5% eco-discount applied! Delivery in 8-10 days.`;
          }

          if (customer.cart.firstOrderDiscount > 0) {
            confirmationMsg += ` First order 10% discount applied!`;
          }

          confirmationMsg += ` Estimated delivery: ${deliveryTimeFrames[text]}.`;

          await sendWhatsAppMessage(phoneNumber, confirmationMsg);

          // Move to next step based on delivery type
          if (text === "5") {
            // Self pickup - go to date selection
            await customer.updateConversationState("pickup_date_select");
            await sendWhatsAppMessage(
              phoneNumber,
              "📅 When would you like to pick up your order?\n\n" +
                "1. Today\n" +
                "2. Tomorrow\n" +
                "3. Later (choose from calendar)"
            );
          } else {
            // Delivery options - go to REGENCY selection first (Step 1)
            await customer.updateConversationState("checkout_select_regency");

            const regencies = await getAllRegencies();
            const regenciesDisplay = formatRegenciesForDisplay(regencies);

            const locPrompt = customer.addresses?.length
              ? `Select a regency:\n\n${regenciesDisplay}\nOr type 'saved' to use a saved address.`
              : `Select a regency:\n\n${regenciesDisplay}`;

            await sendWhatsAppMessage(phoneNumber, locPrompt);
            break;
          }
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please choose a valid delivery speed (1–5), or type 0 to return to main menu."
          );
        }
        break;
      case "checkout_eco_delivery_date":
        // Validate date format (YYYY-MM-DD)
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(text)) {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please enter date in YYYY-MM-DD format (e.g., 2025-01-20)"
          );
          return;
        }

        const selectedDate = new Date(text);
        const today = new Date();
        const minDate = new Date(today.getTime() + 8 * 24 * 60 * 60 * 1000);
        const maxDate = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000);

        if (selectedDate < minDate || selectedDate > maxDate) {
          await sendWhatsAppMessage(
            phoneNumber,
            `Please select a date between ${
              minDate.toISOString().split("T")[0]
            } and ${maxDate.toISOString().split("T")[0]} for Eco Delivery.`
          );
          return;
        }

        // Save eco delivery date
        customer.cart.deliveryDate = selectedDate;

        // Update order if exists
        const idx1 = customer.orderHistory.findIndex(
          (o) => o.orderId === customer.latestOrderId
        );
        if (idx1 >= 0) {
          customer.orderHistory[idx1].deliveryDate = selectedDate;
        }

        await customer.save();

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Eco delivery scheduled for ${text}. 5% discount applied!`
        );

        // Now ask for regency selection first (Step 1)
        await customer.updateConversationState("checkout_select_regency");
        const regencies2 = await getAllRegencies();
        const regenciesDisplay2 = formatRegenciesForDisplay(regencies2);

        await sendWhatsAppMessage(
          phoneNumber,
          `Select a regency:\n\n${regenciesDisplay2}`
        );
        break;

      // NEW: Step 1 - Select Regency first
      case "checkout_select_regency":
        // Check if customer wants saved addresses
        if (customer.addresses && customer.addresses.length > 0) {
          if (text.toLowerCase() === "saved") {
            await customer.updateConversationState(
              "checkout_select_saved_address"
            );
            let addressMessage =
              "Please select one of your saved addresses:\n\n";

            customer.addresses.forEach((addr, index) => {
              const nickname = addr.nickname || "Address";
              const area = addr.area ? ` (${addr.area})` : "";
              const fullAddress = addr.fullAddress || "No detail address";
              addressMessage += `${
                index + 1
              }. ${nickname}: ${fullAddress}${area}\n`;
            });

            addressMessage +=
              "\nType the number of the address you want to use.";
            await sendWhatsAppMessage(phoneNumber, addressMessage);
            return;
          }
        }

        // Handle regency selection
        const regencies = await getAllRegencies();
        const regencyIndex = parseInt(text) - 1;

        if (regencyIndex >= 0 && regencyIndex < regencies.length) {
          const selectedRegency = regencies[regencyIndex];
          
          // Ensure contextData exists
          if (!customer.contextData) {
            customer.contextData = {};
          }
          
          // Store selected regency ID in context for next step
          customer.contextData.selectedRegencyId = selectedRegency._id.toString();
          customer.contextData.selectedRegencyName = selectedRegency.name;
          
          // Debug log
          console.log(`[REGENCY SELECTION] Saving regency: ${selectedRegency.name} (${selectedRegency._id}) for customer ${phoneNumber}`);
          
          await customer.save();
          
          console.log(`[REGENCY SELECTION] Saved. contextData.selectedRegencyId = ${customer.contextData.selectedRegencyId}`);

          // Get areas in this regency
          const areasInRegency = await getAreasByRegencyId(selectedRegency._id);
          
          if (areasInRegency.length === 0) {
            await sendWhatsAppMessage(
              phoneNumber,
              `No areas found in ${selectedRegency.name}. Please select a different regency.`
            );
            const regenciesDisplay = formatRegenciesForDisplay(regencies);
            await sendWhatsAppMessage(
              phoneNumber,
              `Select a regency:\n\n${regenciesDisplay}`
            );
            return;
          }

          const areasDisplay = formatAreasInRegencyForDisplay(areasInRegency);

          // Move to Step 2 - Area selection
          await customer.updateConversationState("checkout_location");
          
          console.log(`[REGENCY SELECTION] Moving to checkout_location state`);
          
          await sendWhatsAppMessage(
            phoneNumber,
            `📍 *${selectedRegency.name}*\n\nSelect an area:\n\n${areasDisplay}`
          );
        } else {
          // Invalid selection - show regencies again
          const regenciesDisplay = formatRegenciesForDisplay(regencies);
          await sendWhatsAppMessage(
            phoneNumber,
            `Please select a valid regency number (1-${regencies.length}):\n\n${regenciesDisplay}`
          );
        }
        break;

      // Step 2 - Select Area within the selected Regency
      case "checkout_location":
        // Check if customer has saved addresses
        if (customer.addresses && customer.addresses.length > 0) {
          if (text.toLowerCase() === "saved") {
            await customer.updateConversationState(
              "checkout_select_saved_address"
            );
            let addressMessage =
              "Please select one of your saved addresses:\n\n";

            customer.addresses.forEach((addr, index) => {
              const nickname = addr.nickname || "Address";
              const area = addr.area ? ` (${addr.area})` : "";
              const fullAddress = addr.fullAddress || "No detail address";
              addressMessage += `${
                index + 1
              }. ${nickname}: ${fullAddress}${area}\n`;
            });

            addressMessage +=
              "\nType the number of the address you want to use.";
            await sendWhatsAppMessage(phoneNumber, addressMessage);
            return;
          }
        }
        
        // Debug log to check contextData
        console.log(`[CHECKOUT_LOCATION] Customer ${phoneNumber} - contextData:`, JSON.stringify(customer.contextData));
        
        // Get areas from the selected regency (stored in context from Step 1)
        const selectedRegencyId = customer.contextData?.selectedRegencyId;
        const selectedRegencyName = customer.contextData?.selectedRegencyName || "Selected Regency";
        
        console.log(`[CHECKOUT_LOCATION] selectedRegencyId = ${selectedRegencyId}, selectedRegencyName = ${selectedRegencyName}`);
        
        if (!selectedRegencyId) {
          // Fallback: if no regency selected, go back to regency selection
          console.log(`[CHECKOUT_LOCATION] No regency found, going back to regency selection`);
          await customer.updateConversationState("checkout_select_regency");
          const fallbackRegencies = await getAllRegencies();
          const fallbackRegenciesDisplay = formatRegenciesForDisplay(fallbackRegencies);
          await sendWhatsAppMessage(
            phoneNumber,
            `Please select a regency first:\n\n${fallbackRegenciesDisplay}`
          );
          return;
        }

        const areasInSelectedRegency = await getAreasByRegencyId(selectedRegencyId);
        const selectedAreaIndex = parseInt(text) - 1;

        if (selectedAreaIndex >= 0 && selectedAreaIndex < areasInSelectedRegency.length) {
          const selectedArea = areasInSelectedRegency[selectedAreaIndex];

          // Use regencyName and displayName from AreaB model (114 Delivery Fees)
          customer.cart.deliveryLocation = `${selectedArea.regencyName} - ${selectedArea.displayName}`;
          customer.cart.deliveryCharge = selectedArea.truckPrice; // ✅ Replace, don't add

          if (!customer.cart.deliveryAddress) {
            customer.cart.deliveryAddress = {};
          }
          customer.cart.deliveryAddress.area = selectedArea.displayName;
          customer.cart.deliveryAddress.state = selectedArea.regencyName;

          // Update order history if order exists
          const idx = customer.orderHistory.findIndex(
            (o) => o.orderId === customer.latestOrderId
          );
          if (idx >= 0) {
            customer.orderHistory[idx].deliveryLocation = selectedArea.displayName;
            customer.orderHistory[idx].deliveryCharge =
              customer.cart.deliveryCharge;
            if (!customer.orderHistory[idx].deliveryAddress) {
              customer.orderHistory[idx].deliveryAddress = {};
            }
            customer.orderHistory[idx].deliveryAddress.area = selectedArea.displayName;
          }
          
          // Clear the selected regency from context
          customer.contextData.selectedRegencyId = null;
          customer.contextData.selectedRegencyName = null;

          await customer.save();

          // Confirmation message
          let confirmationMsg = `You selected ${selectedArea.displayName}.`;
          if (selectedArea.truckPrice > 0) {
            // ✅ CORRECT - use selectedArea.truckPrice
            confirmationMsg += ` Additional charge of ${formatRupiah(
              selectedArea.truckPrice
            )} will be applied.`;
          } else {
            confirmationMsg += " Free delivery to this area.";
          }

          await sendWhatsAppMessage(phoneNumber, confirmationMsg);

          // Ask for Google Map location
          await customer.updateConversationState("checkout_map_location");
          await sendWhatsAppMessage(
            phoneNumber,
            "📍 Please provide your exact location using Google Maps link for precise delivery."
          );
        } else {
          // Invalid - show areas in selected regency again
          const areasDisplay = formatAreasInRegencyForDisplay(areasInSelectedRegency);
          await sendWhatsAppMessage(
            phoneNumber,
            `📍 *${selectedRegencyName}*\n\nPlease select a valid area (1-${areasInSelectedRegency.length}):\n\n${areasDisplay}`
          );
        }
        break;

      // UPDATED checkout_select_saved_address case
      case "checkout_select_saved_address":
        const addressIndex = parseInt(text) - 1;

        if (
          isNaN(addressIndex) ||
          addressIndex < 0 ||
          !customer.addresses ||
          addressIndex >= customer.addresses.length
        ) {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please select a valid address number from the list or type 0 to return to the main menu."
          );
          return;
        }

        const selectedAddress = customer.addresses[addressIndex];

        // Use the selected address details for delivery
        customer.cart.deliveryLocation =
          selectedAddress.area || "Not specified";

        // Add extra charges if area is "ubud"
        if (
          selectedAddress.area &&
          selectedAddress.area.toLowerCase() === "ubud"
        ) {
          customer.cart.deliveryCharge += 200000; // 200k for Ubud
          await sendWhatsAppMessage(
            phoneNumber,
            `Additional charge of ${formatRupiah(
              200000
            )} will be applied for delivery to Ubud.`
          );
        }

        // Store complete address details in cart
        customer.cart.deliveryAddress = {
          nickname: selectedAddress.nickname || "Saved Address",
          area: selectedAddress.area || "Not specified",
          fullAddress: selectedAddress.fullAddress || "",
          googleMapLink: selectedAddress.googleMapLink || "",
        };

        // Update order history if order exists
        const idx3 = customer.orderHistory.findIndex(
          (o) => o.orderId === customer.latestOrderId
        );
        if (idx3 >= 0) {
          customer.orderHistory[idx3].deliveryLocation =
            selectedAddress.area || "Not specified";
          customer.orderHistory[idx3].deliveryCharge =
            customer.cart.deliveryCharge;
          customer.orderHistory[idx3].deliveryAddress = {
            nickname: selectedAddress.nickname || "Saved Address",
            area: selectedAddress.area || "Not specified",
            fullAddress: selectedAddress.fullAddress || "",
            googleMapLink: selectedAddress.googleMapLink || "",
          };
        }

        await customer.save();

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Address selected: ${
            selectedAddress.nickname || "Saved Address"
          }\n` +
            `Area: ${selectedAddress.area || "Not specified"}\n` +
            `Delivery charge: ${formatRupiah(customer.cart.deliveryCharge)}`
        );

        // Proceed to order summary
        await customer.updateConversationState("checkout_summary");
        await sendOrderSummary(phoneNumber, customer);
        break;
      // UPDATED checkout_map_location case
      case "checkout_map_location":
        // Basic validation for Google Maps link
        if (
          !text.includes("maps.google") &&
          !text.includes("goo.gl") &&
          !text.startsWith("https://maps") &&
          !text.includes("maps.app.goo.gl")
        ) {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please send a valid Google Maps link. It should include 'maps.google' or 'goo.gl'."
          );
          return;
        }

        // Save Google Maps link
        customer.contextData.locationDetails = text;

        // Update cart delivery address
        if (!customer.cart.deliveryAddress) {
          customer.cart.deliveryAddress = {
            area: customer.cart.deliveryLocation || "",
          };
        }
        customer.cart.deliveryAddress.googleMapLink = text;

        // Update order history if order exists
        const idx2 = customer.orderHistory.findIndex(
          (o) => o.orderId === customer.latestOrderId
        );
        if (idx2 >= 0) {
          if (!customer.orderHistory[idx2].deliveryAddress) {
            customer.orderHistory[idx2].deliveryAddress = {
              area: customer.cart.deliveryLocation || "",
            };
          }
          customer.orderHistory[idx2].deliveryAddress.googleMapLink = text;
        }

        await customer.save();

        await sendWhatsAppMessage(
          phoneNumber,
          "✅ Location saved successfully!"
        );

        // Proceed to order summary
        await customer.updateConversationState("checkout_summary");
        await sendOrderSummary(phoneNumber, customer);
        break;

      case "checkout_summary":
        switch (text) {
          case "1": // Yes, proceed to payment
            // Move to payment receipt upload
            await customer.updateConversationState("checkout_wait_receipt");
            await sendSequentialMessages(
              phoneNumber,
              "💳 *Payment Information* 💳\n\n" +
                "Please transfer to this bank:\n" +
                "🏦 BCA\n" +
                "📋 Account #: 555XXX XXX\n" +
                "🔢 Bank Code: 14 XXX\n" +
                "⚠️ We don't accept international payments",

              "📸 Please send a screenshot of your payment transfer receipt to continue.",

              "💡 Make sure the *bank name*, *account holder*, and *amount paid* are clearly visible in the screenshot.",
              1000
            );
            break;

          case "2": // Modify cart
            await goToCart(phoneNumber, customer);
            break;

          case "3": // I'll pay later
            await sendWhatsAppMessage(
              phoneNumber,
              "⏰ No problem! Your cart is saved. You can return anytime to complete your order.\n\n" +
                "Just type *menu* when you're ready to proceed with payment."
            );
            await sendMainMenu(phoneNumber, customer);
            break;

          case "4": // Cancel and empty cart
            // Clear cart completely
            customer.cart = {
              items: [],
              totalAmount: 0,
              deliveryCharge: 0,
              deliveryType: "truck",
              deliverySpeed: "normal",
              deliveryOption: "Normal Delivery",
              deliveryLocation: "",
              deliveryTimeFrame: "",
              firstOrderDiscount: 0,
              ecoDeliveryDiscount: 0,
              deliveryAddress: {},
            };

            // Remove cart order from history
            customer.orderHistory = customer.orderHistory.filter(
              (o) => o.status !== "cart-not-paid"
            );

            customer.latestOrderId = null;
            customer.currentOrderStatus = "cart-not-paid";

            await customer.save();

            await sendWhatsAppMessage(
              phoneNumber,
              "🗑️ Cart emptied successfully. Returning to main menu."
            );
            await sendMainMenu(phoneNumber, customer);
            break;

          default:
            await sendWhatsAppMessage(
              phoneNumber,
              "Please select a valid option (1-4) or type 0 to return to main menu."
            );
            break;
        }
        break;

      case "checkout_wait_receipt": {
        if (!message.hasMedia || message.type !== "image") {
          await sendWhatsAppMessage(
            phoneNumber,
            "❗ Please send a screenshot of your payment receipt."
          );
          break;
        }

        await sendWhatsAppMessage(
          phoneNumber,
          "✅ Receipt received. Your payment will be confirmed..."
        );

        try {
          const imageBuffer = fs.readFileSync(message.localMediaPath);
          const base64Image = imageBuffer.toString("base64");

          let orderId = customer.contextData.latestOrderId;
          let order = null;
          let isShoppingHistory = false;

          if (!orderId && customer.shoppingHistory?.length > 0) {
            order =
              customer.shoppingHistory[customer.shoppingHistory.length - 1];
            orderId = order.orderId;
            isShoppingHistory = true;
          }

          if (!orderId && customer.orderHistory?.length > 0) {
            order = customer.orderHistory[customer.orderHistory.length - 1];
            orderId = order.orderId;
            isShoppingHistory = false;
          }

          if (!order) {
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Error: No order found. Please contact support."
            );
            break;
          }

          const orderIndex = isShoppingHistory
            ? customer.shoppingHistory.findIndex((o) => o.orderId === orderId)
            : customer.orderHistory.findIndex((o) => o.orderId === orderId);

          if (orderIndex >= 0) {
            if (isShoppingHistory) {
              customer.shoppingHistory[orderIndex].receiptImage = {
                data: base64Image,
                contentType: message.mediaInfo.mimetype,
              };
              customer.shoppingHistory[orderIndex].status = "pay-not-confirmed";
              customer.currentOrderStatus = "pay-not-confirmed";
            } else {
              customer.orderHistory[orderIndex].receiptImage = {
                data: base64Image,
                contentType: message.mediaInfo.mimetype,
              };
              customer.orderHistory[orderIndex].status = "pay-not-confirmed";
              customer.currentOrderStatus = "pay-not-confirmed";
            }

            // ✅ MARK FIRST ORDER DISCOUNT AS USED (ONLY AFTER PAYMENT)
            if (customer.isFirstTimeCustomer) {
              customer.isFirstTimeCustomer = false;
              customer.firstOrderDiscountApplied = true; // THIS IS THE KEY LINE
              console.log(
                `✅ First order discount confirmed for: ${customer.phoneNumber[0]}`
              );
            }

            // Clear cart after payment
            customer.cart = {
              items: [],
              totalAmount: 0,
              deliveryCharge: 0,
              deliveryType: "truck",
              deliverySpeed: "normal",
              deliveryOption: "Normal Delivery",
              deliveryLocation: "",
              deliveryTimeFrame: "",
              firstOrderDiscount: 0,
              ecoDeliveryDiscount: 0,
              deliveryAddress: {},
            };

            customer.latestOrderId = null;
            await customer.save();

            console.log(`✅ Receipt saved for order: ${orderId}`);
          }

          // Continue with name/bank collection as before...
          if (customer.bankAccounts?.length) {
            await customer.updateConversationState(
              "checkout_select_saved_bank"
            );
            let msg = "*🏦 Select your saved bank account for payment:*\n\n";
            customer.bankAccounts.forEach((b, i) => {
              msg += `${i + 1}. ${
                b.bankName
              } - Account: ${b.accountNumber.slice(0, 4)}xxxx\n`;
            });
            await sendWhatsAppMessage(phoneNumber, msg);
          } else {
            await customer.updateConversationState("checkout_enter_name");
            await sendWhatsAppMessage(
              phoneNumber,
              "👤 What is the full name of the account you are paying from?"
            );
          }
        } catch (error) {
          console.error("Error processing payment receipt:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Error: Unable to process your receipt. Please try again or contact support."
          );
        }
        break;
      }

      // ─── CASE: checkout_select_saved_bank ──────────────────────────
      case "checkout_select_saved_bank":
        {
          const selectedIdx = parseInt(text.trim(), 10) - 1;

          if (
            !isNaN(selectedIdx) &&
            selectedIdx >= 0 &&
            selectedIdx < customer.bankAccounts.length
          ) {
            const selected = customer.bankAccounts[selectedIdx];

            // Save into contextData
            customer.contextData.accountHolderName = selected.accountHolderName;
            customer.contextData.bankName = selected.bankName;

            // Verify we have a valid order ID to update
            if (!customer.contextData.latestOrderId) {
              console.error("No latestOrderId found when selecting saved bank");

              // Try to find the latest order from orderHistory
              if (customer.orderHistory.length > 0) {
                const recentOrders = [...customer.orderHistory].sort(
                  (a, b) => new Date(b.orderDate) - new Date(a.orderDate)
                );

                if (recentOrders.length > 0) {
                  customer.contextData.latestOrderId = recentOrders[0].orderId;
                  customer.latestOrderId = recentOrders[0].orderId;
                  console.log(
                    `Found and using latest order: ${customer.contextData.latestOrderId}`
                  );
                }
              }
            }

            // Save the account holder name and bank name to the orderHistory entry
            const idx = customer.orderHistory.findIndex(
              (o) => o.orderId === customer.contextData.latestOrderId
            );
            if (idx >= 0) {
              customer.orderHistory[idx].accountHolderName =
                selected.accountHolderName;
              customer.orderHistory[idx].paidBankName = selected.bankName;

              // Add to tracking arrays for future reference
              if (!customer.payerNames.includes(selected.accountHolderName)) {
                customer.payerNames.push(selected.accountHolderName);
              }
              if (!customer.bankNames.includes(selected.bankName)) {
                customer.bankNames.push(selected.bankName);
              }
            } else {
              console.error(
                `Order not found in checkout_select_saved_bank: ${customer.contextData.latestOrderId}`
              );
              // Create a new order if no order exists
              if (customer.cart.items && customer.cart.items.length > 0) {
                console.log("Creating new order with selected bank details");
                const newOrderId = await customer.createOrder();
                customer.contextData.latestOrderId = newOrderId;
                customer.latestOrderId = newOrderId;

                // Now update the new order with the bank details
                const newIdx = customer.orderHistory.findIndex(
                  (o) => o.orderId === newOrderId
                );
                if (newIdx >= 0) {
                  customer.orderHistory[newIdx].accountHolderName =
                    selected.accountHolderName;
                  customer.orderHistory[newIdx].paidBankName =
                    selected.bankName;
                }
              }
            }

            await customer.save();

            await sendWhatsAppMessage(
              phoneNumber,
              `✅ Selected: ${selected.bankName} - (${selected.accountHolderName})\n\n🛒 Processing your order...`
            );

            // Now proceed to confirmation
            await customer.updateConversationState("order_confirmation");
            await processChatMessage(phoneNumber, "order_confirmation");
          } else if (text.trim() === `${customer.bankAccounts.length + 1}`) {
            await customer.updateConversationState("checkout_enter_name");
            await sendWhatsAppMessage(
              phoneNumber,
              "👤 What is the full name of the account you are paying from?"
            );
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Invalid selection. Please choose a valid option."
            );
          }
        }
        break;

      // ─── CASE: checkout_enter_name ────────────────────────────────
      // ─── CASE: checkout_enter_name ────────────────────────────────
      case "checkout_enter_name":
        {
          const name = text.trim();
          customer.contextData.accountHolderName = name;

          // First check if we have a valid latestOrderId
          if (
            !customer.contextData.latestOrderId &&
            customer.orderHistory.length > 0
          ) {
            // Try to find the most recent order
            const recentOrders = [...customer.orderHistory].sort(
              (a, b) => new Date(b.orderDate) - new Date(a.orderDate)
            );

            if (recentOrders.length > 0) {
              customer.contextData.latestOrderId = recentOrders[0].orderId;
              customer.latestOrderId = recentOrders[0].orderId; // Update top-level field too
              console.log(
                `Found most recent order for name update: ${customer.contextData.latestOrderId}`
              );
            }
          }

          // Now find the order with the ID
          const idx = customer.orderHistory.findIndex(
            (o) => o.orderId === customer.contextData.latestOrderId
          );

          if (idx >= 0) {
            // Save the account holder name to the orderHistory entry
            customer.orderHistory[idx].accountHolderName = name;

            // Track this name for future reference
            if (!customer.payerNames.includes(name)) {
              customer.payerNames.push(name);
            }

            await customer.save();
            console.log(
              `Successfully saved account holder name "${name}" to order: ${customer.contextData.latestOrderId}`
            );

            // Proceed to bank selection
            await customer.updateConversationState("checkout_enter_bank");

            // prompt bank list
            const formattedBankList = `*Select a bank:*
--------------------------------
1 - Other (enter manually)
--------------------------------
2 - Bank Rakyat Indonesia (BRI)
3 - Bank Ekspor Indonesia
8 - Bank Mandiri
9 - Bank Negara Indonesia (BNI)
11 - Bank Danamon Indonesia
13 - Bank Permata
14 - Bank Central Asia (BCA)
16 - Bank Maybank
19 - Bank Panin
20 - Bank Arta Niaga Kencana
22 - Bank CIMB Niaga
23 - Bank UOB Indonesia
26 - Bank Lippo
28 - Bank OCBC NISP
30 - American Express Bank LTD
31 - Citibank
32 - JP. Morgan Chase Bank, N.A
33 - Bank of America, N.A
36 - Bank Multicor
37 - Bank Artha Graha
47 - Bank Pesona Perdania
52 - Bank ABN Amro
53 - Bank Keppel Tatlee Buana
57 - Bank BNP Paribas Indonesia
68 - Bank Woori Indonesia
76 - Bank Bumi Arta
87 - Bank Ekonomi
89 - Bank Haga
93 - Bank IFI
95 - Bank Century / Bank J Trust Indonesia
97 - Bank Mayapada
110 - Bank BJB
111 - Bank DKI
112 - Bank BPD D.I.Y
113 - Bank Jateng
114 - Bank Jatim
115 - Bank Jambi
116 - Bank Aceh
117 - Bank Sumut
118 - Bank Sumbar
119 - Bank Kepri
120 - Bank Sumsel dan Babel
121 - Bank Lampung
122 - Bank Kalsel
123 - Bank Kalbar
124 - Bank Kaltim
125 - Bank Kalteng
126 - Bank Sulsel
127 - Bank Sulut
128 - Bank NTB
129 - Bank Bali
130 - Bank NTT
131 - Bank Maluku
132 - Bank Papua
133 - Bank Bengkulu
134 - Bank Sulteng
135 - Bank Sultra
137 - Bank Banten
145 - Bank Nusantara Parahyangan
146 - Bank Swadesi
147 - Bank Muamalat
151 - Bank Mestika
152 - Bank Metro Express
157 - Bank Maspion
159 - Bank Hagakita
161 - Bank Ganesha
162 - Bank Windu Kentjana
164 - Bank ICBC Indonesia
166 - Bank Harmoni Internasional
167 - Bank QNB
200 - Bank Tabungan Negara (BTN)
405 - Bank Swaguna
425 - Bank BJB Syariah
426 - Bank Mega
441 - Bank Bukopin
451 - Bank Syariah Indonesia (BSI)
459 - Bank Bisnis Internasional
466 - Bank Sri Partha
484 - Bank KEB Hana Indonesia
485 - Bank MNC Internasional
490 - Bank Neo
494 - Bank BNI Agro
503 - Bank Nobu
506 - Bank Mega Syariah
513 - Bank Ina Perdana
517 - Bank Panin Dubai Syariah
521 - Bank Bukopin Syariah
523 - Bank Sahabat Sampoerna
535 - SeaBank
536 - Bank BCA Syariah
542 - Bank Jago
547 - Bank BTPN Syariah
553 - Bank Mayora
555 - Bank Index Selindo
947 - Bank Aladin Syariah`;

            await sendWhatsAppMessage(phoneNumber, formattedBankList);
          } else {
            console.error(
              `No valid order found when trying to save account holder name.`
            );

            // Create new order if none exists
            if (customer.cart.items && customer.cart.items.length > 0) {
              console.log("Creating new order to save account holder name");
              const newOrderId = await customer.createOrder();
              customer.contextData.latestOrderId = newOrderId;
              customer.latestOrderId = newOrderId;

              // Find the new order index
              const newIdx = customer.orderHistory.findIndex(
                (o) => o.orderId === newOrderId
              );
              if (newIdx >= 0) {
                // Save the account holder name
                customer.orderHistory[newIdx].accountHolderName = name;

                // Track this name for future reference
                if (!customer.payerNames.includes(name)) {
                  customer.payerNames.push(name);
                }

                await customer.save();
                console.log(
                  `Created new order ${newOrderId} and saved account holder name "${name}"`
                );

                // Proceed to bank selection
                await customer.updateConversationState("checkout_enter_bank");
                await sendWhatsAppMessage(phoneNumber, formattedBankList);
              } else {
                throw new Error(
                  `Failed to find newly created order ${newOrderId}`
                );
              }
            } else {
              await sendWhatsAppMessage(
                phoneNumber,
                "❌ Your cart is empty. Please add items to your cart before checkout."
              );
              await customer.updateConversationState("main_menu");
              await processChatMessage(phoneNumber, "main_menu");
            }
          }
        }
        break;

      // ─── CASE: checkout_enter_bank ─────────────────────────────────
      case "checkout_enter_bank":
        {
          const checkoutBankOptions = {
            1: "Other (enter manually)",
            2: "Bank Rakyat Indonesia (BRI)",
            3: "Bank Ekspor Indonesia",
            8: "Bank Mandiri",
            9: "Bank Negara Indonesia (BNI)",
            11: "Bank Danamon Indonesia",
            13: "Bank Permata",
            14: "Bank Central Asia (BCA)",
            16: "Bank Maybank",
            19: "Bank Panin",
            20: "Bank Arta Niaga Kencana",
            22: "Bank CIMB Niaga",
            23: "Bank UOB Indonesia",
            26: "Bank Lippo",
            28: "Bank OCBC NISP",
            30: "American Express Bank LTD",
            31: "Citibank",
            32: "JP. Morgan Chase Bank, N.A",
            33: "Bank of America, N.A",
            36: "Bank Multicor",
            37: "Bank Artha Graha",
            47: "Bank Pesona Perdania",
            52: "Bank ABN Amro",
            53: "Bank Keppel Tatlee Buana",
            57: "Bank BNP Paribas Indonesia",
            68: "Bank Woori Indonesia",
            76: "Bank Bumi Arta",
            87: "Bank Ekonomi",
            89: "Bank Haga",
            93: "Bank IFI",
            95: "Bank Century / Bank J Trust Indonesia",
            97: "Bank Mayapada",
            110: "Bank BJB",
            111: "Bank DKI",
            112: "Bank BPD D.I.Y",
            113: "Bank Jateng",
            114: "Bank Jatim",
            115: "Bank Jambi",
            116: "Bank Aceh",
            117: "Bank Sumut",
            118: "Bank Sumbar",
            119: "Bank Kepri",
            120: "Bank Sumsel dan Babel",
            121: "Bank Lampung",
            122: "Bank Kalsel",
            123: "Bank Kalbar",
            124: "Bank Kaltim",
            125: "Bank Kalteng",
            126: "Bank Sulsel",
            127: "Bank Sulut",
            128: "Bank NTB",
            129: "Bank Bali",
            130: "Bank NTT",
            131: "Bank Maluku",
            132: "Bank Papua",
            133: "Bank Bengkulu",
            134: "Bank Sulteng",
            135: "Bank Sultra",
            137: "Bank Banten",
            145: "Bank Nusantara Parahyangan",
            146: "Bank Swadesi",
            147: "Bank Muamalat",
            151: "Bank Mestika",
            152: "Bank Metro Express",
            157: "Bank Maspion",
            159: "Bank Hagakita",
            161: "Bank Ganesha",
            162: "Bank Windu Kentjana",
            164: "Bank ICBC Indonesia",
            166: "Bank Harmoni Internasional",
            167: "Bank QNB",
            200: "Bank Tabungan Negara (BTN)",
            405: "Bank Swaguna",
            425: "Bank BJB Syariah",
            426: "Bank Mega",
            441: "Bank Bukopin",
            451: "Bank Syariah Indonesia (BSI)",
            459: "Bank Bisnis Internasional",
            466: "Bank Sri Partha",
            484: "Bank KEB Hana Indonesia",
            485: "Bank MNC Internasional",
            490: "Bank Neo",
            494: "Bank BNI Agro",
            503: "Bank Nobu",
            506: "Bank Mega Syariah",
            513: "Bank Ina Perdana",
            517: "Bank Panin Dubai Syariah",
            521: "Bank Bukopin Syariah",
            523: "Bank Sahabat Sampoerna",
            535: "SeaBank",
            536: "Bank BCA Syariah",
            542: "Bank Jago",
            547: "Bank BTPN Syariah",
            553: "Bank Mayora",
            555: "Bank Index Selindo",
            947: "Bank Aladin Syariah",
          };

          const choice = text.trim();
          const chosenBankName = checkoutBankOptions[choice];

          if (!chosenBankName) {
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Invalid input. Please enter a valid bank number from the list."
            );
            break;
          }

          if (choice === "1") {
            // manual‐entry path
            await customer.updateConversationState(
              "checkout_enter_bank_manual"
            );
            await sendWhatsAppMessage(
              phoneNumber,
              "Please enter the name of your bank:"
            );
            break;
          }

          // Verify we have a valid order ID before proceeding
          if (
            !customer.contextData.latestOrderId &&
            customer.orderHistory.length > 0
          ) {
            // Try to find the most recent order
            const recentOrders = [...customer.orderHistory].sort(
              (a, b) => new Date(b.orderDate) - new Date(a.orderDate)
            );

            if (recentOrders.length > 0) {
              customer.contextData.latestOrderId = recentOrders[0].orderId;
              customer.latestOrderId = recentOrders[0].orderId; // Update top-level field too
              console.log(
                `Found most recent order for bank selection: ${customer.contextData.latestOrderId}`
              );
            }
          }

          // save into contextData
          customer.contextData.bankName = chosenBankName;

          // also persist onto the orderHistory entry
          const idx2 = customer.orderHistory.findIndex(
            (o) => o.orderId === customer.contextData.latestOrderId
          );

          if (idx2 >= 0) {
            customer.orderHistory[idx2].paidBankName = chosenBankName;

            // Track this bank for future reference
            if (!customer.bankNames.includes(chosenBankName)) {
              customer.bankNames.push(chosenBankName);
            }

            await customer.save();
            console.log(
              `Successfully saved bank "${chosenBankName}" to order: ${customer.contextData.latestOrderId}`
            );

            await sendWhatsAppMessage(
              phoneNumber,
              `✅ Selected Bank: ${chosenBankName}\n🛒 Processing your order...`
            );

            await customer.updateConversationState("order_confirmation");
            return processChatMessage(
              phoneNumber,
              "order_confirmation",
              message
            );
          } else {
            console.error(
              `Order not found when selecting bank: ${customer.contextData.latestOrderId}`
            );

            // Create a new order if no order exists
            if (customer.cart.items && customer.cart.items.length > 0) {
              console.log("Creating new order for bank selection");
              const newOrderId = await customer.createOrder();
              customer.contextData.latestOrderId = newOrderId;
              customer.latestOrderId = newOrderId;

              // Now update the new order with the bank details
              const newIdx = customer.orderHistory.findIndex(
                (o) => o.orderId === newOrderId
              );

              if (newIdx >= 0) {
                // Use the previously stored account holder name if available
                if (customer.contextData.accountHolderName) {
                  customer.orderHistory[newIdx].accountHolderName =
                    customer.contextData.accountHolderName;
                }

                customer.orderHistory[newIdx].paidBankName = chosenBankName;

                // Track this bank for future reference
                if (!customer.bankNames.includes(chosenBankName)) {
                  customer.bankNames.push(chosenBankName);
                }

                await customer.save();
                console.log(
                  `Created new order ${newOrderId} and saved bank "${chosenBankName}"`
                );

                await sendWhatsAppMessage(
                  phoneNumber,
                  `✅ Selected Bank: ${chosenBankName}\n🛒 Processing your order...`
                );

                await customer.updateConversationState("order_confirmation");
                return processChatMessage(
                  phoneNumber,
                  "order_confirmation",
                  message
                );
              } else {
                throw new Error(
                  `Failed to find newly created order ${newOrderId}`
                );
              }
            } else {
              await sendWhatsAppMessage(
                phoneNumber,
                "❌ Your cart is empty. Please add items to your cart before checkout."
              );
              await customer.updateConversationState("main_menu");
              await processChatMessage(phoneNumber, "main_menu");
            }
          }
        }
        break;

      // ─── CASE: checkout_enter_bank_manual ──────────────────────────
      case "checkout_enter_bank_manual":
        {
          const manualBankName = text.trim();

          // Verify we have a valid order ID before proceeding
          if (
            !customer.contextData.latestOrderId &&
            customer.orderHistory.length > 0
          ) {
            // Try to find the most recent order
            const recentOrders = [...customer.orderHistory].sort(
              (a, b) => new Date(b.orderDate) - new Date(a.orderDate)
            );

            if (recentOrders.length > 0) {
              customer.contextData.latestOrderId = recentOrders[0].orderId;
              customer.latestOrderId = recentOrders[0].orderId; // Update top-level field too
              console.log(
                `Found most recent order for manual bank entry: ${customer.contextData.latestOrderId}`
              );
            }
          }

          // Save into contextData
          customer.contextData.bankName = manualBankName;

          // Find the order to update
          const idx3 = customer.orderHistory.findIndex(
            (o) => o.orderId === customer.contextData.latestOrderId
          );

          if (idx3 >= 0) {
            customer.orderHistory[idx3].paidBankName = manualBankName;

            // Track this bank for future reference
            if (!customer.bankNames.includes(manualBankName)) {
              customer.bankNames.push(manualBankName);
            }

            await customer.save();
            console.log(
              `Successfully saved manual bank "${manualBankName}" to order: ${customer.contextData.latestOrderId}`
            );

            await sendWhatsAppMessage(
              phoneNumber,
              `✅ Bank: ${manualBankName}\n🛒 Processing your order...`
            );

            await customer.updateConversationState("order_confirmation");
            return processChatMessage(phoneNumber, "order_confirmation");
          } else {
            console.error(
              `Order not found when entering manual bank: ${customer.contextData.latestOrderId}`
            );

            // Create a new order if no order exists
            if (customer.cart.items && customer.cart.items.length > 0) {
              console.log("Creating new order for manual bank entry");
              const newOrderId = await customer.createOrder();
              customer.contextData.latestOrderId = newOrderId;
              customer.latestOrderId = newOrderId;

              // Now update the new order with the bank details
              const newIdx = customer.orderHistory.findIndex(
                (o) => o.orderId === newOrderId
              );

              if (newIdx >= 0) {
                // Use the previously stored account holder name if available
                if (customer.contextData.accountHolderName) {
                  customer.orderHistory[newIdx].accountHolderName =
                    customer.contextData.accountHolderName;
                }

                customer.orderHistory[newIdx].paidBankName = manualBankName;

                // Track this bank for future reference
                if (!customer.bankNames.includes(manualBankName)) {
                  customer.bankNames.push(manualBankName);
                }

                await customer.save();
                console.log(
                  `Created new order ${newOrderId} and saved manual bank "${manualBankName}"`
                );

                await sendWhatsAppMessage(
                  phoneNumber,
                  `✅ Bank: ${manualBankName}\n🛒 Processing your order...`
                );

                await customer.updateConversationState("order_confirmation");
                return processChatMessage(phoneNumber, "order_confirmation");
              } else {
                throw new Error(
                  `Failed to find newly created order ${newOrderId}`
                );
              }
            } else {
              await sendWhatsAppMessage(
                phoneNumber,
                "❌ Your cart is empty. Please add items to your cart before checkout."
              );
              await customer.updateConversationState("main_menu");
              await processChatMessage(phoneNumber, "main_menu");
            }
          }
        }
        break;

        // Enhanced Support System Case Handlers for processChatMessage function

        // Helper function to process UltraMsg media
        async function processUltraMsgMedia(
          mediaId,
          mediaType,
          mimetype,
          caption
        ) {
          try {
            // Get media from UltraMsg
            const mediaResponse = await fetch(
              `https://api.ultramsg.com/instance${INSTANCE_ID}/media/download`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  token: ULTRAMSG_TOKEN,
                  id: mediaId,
                }),
              }
            );

            if (mediaResponse.ok) {
              const mediaBuffer = await mediaResponse.buffer();
              const base64Data = mediaBuffer.toString("base64");

              return {
                mediaId: mediaId,
                mediaType: mediaType,
                mimetype: mimetype,
                caption: caption || "",
                base64Data: base64Data,
                fileSize: Math.round(mediaBuffer.length / 1024), // Size in KB
                uploadedAt: new Date(),
              };
            }
          } catch (error) {
            console.error("Error processing media:", error);
          }
          return null;
        }

        // Enhanced formatOrderList function with delivery area, delivery date, and Google Maps link
        function formatOrderList(orderHistory, customer) {
          if (!orderHistory || orderHistory.length === 0) {
            return "No orders found.";
          }

          return orderHistory
            .sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate))
            .map((order, index) => {
              // Format status with more readable names
              const status = getReadableStatus(order.status);

              // Format order date
              const orderDate = new Date(order.orderDate);
              const formattedOrderDate = orderDate.toLocaleDateString("en-GB"); // DD/MM/YYYY format
              const formattedOrderTime = orderDate.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              });

              // Format delivery date with fallback
              let deliveryDateInfo = "Not specified";
              if (order.deliveryDate) {
                const deliveryDate = new Date(order.deliveryDate);
                deliveryDateInfo = deliveryDate.toLocaleDateString("en-GB");
              } else if (order.deliveryTimeFrame) {
                // If no specific date, show the time frame
                deliveryDateInfo = `Expected: ${order.deliveryTimeFrame}`;
              }

              // Get delivery area with multiple fallbacks
              let deliveryArea = "Area not specified";
              if (order.deliveryAddress?.area) {
                deliveryArea = order.deliveryAddress.area;
              } else if (order.deliveryLocation) {
                deliveryArea = order.deliveryLocation;
              }

              // Capitalize first letter of area
              deliveryArea =
                deliveryArea.charAt(0).toUpperCase() + deliveryArea.slice(1);

              // Get full delivery address
              let deliveryAddress = "Address not provided";
              if (order.deliveryAddress?.fullAddress) {
                deliveryAddress = order.deliveryAddress.fullAddress;
              } else if (order.deliveryLocation) {
                deliveryAddress = order.deliveryLocation;
              }

              // Truncate long addresses for display
              if (deliveryAddress.length > 60) {
                deliveryAddress = deliveryAddress.substring(0, 60) + "...";
              }

              // Get Google Maps link with multiple fallbacks
              let googleMapLink = "";
              if (order.deliveryAddress?.googleMapLink) {
                googleMapLink = order.deliveryAddress.googleMapLink;
              } else if (customer?.contextData?.locationDetails) {
                googleMapLink = customer.contextData.locationDetails;
              }

              // Build the order information string
              let orderInfo =
                `${index + 1}. Order #${order.orderId}\n` +
                `   📊 Status: ${status}\n` +
                `   💰 Amount: Rp ${Math.round(
                  order.totalAmount
                ).toLocaleString("id-ID")}\n` +
                `   📅 Order Date: ${formattedOrderDate} at ${formattedOrderTime}\n` +
                `   🚚 Delivery: ${
                  order.deliveryOption || order.deliveryType || "Standard"
                }\n` +
                `   ⏰ Delivery Date: ${deliveryDateInfo}\n` +
                `   🌍 Area: ${deliveryArea}`;

              // Add full address if different from area
              if (
                deliveryAddress !== deliveryArea &&
                deliveryAddress !== "Address not provided"
              ) {
                orderInfo += `\n   📍 Address: ${deliveryAddress}`;
              }

              // Always add Google Maps link if available
              if (googleMapLink) {
                orderInfo += `\n   🗺️ Location: ${googleMapLink}`;
              }

              // Add delivery time frame if available and different from delivery date
              if (order.deliveryTimeFrame && !order.deliveryDate) {
                orderInfo += `\n   ⏱️ Timeframe: ${order.deliveryTimeFrame}`;
              }

              // Add delivery type details if available
              if (order.deliveryType && order.deliverySpeed) {
                const deliveryDetails = getDeliveryTypeDetails(
                  order.deliveryType,
                  order.deliverySpeed
                );
                if (deliveryDetails) {
                  orderInfo += `\n   🚛 Type: ${deliveryDetails}`;
                }
              }

              return orderInfo;
            })
            .join("\n\n" + "─".repeat(40) + "\n\n");
        }

        // Helper function to get readable status names
        function getReadableStatus(status) {
          const statusMap = {
            "cart-not-paid": "🛒 Cart (Not Paid)",
            "order-made-not-paid": "📝 Order Created (Awaiting Payment)",
            "pay-not-confirmed": "💳 Payment Submitted (Pending Confirmation)",
            "order-confirmed": "✅ Order Confirmed",
            "order not picked": "📦 Ready for Pickup",
            "issue-customer": "⚠️ Customer Issue",
            "customer-confirmed": "👤 Customer Confirmed",
            "order-refunded": "💸 Refunded",
            "picking-order": "🔄 Preparing Order",
            "allocated-driver": "🚚 Driver Assigned",
            "ready to pickup": "📦 Ready for Pickup",
            "order-not-pickedup": "❌ Not Picked Up",
            "order-pickuped-up": "✅ Picked Up",
            "on-way": "🚛 On the Way",
            "driver-confirmed": "✅ Driver Confirmed",
            "order-processed": "⚙️ Processing",
            refund: "💸 Refund",
            "complain-order": "⚠️ Complaint Filed",
            "issue-driver": "⚠️ Driver Issue",
            "parcel-returned": "↩️ Returned",
            "order-complete": "🎉 Delivered",
          };

          return statusMap[status] || status || "Unknown Status";
        }

        // Helper function to get delivery type details
        function getDeliveryTypeDetails(deliveryType, deliverySpeed) {
          const typeSpeedMap = {
            "truck-normal": "Truck - Normal Delivery",
            "truck-speed": "Truck - Speed Delivery",
            "truck-early_morning": "Truck - Early Morning",
            "truck-eco": "Truck - Eco Delivery (Discount Applied)",
            "scooter-normal": "Scooter - Standard",
            "scooter-speed": "Scooter - Express",
            "self_pickup-normal": "Self Pickup",
          };

          const key = `${deliveryType}-${deliverySpeed}`;
          return typeSpeedMap[key] || `${deliveryType} - ${deliverySpeed}`;
        }

        // Alternative compact version for mobile-friendly display
        function formatOrderListCompact(orderHistory, customer) {
          if (!orderHistory || orderHistory.length === 0) {
            return "No orders found.";
          }

          return orderHistory
            .sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate))
            .map((order, index) => {
              const status = getReadableStatus(order.status);
              const orderDate = new Date(order.orderDate).toLocaleDateString(
                "en-GB"
              );

              // Get delivery area
              const deliveryArea =
                order.deliveryAddress?.area ||
                order.deliveryLocation ||
                "Area not specified";

              // Get delivery date or timeframe
              let deliveryInfo = "TBD";
              if (order.deliveryDate) {
                deliveryInfo = new Date(order.deliveryDate).toLocaleDateString(
                  "en-GB"
                );
              } else if (order.deliveryTimeFrame) {
                deliveryInfo = order.deliveryTimeFrame;
              }

              // Get Google Maps link
              const googleMapLink =
                order.deliveryAddress?.googleMapLink ||
                customer?.contextData?.locationDetails ||
                "";

              return (
                `${index + 1}. #${order.orderId} - ${status}\n` +
                `   💰 Rp ${Math.round(order.totalAmount).toLocaleString(
                  "id-ID"
                )}\n` +
                `   📅 ${orderDate} → 🚚 ${deliveryInfo}\n` +
                `   🌍 ${
                  deliveryArea.charAt(0).toUpperCase() + deliveryArea.slice(1)
                }` +
                (googleMapLink ? `\n   🗺️ ${googleMapLink}` : "")
              );
            })
            .join("\n\n");
        }
      case "support":
        // Main support menu
        switch (text) {
          case "1":
            // Delivery & Product Issues
            await customer.updateSupportFlow({
              mainCategory: "delivery_product",
              currentStep: "category_selection",
            });
            await customer.updateConversationState("delivery_product_issues");
            await sendWhatsAppMessage(
              phoneNumber,
              "🚚 *Delivery & Product Issues*\n\n" +
                "Please choose:\n\n" +
                "1️⃣ Delivery Issue\n" +
                "2️⃣ Product Issue\n\n" +
                "Type the number to continue."
            );
            break;

          case "2":
            // Check My Delivery
            await customer.updateSupportFlow({
              mainCategory: "check_delivery",
              currentStep: "order_id_input",
            });
            await customer.updateConversationState("check_delivery");
            await sendWhatsAppMessage(
              phoneNumber,
              "📦 *Check My Delivery*\n\n" +
                "Here are your orders:\n\n" +
                formatOrderList(customer.orderHistory) +
                "\n\nPlease type your Order ID:"
            );
            break;

          case "3":
            // Payment Problems
            await customer.updateSupportFlow({
              mainCategory: "payment_problems",
              currentStep: "problem_selection",
            });
            await customer.updateConversationState("payment_problems");
            await sendWhatsAppMessage(
              phoneNumber,
              "💳 *Payment Problems*\n\n" +
                "Please choose:\n\n" +
                "1. I paid, but got no confirmation\n" +
                "2. Payment failed\n" +
                "3. Paid under a different name\n" +
                "4. I was charged twice\n" +
                "5. Unsure if payment went through\n" +
                "6. Want to use credited funds\n\n" +
                "Type the number to continue."
            );
            break;

          case "4":
            // Speak to an Agent
            await customer.updateSupportFlow({
              mainCategory: "speak_agent",
              currentStep: "agent_request",
            });
            await customer.updateConversationState("speak_agent");
            await sendWhatsAppMessage(
              phoneNumber,
              "👨‍💼 *Speak to an Agent*\n\n" +
                "Call us at: +62-XXX-XXXX-XXXX\n\n" +
                "📝 *Note:* We do not take orders by phone.\n\n" +
                "To speak about:\n" +
                "• Order issues – go to your order and raise a support ticket\n" +
                '• Payment issues – choose "Payment Problems" above\n\n' +
                "Is there anything specific you'd like assistance with? Please describe your issue:"
            );
            break;

          case "5":
            // Submit a Complaint
            await customer.updateSupportFlow({
              mainCategory: "submit_complaint",
              currentStep: "media_upload",
              mediaExpected: true,
            });
            await customer.updateConversationState("submit_complaint");
            await sendWhatsAppMessage(
              phoneNumber,
              "📝 *Submit a Complaint*\n\n" +
                "Please attach a video or voice note to submit your complaint.\n\n" +
                "We'll need this media first, then ask for additional details.\n\n" +
                "----------------------------------\n\n" +
                "If the video is large, please allow a little extra time for it to load or upload. Thank you for your patience!\n\n" +
                `Don’t worry, it’s uploading — please wait up to 3 minutes`
            );
            break;

          case "6":
            // FAQs
            await customer.updateConversationState("faqs");
            await sendWhatsAppMessage(
              phoneNumber,
              "❓ *Frequently Asked Questions*\n\n" +
                "*Can I order via WhatsApp?*\n" +
                "Yes! Just message us here and follow the steps.\n\n" +
                "*Do you offer COD?*\n" +
                "No, we only accept bank transfers and payment links.\n\n" +
                "*Can I track my order?*\n" +
                "Yes! After your order, we'll keep you updated on dispatch & delivery.\n\n" +
                "*Can I change/cancel my order?*\n" +
                "Only possible within 12 hours or before dispatch. Refunds are via bank transfer (5–10 days).\n\n" +
                "*Where do you deliver?*\n" +
                "We deliver all over Bali. Confirm your location with us.\n\n" +
                "*What materials can I order?*\n" +
                "Cement, Bricks, Sand, Steel, Tiles, Paint, Plumbing, Electrical, and more!\n\n" +
                "*Do I need to register?*\n" +
                "No need to sign up. Just chat, send your details, and start ordering!\n\n" +
                "Type 0 to return to main menu."
            );
            break;

          default:
            await sendWhatsAppMessage(
              phoneNumber,
              "Please select a valid option (1-6) or type 0 to return to main menu."
            );
            break;
        }
        break;

      case "delivery_product_issues":
        switch (text) {
          case "1":
            // Delivery Issue selected
            await customer.updateSupportFlow({
              subCategory: "delivery_issue",
              currentStep: "delivery_option_selection",
            });
            await customer.updateConversationState("delivery_issue_menu");
            await sendWhatsAppMessage(
              phoneNumber,
              "🚚 *Delivery Issue*\n\n" +
                "Please choose:\n\n" +
                "1. Track my order\n" +
                "2. My delivery is delayed\n" +
                "3. Change delivery address\n" +
                "4. The driver couldn't find my location\n" +
                "5. Marked delivered but not received\n" +
                "6. Reschedule my delivery\n\n" +
                "Type the number to continue."
            );
            break;

          case "2":
            // Product Issue selected
            await customer.updateSupportFlow({
              subCategory: "product_issue",
              currentStep: "product_option_selection",
            });
            await customer.updateConversationState("product_issue_menu");
            await sendWhatsAppMessage(
              phoneNumber,
              "📦 *Product Issue*\n\n" +
                "Please choose:\n\n" +
                "1. Broken item\n" +
                "2. Missing or wrong amount\n" +
                "3. Received the wrong item\n" +
                "4. Other\n\n" +
                "Type the number to continue."
            );
            break;

          default:
            await sendWhatsAppMessage(
              phoneNumber,
              "Please select option 1 for Delivery Issue or 2 for Product Issue."
            );
            break;
        }
        break;

      case "delivery_issue_menu":
        const deliveryIssueTypes = {
          1: "track_order",
          2: "delivery_delayed",
          3: "change_delivery_address",
          4: "driver_location_issue",
          5: "marked_delivered_not_received",
          6: "reschedule_delivery",
        };

        const selectedDeliveryIssue = deliveryIssueTypes[text];

        if (selectedDeliveryIssue) {
          await customer.updateSupportFlow({
            specificIssue: selectedDeliveryIssue,
            currentStep: "order_id_input",
          });

          switch (selectedDeliveryIssue) {
            case "track_order":
              await customer.updateConversationState("track_order_delivery");
              await sendWhatsAppMessage(
                phoneNumber,
                "📍 *Track My Order*\n\n" +
                  "Here are your orders:\n\n" +
                  formatOrderList(customer.orderHistory) +
                  "\n\nPlease type your Order ID or select by number (1, 2, 3...):"
              );
              break;

            case "delivery_delayed":
              await customer.updateConversationState("delivery_delayed");
              await sendWhatsAppMessage(
                phoneNumber,
                "⏰ *Delivery Delayed*\n\n" +
                  "Sorry for the delay! 😔\n\n" +
                  "Here are your orders:\n\n" +
                  formatOrderList(customer.orderHistory) +
                  "\n\nPlease send your Order ID so we can check:"
              );
              break;

            case "change_delivery_address":
              await customer.updateConversationState("change_delivery_address");
              await sendWhatsAppMessage(
                phoneNumber,
                "📍 *Change Delivery Address*\n\n" +
                  "You want to change the delivery address.\n\n" +
                  "⚠️ *Note:* If your order hasn't been dispatched, we can update it.\n" +
                  "If the order has already left, extra delivery costs may apply.\n\n" +
                  "Here are your orders:\n\n" +
                  formatOrderList(customer.orderHistory) +
                  "\n\nPlease type your Order ID:"
              );
              break;

            case "driver_location_issue":
              await customer.updateConversationState("driver_location_issue");
              await sendWhatsAppMessage(
                phoneNumber,
                "🗺️ *Driver couldn't find my Location*\n\n" +
                  "Here are your orders:\n\n" +
                  formatOrderList(customer.orderHistory) +
                  "\n\nPlease type your Order ID:"
              );
              break;

            case "marked_delivered_not_received":
              await customer.updateConversationState(
                "marked_delivered_not_received"
              );
              await sendWhatsAppMessage(
                phoneNumber,
                "🚨 *Marked Delivered but Not Received*\n\n" +
                  "That sounds serious! 😟\n\n" +
                  "Here are your orders:\n\n" +
                  formatOrderList(customer.orderHistory) +
                  "\n\nPlease send your Order ID:"
              );
              break;

            case "reschedule_delivery":
              await customer.updateConversationState("reschedule_delivery");
              await sendWhatsAppMessage(
                phoneNumber,
                "📅 *Reschedule My Delivery*\n\n" +
                  "Sure, we can reschedule! 📆\n\n" +
                  "⚠️ *Note:*\n" +
                  "• Changes outside our delivery rules may include extra charges\n" +
                  "• If your delivery time is faster than 8-10 days, your 5% discount will be revoked\n" +
                  "• Different locations may have new delivery charges\n\n" +
                  "Here are your orders:\n\n" +
                  formatOrderList(customer.orderHistory) +
                  "\n\nPlease provide Order ID:"
              );
              break;
          }
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please select a valid option (1-6)."
          );
        }
        break;

      case "product_issue_menu":
        const productIssueTypes = {
          1: "broken_item",
          2: "missing_wrong_amount",
          3: "wrong_item",
          4: "product_other",
        };

        const selectedProductIssue = productIssueTypes[text];

        if (selectedProductIssue) {
          await customer.updateSupportFlow({
            specificIssue: selectedProductIssue,
            currentStep: "order_id_input",
          });
          await customer.updateConversationState("product_issue_order_id");
          await sendWhatsAppMessage(
            phoneNumber,
            `🔧 *${
              selectedProductIssue === "broken_item"
                ? "Broken Item"
                : selectedProductIssue === "missing_wrong_amount"
                ? "Missing or Wrong Amount"
                : selectedProductIssue === "wrong_item"
                ? "Received Wrong Item"
                : "Other Product Issue"
            }*\n\n` +
              "Here are your orders:\n\n" +
              formatOrderList(customer.orderHistory) +
              "\n\nPlease type Order ID:"
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please select a valid option (1-4)."
          );
        }
        break;

        // Helper function to find order by ID or index
        function findOrderByIdOrIndex(orderHistory, userInput) {
          const trimmedInput = userInput.trim();

          // Check if input is a number (index selection)
          if (/^\d+$/.test(trimmedInput)) {
            const index = parseInt(trimmedInput) - 1; // Convert to 0-based index
            if (index >= 0 && index < orderHistory.length) {
              return orderHistory[index];
            }
          } else {
            // Search by order ID (case-insensitive)
            return orderHistory.find(
              (order) =>
                order.orderId.toLowerCase() === trimmedInput.toLowerCase()
            );
          }

          return null;
        }

      case "check_delivery":
        const orderToCheck = findOrderByIdOrIndex(customer.orderHistory, text);

        if (orderToCheck) {
          const deliveryDate = new Date(
            orderToCheck.deliveryDate
          ).toLocaleDateString();
          // FIXED: Properly access locationDetails from contextData with null checks
          const deliveryAddress =
            customer.contextData?.locationDetails ||
            orderToCheck.deliveryLocation ||
            "Address not specified";

          await sendWhatsAppMessage(
            phoneNumber,
            `📦 *Order #${orderToCheck.orderId}*\n\n` +
              `Your order will be delivered on ${deliveryDate}, between 12–4 PM.\n\n` +
              `📍 To: ${deliveryAddress}\n\n` +
              `Status: ${orderToCheck.status}\n\n` +
              "Type 0 to return to main menu."
          );

          // Return to main menu after 3 seconds
          setTimeout(async () => {
            await sendMainMenu(phoneNumber, customer);
          }, 3000);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Order not found. Please:\n" +
              "• Enter a valid Order ID\n" +
              "• Select by number (1, 2, 3...)\n" +
              "• Type 0 to return to main menu"
          );
        }
        break;

      case "payment_problems":
        const paymentIssueTypes = {
          1: "paid_no_confirmation",
          2: "payment_failed",
          3: "paid_different_name",
          4: "charged_twice",
          5: "unsure_payment",
          6: "use_credited_funds",
        };

        const selectedPaymentIssue = paymentIssueTypes[text];

        if (selectedPaymentIssue) {
          await customer.updateSupportFlow({
            specificIssue: selectedPaymentIssue,
            currentStep:
              selectedPaymentIssue === "charged_twice"
                ? "visit_required"
                : "payment_screenshot",
          });

          if (selectedPaymentIssue === "charged_twice") {
            await customer.updateConversationState("charged_twice");
            await sendWhatsAppMessage(
              phoneNumber,
              "💳 *Charged Twice*\n\n" +
                "Sorry to hear that! 😔\n\n" +
                "Please visit us with:\n" +
                "• Payment receipts\n" +
                "• Any evidence\n\n" +
                "We will process the refund in person.\n\n" +
                "Type 0 to return to main menu."
            );
          } else {
            await customer.updateConversationState(
              "payment_screenshot_request"
            );
            await sendWhatsAppMessage(
              phoneNumber,
              `💳 *${
                selectedPaymentIssue === "paid_no_confirmation"
                  ? "Paid but No Confirmation"
                  : selectedPaymentIssue === "payment_failed"
                  ? "Payment Failed"
                  : selectedPaymentIssue === "paid_different_name"
                  ? "Paid Under Different Name"
                  : selectedPaymentIssue === "unsure_payment"
                  ? "Unsure if Payment Went Through"
                  : "Use Credited Funds"
              }*\n\n` +
                "Please note: During holidays and peak periods, our response time may be longer than usual. It can take up to 48 hours for us to get back to you. We appreciate your patience and understanding.\n\n" +
                "Need urgent help?\nIf you're in a hurry or need immediate assistance, please call us directly at our payment number. We're here to help!\n\n" +
                "Please send a payment screenshot 📸"
            );
          }
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please select a valid option (1-6)."
          );
        }
        break;

      case "payment_screenshot_request":
        // Handle payment screenshot upload
        if (message.hasMedia && message.type === "image") {
          try {
            // Read the downloaded image file (following your pattern)
            const imageBuffer = fs.readFileSync(message.localMediaPath);
            const base64Image = imageBuffer.toString("base64");
            const imageSizeMB = (base64Image.length * 3) / 4 / (1024 * 1024);

            // Validate size (max 10MB for images)
            if (imageSizeMB > 10) {
              await sendWhatsAppMessage(
                phoneNumber,
                `❌ Image too large (${imageSizeMB.toFixed(
                  1
                )}MB). Max 10MB allowed.`
              );
              break;
            }

            // Save payment screenshot
            const paymentScreenshotData = {
              base64Data: base64Image,
              mimetype: message.mediaInfo.mimetype || "image/jpeg",
              uploadedAt: new Date(),
              fileSize: imageSizeMB,
              filename: `payment_screenshot_${Date.now()}.jpg`,
            };

            await customer.updateSupportFlow({
              currentStep: "payer_name_input",
              tempData: {
                ...customer.currentSupportFlow.tempData,
                paymentScreenshot: paymentScreenshotData,
              },
            });

            await customer.updateConversationState("payment_payer_name");
            await sendWhatsAppMessage(
              phoneNumber,
              `✅ Payment screenshot received (${imageSizeMB.toFixed(
                1
              )}MB)!\n\n` + "Type Name used in payment:"
            );

            console.log(
              `Payment screenshot saved for customer: ${phoneNumber}`
            );
          } catch (error) {
            console.error("Error processing payment screenshot:", error);
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Failed to process the image. Please try sending the payment screenshot again."
            );
          }
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "📸 Please send a payment screenshot image."
          );
        }
        break;

      case "payment_payer_name":
        const payerName = text.trim();
        await customer.updateSupportFlow({
          currentStep: "international_transfer_check",
          tempData: {
            ...customer.currentSupportFlow.tempData,
            payerName: payerName,
          },
        });

        await customer.updateConversationState("international_transfer_check");
        await sendWhatsAppMessage(
          phoneNumber,
          "Was this an international transfer? Type *Yes* or *No*"
        );
        break;

      case "international_transfer_check":
        const isInternational = text.toLowerCase().includes("yes");

        // Create payment issue ticket
        const paymentTicketData = {
          type: "payment_problem",
          subType: customer.currentSupportFlow.specificIssue,
          paymentData: {
            paymentScreenshot:
              customer.currentSupportFlow.tempData.paymentScreenshot,
            payerName: customer.currentSupportFlow.tempData.payerName,
            isInternationalTransfer: isInternational,
          },
          status: "open",
        };

        await customer.createSupportTicket(paymentTicketData);

        const responseMessage = isInternational
          ? "💬 *Note:* International payments can take up to 14 days. Amount must fully match the invoice.\n\nOur agent will call you for further guidance shortly."
          : "✅ Payment issue recorded successfully.\n\nOur agent will call you for further guidance shortly.";

        await sendWhatsAppMessage(phoneNumber, responseMessage);

        // Clear support flow and return to main menu
        await customer.clearSupportFlow();
        setTimeout(async () => {
          await sendMainMenu(phoneNumber, customer);
        }, 2000);
        break;

      case "speak_agent":
        // Handle agent request - save any additional details provided
        if (text && text.trim().length > 0) {
          const agentTicketData = {
            type: "agent_request",
            issueDetails: text.trim(),
            status: "open",
            estimatedResolutionTime: "within 2 hours",
          };

          await customer.createSupportTicket(agentTicketData);

          await sendWhatsAppMessage(
            phoneNumber,
            "✅ Your request has been recorded. Our customer support agent will contact you shortly.\n\nThank you for providing the details!"
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "✅ Our customer support team will contact you shortly."
          );
        }

        await customer.clearSupportFlow();
        setTimeout(async () => {
          await sendMainMenu(phoneNumber, customer);
        }, 2000);
        break;

      case "submit_complaint":
        // Handle complaint media upload (video or voice)
        if (
          message.hasMedia &&
          (message.type === "video" || message.type === "voice")
        ) {
          try {
            let mediaBuffer, base64Data, mediaSizeMB, filename, mediaType;

            if (message.type === "video") {
              // Handle video
              const response = await axios.get(message.media.url, {
                responseType: "arraybuffer",
              });
              mediaBuffer = Buffer.from(response.data, "binary");
              base64Data = mediaBuffer.toString("base64");
              mediaSizeMB = (base64Data.length * 3) / 4 / (1024 * 1024);
              filename = `complaint_video_${Date.now()}.mp4`;
              mediaType = "video";

              // Validate video size (max 15MB)
              if (mediaSizeMB > 15) {
                await sendWhatsAppMessage(
                  phoneNumber,
                  `❌ Video too large (${mediaSizeMB.toFixed(
                    1
                  )}MB). Max 15MB allowed.`
                );
                break;
              }
            } else if (message.type === "voice") {
              // Handle voice note
              const response = await axios.get(message.media.url, {
                responseType: "arraybuffer",
              });
              mediaBuffer = Buffer.from(response.data, "binary");
              base64Data = mediaBuffer.toString("base64");
              mediaSizeMB = (base64Data.length * 3) / 4 / (1024 * 1024);
              filename = `complaint_voice_${Date.now()}.ogg`;
              mediaType = "voice";

              // Validate voice size (max 5MB)
              if (mediaSizeMB > 5) {
                await sendWhatsAppMessage(
                  phoneNumber,
                  `❌ Voice note too large (${mediaSizeMB.toFixed(
                    1
                  )}MB). Max 5MB allowed.`
                );
                break;
              }
            }

            // Save complaint media
            const complaintMediaData = {
              mediaId: `COMP_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 9)}`,
              mediaType: mediaType,
              mimetype:
                message.media.mimetype ||
                (mediaType === "video" ? "video/mp4" : "audio/ogg"),
              filename: filename,
              base64Data: base64Data,
              fileSize: mediaSizeMB,
              uploadedAt: new Date(),
            };

            await customer.updateSupportFlow({
              currentStep: "text_summary_input",
              tempData: {
                ...customer.currentSupportFlow.tempData,
                complaintMedia: complaintMediaData,
              },
              mediaExpected: false,
            });

            await customer.updateConversationState("complaint_text_summary");
            await sendWhatsAppMessage(
              phoneNumber,
              `🎥 ${
                mediaType === "video" ? "Video" : "Voice note"
              } received (${mediaSizeMB.toFixed(1)}MB)!\n\n` +
                "Add a short text summary about the complaint:"
            );

            console.log(
              `Complaint ${mediaType} saved for customer: ${phoneNumber}`
            );
          } catch (error) {
            console.error("Error processing complaint media:", error);
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Failed to process the media. Please try sending the video or voice note again."
            );
          }
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "🎥 Please attach a video or voice note to submit your complaint."
          );
        }
        break;
      case "complaint_text_summary":
        const textSummary = text.trim();
        await customer.updateSupportFlow({
          currentStep: "order_relation_check",
          tempData: {
            ...customer.currentSupportFlow.tempData,
            textSummary: textSummary,
          },
        });

        await customer.updateConversationState("complaint_order_relation");
        await sendWhatsAppMessage(
          phoneNumber,
          "Is this problem related to your order? Type *yes* or *no*"
        );
        break;

      case "complaint_order_relation":
        const isOrderRelated = text.toLowerCase().includes("yes");

        if (isOrderRelated) {
          await customer.updateSupportFlow({
            currentStep: "order_id_input",
            tempData: {
              ...customer.currentSupportFlow.tempData,
              isOrderRelated: true,
            },
          });

          await customer.updateConversationState("complaint_order_id");
          await sendWhatsAppMessage(
            phoneNumber,
            "Please include your Order ID:\n\n" +
              formatOrderList(customer.orderHistory) +
              "\n\nType your Order ID:"
          );
        } else {
          // Create complaint without order ID
          const complaintData = {
            mediaAttachments: [
              customer.currentSupportFlow.tempData.complaintMedia,
            ],
            textSummary: customer.currentSupportFlow.tempData.textSummary,
            isOrderRelated: false,
            status: "submitted",
          };

          await customer.createComplaint(complaintData);

          await sendWhatsAppMessage(
            phoneNumber,
            "✅ Your complaint has been submitted successfully. Our agent will call you shortly.\n\n" +
              "Thank you for your feedback!"
          );

          await customer.clearSupportFlow();
          setTimeout(async () => {
            await sendMainMenu(phoneNumber, customer);
          }, 2000);
        }
        break;

      case "complaint_order_id":
        const relatedOrder = findOrderByIdOrIndex(customer.orderHistory, text);

        if (relatedOrder) {
          // Create complaint with order ID
          const complaintData = {
            orderId: relatedOrder.orderId,
            mediaAttachments: [
              customer.currentSupportFlow.tempData.complaintMedia,
            ],
            textSummary: customer.currentSupportFlow.tempData.textSummary,
            isOrderRelated: true,
            status: "submitted",
          };

          await customer.createComplaint(complaintData);

          await sendWhatsAppMessage(
            phoneNumber,
            `✅ Your complaint for Order #${relatedOrder.orderId} has been submitted successfully. Our agent will call you shortly.\n\n` +
              "Thank you for your feedback!"
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Order not found. Please:\n" +
              "• Enter a valid Order ID\n" +
              "• Select by number (1, 2, 3...)\n" +
              "• Type 0 to return to main menu"
          );
          return; // Don't clear flow, let them try again
        }

        await customer.clearSupportFlow();
        setTimeout(async () => {
          await sendMainMenu(phoneNumber, customer);
        }, 2000);
        break;
      // 2. Track order delivery case - Enhanced with flexible selection
      case "track_order_delivery":
        const userInput = text.trim();
        let orderToTrack = null;

        // Check if input is a number (index selection)
        if (/^\d+$/.test(userInput)) {
          const index = parseInt(userInput) - 1; // Convert to 0-based index
          if (index >= 0 && index < customer.orderHistory.length) {
            orderToTrack = customer.orderHistory[index];
          }
        } else {
          // Search by order ID (case-insensitive)
          orderToTrack = customer.orderHistory.find(
            (order) => order.orderId.toLowerCase() === userInput.toLowerCase()
          );
        }

        if (orderToTrack) {
          const orderDate = new Date(
            orderToTrack.orderDate
          ).toLocaleDateString();
          const deliveryDate = new Date(
            orderToTrack.deliveryDate
          ).toLocaleDateString();
          // FIXED: Properly access locationDetails from contextData with fallbacks
          const deliveryAddress =
            customer.contextData?.locationDetails ||
            orderToTrack.deliveryLocation ||
            orderToTrack.deliveryAddress?.fullAddress ||
            "Address not specified";

          await sendWhatsAppMessage(
            phoneNumber,
            `📦 *Order #${orderToTrack.orderId}*\n\n` +
              `Your order will be delivered on ${deliveryDate}, between 12–4 PM.\n\n` +
              `📍 To: ${deliveryAddress}\n\n` +
              `Order placed: ${orderDate}\n` +
              `Status: ${orderToTrack.status}\n` +
              `Total: Rp.${Math.round(
                orderToTrack.totalAmount
              ).toLocaleString()}` +
              `Please keep in touch with the driver and he will deliver. 
Don't be scared call us and we will help you xxx-xxx`
          );

          await customer.clearSupportFlow();
          setTimeout(async () => {
            await sendMainMenu(phoneNumber, customer);
          }, 3000);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Order not found. Please:\n" +
              "• Enter a valid Order ID\n" +
              "• Select by number (1, 2, 3...)\n" +
              "• Type 0 to return to main menu"
          );
        }
        break;

      case "delivery_delayed":
        const delayedOrder = findOrderByIdOrIndex(customer.orderHistory, text);

        if (delayedOrder) {
          // Create support ticket for delayed delivery
          const ticketData = {
            type: "delivery_issue",
            subType: "delivery_delayed",
            orderId: delayedOrder.orderId,
            issueDetails: "Customer reported delivery delay",
            status: "open",
          };

          await customer.createSupportTicket(ticketData);

          // Calculate new delivery date (add 1 day to original)
          const newDeliveryDate = new Date(delayedOrder.deliveryDate);
          newDeliveryDate.setDate(newDeliveryDate.getDate() + 1);

          await sendWhatsAppMessage(
            phoneNumber,
            `📦 *Order #${delayedOrder.orderId}*\n\n` +
              `Your delivery is delayed and will now arrive on ${newDeliveryDate.toLocaleDateString()}, between 12–4 PM.\n\n` +
              "Thanks for your patience! 🙏\n\n" +
              "Our team has been notified and will monitor your delivery closely."
          );

          await customer.clearSupportFlow();
          setTimeout(async () => {
            await sendMainMenu(phoneNumber, customer);
          }, 3000);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Order not found. Please:\n" +
              "• Enter a valid Order ID\n" +
              "• Select by number (1, 2, 3...)\n" +
              "• Type 0 to return to main menu"
          );
        }
        break;

      case "change_delivery_address":
        const addressOrder = findOrderByIdOrIndex(customer.orderHistory, text);

        if (addressOrder) {
          // Check if order is dispatched
          const isDispatched = [
            "on-way",
            "driver-confirmed",
            "order-pickuped-up",
          ].includes(addressOrder.status);

          // FIXED: Properly get current address with multiple fallbacks
          const currentAddress =
            customer.contextData?.locationDetails ||
            addressOrder.deliveryLocation ||
            addressOrder.deliveryAddress?.fullAddress ||
            "Address not specified";

          await customer.updateSupportFlow({
            currentStep: "address_change_confirm",
            tempData: {
              ...customer.currentSupportFlow.tempData,
              orderId: addressOrder.orderId,
              isDispatched: isDispatched,
              currentAddress: currentAddress,
            },
          });

          await customer.updateConversationState("address_change_confirm");
          await sendWhatsAppMessage(
            phoneNumber,
            `⚠️ *Important Notice - Address Change*\n\n` +
              `Changing address is connected to additional delivery charges...\n` +
              `💰 *50k - 200k or even more*\n\n` +
              `That additional charge will be transferred to QRS payment.\n\n` +
              `Current address: ${currentAddress}\n\n` +
              `Are you sure you want to change address?\n` +
              `1. ✅ Yes\n` +
              `2. ❌ No`
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Order not found. Please:\n" +
              "• Enter a valid Order ID\n" +
              "• Select by number (1, 2, 3...)\n" +
              "• Type 0 to return to main menu"
          );
        }
        break;

      case "address_change_confirm":
        const addressConfirmChoice = text.trim();
        
        if (addressConfirmChoice === "1" || addressConfirmChoice.toLowerCase() === "yes") {
          // User confirmed - proceed to area selection
          const activeAreasForChange = await getActiveAreas();
          const areasDisplayForChange = formatAreasForDisplay(activeAreasForChange);
          
          await customer.updateConversationState("address_change_select_area");
          await sendWhatsAppMessage(
            phoneNumber,
            `📍 *Select your new delivery area:*\n\n${areasDisplayForChange}`
          );
        } else if (addressConfirmChoice === "2" || addressConfirmChoice.toLowerCase() === "no") {
          // User cancelled
          await customer.clearSupportFlow();
          await sendWhatsAppMessage(
            phoneNumber,
            "✅ Address change cancelled. Your delivery address remains unchanged."
          );
          setTimeout(async () => {
            await sendMainMenu(phoneNumber, customer);
          }, 2000);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please select:\n1. ✅ Yes\n2. ❌ No"
          );
        }
        break;

      case "address_change_select_area":
        const areaIndexForChange = parseInt(text) - 1;
        const activeAreasChange = await getActiveAreas();
        
        if (areaIndexForChange >= 0 && areaIndexForChange < activeAreasChange.length) {
          const selectedAreaForChange = activeAreasChange[areaIndexForChange];
          const flowDataArea = customer.currentSupportFlow.tempData;
          
          // Store selected area in temp data
          await customer.updateSupportFlow({
            currentStep: "address_change_google_map",
            tempData: {
              ...flowDataArea,
              newArea: selectedAreaForChange.area,
              newState: selectedAreaForChange.state,
              newAreaDisplayName: selectedAreaForChange.displayName,
              additionalCharge: selectedAreaForChange.truckPrice || 0,
            },
          });
          
          await customer.updateConversationState("address_change_google_map");
          await sendWhatsAppMessage(
            phoneNumber,
            `✅ Area selected: ${selectedAreaForChange.displayName}\n` +
              (selectedAreaForChange.truckPrice > 0 
                ? `💰 Additional charge: ${formatRupiah(selectedAreaForChange.truckPrice)}\n\n` 
                : `✅ No additional delivery charge for this area.\n\n`) +
              `📍 Please provide your Google Maps location link:`
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            `❌ Please select a valid area number (1-${activeAreasChange.length}).`
          );
        }
        break;

      case "address_change_google_map":
        // Validate Google Maps link
        if (
          !text.includes("maps.google") &&
          !text.includes("goo.gl") &&
          !text.startsWith("https://maps") &&
          !text.includes("maps.app.goo.gl")
        ) {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please send a valid Google Maps link. It should include 'maps.google' or 'goo.gl'."
          );
          return;
        }
        
        const flowDataMap = customer.currentSupportFlow.tempData;
        
        await customer.updateSupportFlow({
          currentStep: "address_change_full_address",
          tempData: {
            ...flowDataMap,
            googleMapLink: text,
          },
        });
        
        await customer.updateConversationState("address_change_full_address");
        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Location received!\n\n📝 Now please enter your complete address (house number, street, landmarks, etc.):`
        );
        break;

      case "address_change_full_address":
        const newFullAddress = text.trim();
        const flowDataFinal = customer.currentSupportFlow.tempData;

        // Create address change ticket with full details
        const addressChangeTicketData = {
          type: "delivery_issue",
          subType: "change_delivery_address",
          orderId: flowDataFinal.orderId,
          deliveryData: {
            currentAddress: flowDataFinal.currentAddress,
            newArea: flowDataFinal.newArea,
            newState: flowDataFinal.newState,
            newAddress: newFullAddress,
            googleMapLink: flowDataFinal.googleMapLink,
            additionalCharge: flowDataFinal.additionalCharge,
            isOrderDispatched: flowDataFinal.isDispatched,
            extraChargesApplicable: true,
          },
          issueDetails: `Customer requested address change from "${flowDataFinal.currentAddress}" to "${newFullAddress}" (Area: ${flowDataFinal.newAreaDisplayName})`,
          status: "open",
        };

        await customer.createSupportTicket(addressChangeTicketData);

        // Update order with new address
        const orderIdxChange = customer.orderHistory.findIndex(
          (order) => order.orderId === flowDataFinal.orderId
        );
        if (orderIdxChange !== -1) {
          customer.orderHistory[orderIdxChange].deliveryLocation = `${flowDataFinal.newState} - ${flowDataFinal.newArea}`;
          customer.orderHistory[orderIdxChange].deliveryAddress = {
            area: flowDataFinal.newArea,
            state: flowDataFinal.newState,
            fullAddress: newFullAddress,
            googleMapLink: flowDataFinal.googleMapLink,
          };
          
          // Add additional delivery charge if applicable
          if (flowDataFinal.additionalCharge > 0) {
            customer.orderHistory[orderIdxChange].deliveryCharge = 
              (customer.orderHistory[orderIdxChange].deliveryCharge || 0) + flowDataFinal.additionalCharge;
          }

          if (!customer.contextData) {
            customer.contextData = {};
          }
          customer.contextData.locationDetails = newFullAddress;

          if (!customer.addressChangeHistory) {
            customer.addressChangeHistory = [];
          }

          customer.addressChangeHistory.push({
            orderId: flowDataFinal.orderId,
            oldAddress: flowDataFinal.currentAddress,
            newAddress: newFullAddress,
            newArea: flowDataFinal.newAreaDisplayName,
            googleMapLink: flowDataFinal.googleMapLink,
            additionalCharge: flowDataFinal.additionalCharge,
            requestedAt: new Date(),
            status: "pending",
          });

          await customer.save();
        }

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ *Address Change Request Submitted!*\n\n` +
            `📦 Order: #${flowDataFinal.orderId}\n` +
            `📍 New Area: ${flowDataFinal.newAreaDisplayName}\n` +
            `🏠 New Address: ${newFullAddress}\n` +
            (flowDataFinal.additionalCharge > 0 
              ? `💰 Additional Charge: ${formatRupiah(flowDataFinal.additionalCharge)}\n\n` 
              : `\n`) +
            `⚠️ Additional charges will be transferred to QRS payment.\n\n` +
            `Our team will contact you shortly to confirm the changes.\n` +
            `Thank you for your patience! 😊`
        );

        await customer.clearSupportFlow();
        setTimeout(async () => {
          await sendMainMenu(phoneNumber, customer);
        }, 3000);
        break;

      case "new_address_input":
        const newAddress = text.trim();
        const flowData = customer.currentSupportFlow.tempData;

        // Create address change ticket
        const addressTicketData = {
          type: "delivery_issue",
          subType: "change_delivery_address",
          orderId: flowData.orderId,
          deliveryData: {
            currentAddress: flowData.currentAddress,
            newAddress: newAddress,
            isOrderDispatched: flowData.isDispatched,
            extraChargesApplicable: flowData.isDispatched,
          },
          issueDetails: `Customer requested address change from "${flowData.currentAddress}" to "${newAddress}"`,
          status: "open",
        };

        await customer.createSupportTicket(addressTicketData);

        // FIXED: Update both contextData.locationDetails AND order's deliveryLocation
        const orderIndex = customer.orderHistory.findIndex(
          (order) => order.orderId === flowData.orderId
        );
        if (orderIndex !== -1) {
          // Update the order's deliveryLocation field
          customer.orderHistory[orderIndex].deliveryLocation = newAddress;

          // ALSO update contextData.locationDetails for current session
          if (!customer.contextData) {
            customer.contextData = {};
          }
          customer.contextData.locationDetails = newAddress;

          // Add to address change history
          if (!customer.addressChangeHistory) {
            customer.addressChangeHistory = [];
          }

          customer.addressChangeHistory.push({
            orderId: flowData.orderId,
            oldAddress: flowData.currentAddress,
            newAddress: newAddress,
            requestedAt: new Date(),
            status: "pending",
          });

          await customer.save();
        }

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Address change request received!\n\n` +
            `Order: #${flowData.orderId}\n` +
            `New address: ${newAddress}\n\n` +
            (flowData.isDispatched
              ? "⚠️ Since your order is already dispatched, extra charges may apply. "
              : "✅ We'll update your delivery address. ") +
            "You'll receive a confirmation soon.\n\n" +
            "Our team will contact you if any additional charges apply."
        );

        await customer.clearSupportFlow();
        setTimeout(async () => {
          await sendMainMenu(phoneNumber, customer);
        }, 3000);
        break;
      case "driver_location_issue":
        const locationOrder = findOrderByIdOrIndex(customer.orderHistory, text);

        if (locationOrder) {
          await customer.updateSupportFlow({
            currentStep: "landmark_input",
            tempData: {
              ...customer.currentSupportFlow.tempData,
              orderId: locationOrder.orderId,
            },
          });

          await customer.updateConversationState("landmark_input");
          await sendWhatsAppMessage(
            phoneNumber,
            `📍 *Driver couldn't find my Location - Order #${locationOrder.orderId}*\n\n`
          );
          await sendWhatsAppMessage(
            phoneNumber,
            `If you're already in contact with the driver, please share your location and include a nearby landmark to help him find you easily.
Don't worry — the driver will reach you and deliver the products safely..` +
              `plz communicate with the driver`
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Order not found. Please:\n" +
              "• Enter a valid Order ID\n" +
              "• Select by number (1, 2, 3...)\n" +
              "• Type 0 to return to main menu"
          );
        }
        break;

      case "landmark_input":
        await customer.clearSupportFlow();
        setTimeout(async () => {
          await sendMainMenu(phoneNumber, customer);
        }, 3000);
        break;

      case "marked_delivered_not_received":
        const notReceivedOrder = findOrderByIdOrIndex(
          customer.orderHistory,
          text
        );

        if (notReceivedOrder) {
          // Create urgent support ticket
          const urgentTicketData = {
            type: "delivery_issue",
            subType: "marked_delivered_not_received",
            orderId: notReceivedOrder.orderId,
            issueDetails:
              "Customer reports order marked as delivered but not received",
            status: "open",
            priority: "urgent",
          };

          await customer.createSupportTicket(urgentTicketData);

          await sendWhatsAppMessage(
            phoneNumber,
            `🚨 *URGENT - Order #${notReceivedOrder.orderId}*\n\n` +
              "Please contact our support line immediately:\n" +
              "📞 08555555555\n\n" +
              "We'll investigate right away.\n\n" +
              "This issue has been flagged as HIGH PRIORITY and our team has been alerted."
          );

          await customer.clearSupportFlow();
          setTimeout(async () => {
            await sendMainMenu(phoneNumber, customer);
          }, 3000);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Order not found. Please:\n" +
              "• Enter a valid Order ID\n" +
              "• Select by number (1, 2, 3...)\n" +
              "• Type 0 to return to main menu"
          );
        }
        break;

      case "reschedule_delivery":
        const rescheduleOrder = findOrderByIdOrIndex(
          customer.orderHistory,
          text
        );

        if (rescheduleOrder) {
          await customer.updateSupportFlow({
            currentStep: "new_date_input",
            tempData: {
              ...customer.currentSupportFlow.tempData,
              orderId: rescheduleOrder.orderId,
            },
          });

          await customer.updateConversationState("reschedule_new_date");
          await sendWhatsAppMessage(
            phoneNumber,
            `📅 *Reschedule Delivery - Order #${rescheduleOrder.orderId}*\n\n` +
              "New preferred date (e.g., 19 June, 2025):"
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Order not found. Please:\n" +
              "• Enter a valid Order ID\n" +
              "• Select by number (1, 2, 3...)\n" +
              "• Type 0 to return to main menu"
          );
        }
        break;

      case "reschedule_new_date":
        const newDate = text.trim();
        await customer.updateSupportFlow({
          currentStep: "new_time_input",
          tempData: {
            ...customer.currentSupportFlow.tempData,
            newDate: newDate,
          },
        });

        await customer.updateConversationState("reschedule_new_time");
        await sendWhatsAppMessage(
          phoneNumber,
          "New preferred time (e.g., 9:00 PM):"
        );
        break;

      case "reschedule_new_time":
        const newTime = text.trim();
        await customer.updateSupportFlow({
          currentStep: "new_location_input",
          tempData: {
            ...customer.currentSupportFlow.tempData,
            newTime: newTime,
          },
        });

        await customer.updateConversationState("reschedule_new_location");
        await sendWhatsAppMessage(
          phoneNumber,
          "Delivery location (or type 'same' to keep current address):"
        );
        break;

      case "reschedule_new_location":
        const newLocation = text.trim();
        const rescheduleFlowData = customer.currentSupportFlow.tempData;

        // Create reschedule ticket
        const rescheduleTicketData = {
          type: "delivery_issue",
          subType: "reschedule_delivery",
          orderId: rescheduleFlowData.orderId,
          deliveryData: {
            newDeliveryDate: rescheduleFlowData.newDate,
            newDeliveryTime: rescheduleFlowData.newTime,
            newAddress:
              newLocation === "same" ? "Keep current address" : newLocation,
            extraChargesApplicable: true, // Rescheduling usually involves charges
          },
          issueDetails: `Customer requested reschedule to ${rescheduleFlowData.newDate} at ${rescheduleFlowData.newTime}`,
          status: "open",
        };

        await customer.createSupportTicket(rescheduleTicketData);

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ *Reschedule Request Submitted*\n\n` +
            `Order: #${rescheduleFlowData.orderId}\n` +
            `New Date: ${rescheduleFlowData.newDate}\n` +
            `New Time: ${rescheduleFlowData.newTime}\n` +
            `Location: ${
              newLocation === "same" ? "Same as original" : newLocation
            }\n\n` +
            "⚠️ *Please note:*\n" +
            "• Extra charges may apply for rescheduling\n" +
            "• Our team will confirm availability and contact you\n" +
            "• If delivery is expedited, discount may be revoked\n\n" +
            "You'll receive confirmation within 24 hours."
        );

        await customer.clearSupportFlow();
        setTimeout(async () => {
          await sendMainMenu(phoneNumber, customer);
        }, 3000);
        break;

      case "product_issue_order_id":
        const productOrder = findOrderByIdOrIndex(customer.orderHistory, text);

        if (productOrder) {
          const currentProductIssue = customer.currentSupportFlow.specificIssue;

          await customer.updateSupportFlow({
            currentStep: "item_name_input",
            tempData: {
              ...customer.currentSupportFlow.tempData,
              orderId: productOrder.orderId,
              orderItems: productOrder.items,
            },
          });

          // Show order items for selection
          const itemsList = productOrder.items
            .map(
              (item, index) =>
                `${index + 1}. ${item.productName} (${item.quantity}x)`
            )
            .join("\n");

          await customer.updateConversationState("product_item_selection");
          await sendWhatsAppMessage(
            phoneNumber,
            `🔧 *${
              currentProductIssue === "broken_item"
                ? "Broken Item"
                : currentProductIssue === "missing_wrong_amount"
                ? "Missing/Wrong Amount"
                : currentProductIssue === "wrong_item"
                ? "Wrong Item Received"
                : "Other Product Issue"
            }*\n\n` +
              `Order #${productOrder.orderId} contains:\n\n${itemsList}\n\n` +
              "Type the item name or number that has the issue:"
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Order not found. Please:\n" +
              "• Enter a valid Order ID\n" +
              "• Select by number (1, 2, 3...)\n" +
              "• Type 0 to return to main menu"
          );
        }
        break;
      case "product_item_selection":
        const itemInput = text.trim();
        const productFlowData = customer.currentSupportFlow.tempData;
        const selectedProductIssueType =
          customer.currentSupportFlow.specificIssue;

        // Find the item (by name or number)
        let selectedItem = null;
        if (!isNaN(itemInput)) {
          const itemIndex = parseInt(itemInput) - 1;
          if (itemIndex >= 0 && itemIndex < productFlowData.orderItems.length) {
            selectedItem = productFlowData.orderItems[itemIndex];
          }
        } else {
          selectedItem = productFlowData.orderItems.find((item) =>
            item.productName.toLowerCase().includes(itemInput.toLowerCase())
          );
        }

        if (selectedItem) {
          await customer.updateSupportFlow({
            currentStep: "issue_description_input",
            tempData: {
              ...productFlowData,
              selectedItem: selectedItem,
            },
          });

          await customer.updateConversationState("product_issue_description");

          if (selectedProductIssueType === "wrong_item") {
            await sendWhatsAppMessage(
              phoneNumber,
              `🔄 *Wrong Item: ${selectedItem.productName}*\n\n` +
                "Would you like to:\n" +
                "1. Keep the item and pay for it\n" +
                "2. Replace it with what you ordered\n\n" +
                "Type 1 or 2 to choose:"
            );
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              `📝 *Issue with: ${selectedItem.productName}*\n\n` +
                "What's the issue? Please describe in text:" +
                "And in next step we will ask you to submit a video"
            );
          }
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Item not found. Please type the correct item name or number from the list above."
          );
        }
        break;

      case "product_issue_description":
        const issueDescription = text.trim();
        const descriptionFlowData = customer.currentSupportFlow.tempData;
        const currentSpecificIssue = customer.currentSupportFlow.specificIssue;

        if (
          currentSpecificIssue === "wrong_item" &&
          (text === "1" || text === "2")
        ) {
          const preference = text === "1" ? "keep_and_pay" : "replace";

          // Create product issue ticket
          const productTicketData = {
            type: "product_issue",
            subType: currentSpecificIssue,
            orderId: descriptionFlowData.orderId,
            productData: {
              affectedItems: [descriptionFlowData.selectedItem.productName],
              customerPreference: preference,
            },
            issueDetails: `Wrong item received: ${descriptionFlowData.selectedItem.productName}. Customer choice: ${preference}`,
            status: "open",
          };

          await customer.createSupportTicket(productTicketData);

          const responseMessage =
            preference === "keep_and_pay"
              ? "✅ You've chosen to keep the item and pay for it. Our billing team will contact you with payment details."
              : "✅ You've chosen to replace the item. Our team will arrange the replacement and pickup of the wrong item.";

          await sendWhatsAppMessage(phoneNumber, responseMessage);

          await customer.clearSupportFlow();
          setTimeout(async () => {
            await sendMainMenu(phoneNumber, customer);
          }, 3000);
        } else if (currentSpecificIssue === "broken_item") {
          await customer.updateSupportFlow({
            currentStep: "damage_photo_input",
            tempData: {
              ...descriptionFlowData,
              issueDescription: issueDescription,
            },
            mediaExpected: true,
          });

          await customer.updateConversationState("damage_photo_upload");
          await sendWhatsAppMessage(
            phoneNumber,
            `📸 *Broken Item: ${descriptionFlowData.selectedItem.productName}*\n\n` +
              `Issue: ${issueDescription}\n\n` +
              "Share a video showing the damage:"
          );
          await sendWhatsAppMessage(
            phoneNumber,
            `If the video is large, please allow a little extra time for it to load or upload. Thank you for your patience!` +
              `Don’t worry, it’s uploading — please wait up to 3 minutes`
          );
        } else if (currentSpecificIssue === "missing_wrong_amount") {
          await customer.updateSupportFlow({
            currentStep: "missing_amount_video",
            tempData: {
              ...descriptionFlowData,
              issueDescription: issueDescription,
            },
            mediaExpected: true,
          });

          await customer.updateConversationState("missing_amount_video");
          await sendWhatsAppMessage(
            phoneNumber,
            `📦 *Missing/Wrong Amount: ${descriptionFlowData.selectedItem.productName}*\n\n` +
              `Issue: ${issueDescription}\n\n` +
              "Please attach a short video and a voice message explaining what is missing or wrong:" +
              "----------------------------------\n\n" +
              "If the video is large, please allow a little extra time for it to load or upload. Thank you for your patience!\n\n" +
              `Don’t worry, it’s uploading — please wait up to 3 minutes`
          );
        } else {
          // For "other" product issues
          const productTicketData = {
            type: "product_issue",
            subType: "product_other",
            orderId: descriptionFlowData.orderId,
            productData: {
              affectedItems: [descriptionFlowData.selectedItem.productName],
              issueDescription: issueDescription,
            },
            issueDetails: `Product issue with ${descriptionFlowData.selectedItem.productName}: ${issueDescription}`,
            status: "open",
          };

          await customer.createSupportTicket(productTicketData);

          await sendWhatsAppMessage(
            phoneNumber,
            "✅ Product issue reported successfully. Our team will assist you right away."
          );

          await customer.clearSupportFlow();
          setTimeout(async () => {
            await sendMainMenu(phoneNumber, customer);
          }, 3000);
        }
        break;

      case "damage_photo_upload":
        // Handle damage photo/video upload
        if (
          message.hasMedia &&
          (message.type === "video" || message.type === "image")
        ) {
          try {
            let mediaBuffer, base64Data, mediaSizeMB, filename, mediaType;

            if (message.type === "video") {
              // Handle video
              const response = await axios.get(message.media.url, {
                responseType: "arraybuffer",
              });
              mediaBuffer = Buffer.from(response.data, "binary");
              base64Data = mediaBuffer.toString("base64");
              mediaSizeMB = (base64Data.length * 3) / 4 / (1024 * 1024);
              filename = `damage_video_${Date.now()}.mp4`;
              mediaType = "video";

              // Validate video size (max 15MB)
              if (mediaSizeMB > 15) {
                await sendWhatsAppMessage(
                  phoneNumber,
                  `❌ Video too large (${mediaSizeMB.toFixed(
                    1
                  )}MB). Max 15MB allowed.`
                );
                break;
              }
            } else if (message.type === "image") {
              // Handle image
              mediaBuffer = fs.readFileSync(message.localMediaPath);
              base64Data = mediaBuffer.toString("base64");
              mediaSizeMB = (base64Data.length * 3) / 4 / (1024 * 1024);
              filename = `damage_photo_${Date.now()}.jpg`;
              mediaType = "image";

              // Validate image size (max 10MB)
              if (mediaSizeMB > 10) {
                await sendWhatsAppMessage(
                  phoneNumber,
                  `❌ Image too large (${mediaSizeMB.toFixed(
                    1
                  )}MB). Max 10MB allowed.`
                );
                break;
              }
            }

            const damageFlowData = customer.currentSupportFlow.tempData;

            // Create damage media data
            const damageMediaData = {
              mediaId: `DAMAGE_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 9)}`,
              mediaType: mediaType,
              mimetype:
                message.media?.mimetype ||
                message.mediaInfo?.mimetype ||
                (mediaType === "video" ? "video/mp4" : "image/jpeg"),
              filename: filename,
              base64Data: base64Data,
              fileSize: mediaSizeMB,
              uploadedAt: new Date(),
            };

            // Create broken item ticket
            const brokenItemTicketData = {
              type: "product_issue",
              subType: "broken_item",
              orderId: damageFlowData.orderId,
              productData: {
                affectedItems: [damageFlowData.selectedItem.productName],
                issueDescription: damageFlowData.issueDescription,
                damagePhotos: [damageMediaData],
              },
              mediaAttachments: [damageMediaData],
              issueDetails: `Broken item: ${damageFlowData.selectedItem.productName} - ${damageFlowData.issueDescription}`,
              status: "open",
            };

            await customer.createSupportTicket(brokenItemTicketData);

            await sendWhatsAppMessage(
              phoneNumber,
              `✅ *Damage Report Submitted*\n\n` +
                `${
                  mediaType === "video" ? "Video" : "Photo"
                } received (${mediaSizeMB.toFixed(1)}MB)\n` +
                `Item: ${damageFlowData.selectedItem.productName}\n` +
                `Issue: ${damageFlowData.issueDescription}\n\n` +
                "Our team will contact you within 1 hour.\n\n" +
                "💡 *Options available:*\n" +
                "• Delivery replacement (₨20k–50k charge)\n" +
                "• Bring to our facility for free replacement"
            );

            console.log(
              `Damage ${mediaType} saved for customer: ${phoneNumber}`
            );

            await customer.clearSupportFlow();
            setTimeout(async () => {
              await sendMainMenu(phoneNumber, customer);
            }, 3000);
          } catch (error) {
            console.error("Error processing damage media:", error);
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Failed to process the media. Please try sending the damage photo/video again."
            );
          }
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "📸 Please share a video or photo showing the damage to the item."
          );
          await sendWhatsAppMessage(
            phoneNumber,
            `If the video is large, please allow a little extra time for it to load or upload. Thank you for your patience!` +
              `Don’t worry, it’s uploading — please wait up to 3 minutes`
          );
        }
        break;
      case "missing_amount_video":
        // Handle missing amount video/voice upload
        if (
          message.hasMedia &&
          (message.type === "video" || message.type === "voice")
        ) {
          try {
            let mediaBuffer, base64Data, mediaSizeMB, filename, mediaType;

            if (message.type === "video") {
              // Handle video
              const response = await axios.get(message.media.url, {
                responseType: "arraybuffer",
              });
              mediaBuffer = Buffer.from(response.data, "binary");
              base64Data = mediaBuffer.toString("base64");
              mediaSizeMB = (base64Data.length * 3) / 4 / (1024 * 1024);
              filename = `missing_video_${Date.now()}.mp4`;
              mediaType = "video";

              // Validate video size (max 15MB)
              if (mediaSizeMB > 15) {
                await sendWhatsAppMessage(
                  phoneNumber,
                  `❌ Video too large (${mediaSizeMB.toFixed(
                    1
                  )}MB). Max 15MB allowed.`
                );
                break;
              }
            } else if (message.type === "voice") {
              // Handle voice note
              const response = await axios.get(message.media.url, {
                responseType: "arraybuffer",
              });
              mediaBuffer = Buffer.from(response.data, "binary");
              base64Data = mediaBuffer.toString("base64");
              mediaSizeMB = (base64Data.length * 3) / 4 / (1024 * 1024);
              filename = `missing_voice_${Date.now()}.ogg`;
              mediaType = "voice";

              // Validate voice size (max 5MB)
              if (mediaSizeMB > 5) {
                await sendWhatsAppMessage(
                  phoneNumber,
                  `❌ Voice note too large (${mediaSizeMB.toFixed(
                    1
                  )}MB). Max 5MB allowed.`
                );
                break;
              }
            }

            const missingFlowData = customer.currentSupportFlow.tempData;

            // Create missing media data
            const missingMediaData = {
              mediaId: `MISSING_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 9)}`,
              mediaType: mediaType,
              mimetype:
                message.media.mimetype ||
                (mediaType === "video" ? "video/mp4" : "audio/ogg"),
              filename: filename,
              base64Data: base64Data,
              fileSize: mediaSizeMB,
              uploadedAt: new Date(),
            };

            // Create missing/wrong amount ticket
            const missingItemTicketData = {
              type: "product_issue",
              subType: "missing_wrong_amount",
              orderId: missingFlowData.orderId,
              productData: {
                affectedItems: [missingFlowData.selectedItem.productName],
                issueDescription: missingFlowData.issueDescription,
              },
              mediaAttachments: [missingMediaData],
              issueDetails: `Missing/Wrong amount: ${missingFlowData.selectedItem.productName} - ${missingFlowData.issueDescription}`,
              status: "open",
            };

            await customer.createSupportTicket(missingItemTicketData);

            await sendWhatsAppMessage(
              phoneNumber,
              `✅ *Missing/Wrong Amount Report Submitted*\n\n` +
                `${
                  mediaType === "video" ? "Video" : "Voice note"
                } received (${mediaSizeMB.toFixed(1)}MB)\n` +
                `Item: ${missingFlowData.selectedItem.productName}\n` +
                `Issue: ${missingFlowData.issueDescription}\n\n` +
                "We'll ship the correct amount ASAP. 🚚\n\n" +
                "Our team will contact you to arrange the correction."
            );

            console.log(
              `Missing amount ${mediaType} saved for customer: ${phoneNumber}`
            );

            await customer.clearSupportFlow();
            setTimeout(async () => {
              await sendMainMenu(phoneNumber, customer);
            }, 3000);
          } catch (error) {
            console.error("Error processing missing amount media:", error);
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Failed to process the media. Please try sending the video and voice message again."
            );
          }
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "🎥 Please attach a short video and voice message explaining what is missing or wrong." +
              "----------------------------------\n\n" +
              "If the video is large, please allow a little extra time for it to load or upload. Thank you for your patience!\n\n" +
              `Don’t worry, it’s uploading — please wait up to 3 minutes`
          );
        }
        break;

      case "charged_twice":
        // This case handles when user was charged twice - already handled in payment_problems
        await customer.clearSupportFlow();
        setTimeout(async () => {
          await sendMainMenu(phoneNumber, customer);
        }, 2000);
        break;

      case "faqs":
        if (text === "0") {
          await sendMainMenu(phoneNumber, customer);
        } else {
          // Track FAQ interaction
          const faqInteraction = {
            question: "FAQ page visited",
            category: "general",
            timestamp: new Date(),
            helpful: true,
          };

          if (!customer.faqInteractions) {
            customer.faqInteractions = [];
          }
          customer.faqInteractions.push(faqInteraction);
          await customer.save();

          // Return to main menu automatically after 10 seconds
          setTimeout(async () => {
            await sendMainMenu(phoneNumber, customer);
          }, 10000);
        }
        break;

      // Generic media handler case for any support context expecting media
      case "support_media_handler":
        if (message.hasMedia && customer.currentSupportFlow?.mediaExpected) {
          try {
            let mediaBuffer, base64Data, mediaSizeMB, filename, mediaType;

            switch (message.type) {
              case "video":
                const videoResponse = await axios.get(message.media.url, {
                  responseType: "arraybuffer",
                });
                mediaBuffer = Buffer.from(videoResponse.data, "binary");
                base64Data = mediaBuffer.toString("base64");
                mediaSizeMB = (base64Data.length * 3) / 4 / (1024 * 1024);
                filename = `support_video_${Date.now()}.mp4`;
                mediaType = "video";

                if (mediaSizeMB > 15) {
                  await sendWhatsAppMessage(
                    phoneNumber,
                    `❌ Video too large (${mediaSizeMB.toFixed(
                      1
                    )}MB). Max 15MB allowed.`
                  );
                  return;
                }
                break;

              case "voice":
                const voiceResponse = await axios.get(message.media.url, {
                  responseType: "arraybuffer",
                });
                mediaBuffer = Buffer.from(voiceResponse.data, "binary");
                base64Data = mediaBuffer.toString("base64");
                mediaSizeMB = (base64Data.length * 3) / 4 / (1024 * 1024);
                filename = `support_voice_${Date.now()}.ogg`;
                mediaType = "voice";

                if (mediaSizeMB > 5) {
                  await sendWhatsAppMessage(
                    phoneNumber,
                    `❌ Voice note too large (${mediaSizeMB.toFixed(
                      1
                    )}MB). Max 5MB allowed.`
                  );
                  return;
                }
                break;

              case "image":
                mediaBuffer = fs.readFileSync(message.localMediaPath);
                base64Data = mediaBuffer.toString("base64");
                mediaSizeMB = (base64Data.length * 3) / 4 / (1024 * 1024);
                filename = `support_image_${Date.now()}.jpg`;
                mediaType = "image";

                if (mediaSizeMB > 10) {
                  await sendWhatsAppMessage(
                    phoneNumber,
                    `❌ Image too large (${mediaSizeMB.toFixed(
                      1
                    )}MB). Max 10MB allowed.`
                  );
                  return;
                }
                break;

              default:
                await sendWhatsAppMessage(
                  phoneNumber,
                  "❌ Unsupported media type. Please send an image, video, or voice note."
                );
                return;
            }

            // Store media in support media array
            if (!customer.supportMedia) {
              customer.supportMedia = [];
            }

            const supportMediaData = {
              mediaId: `SUPPORT_${Date.now()}_${Math.random()
                .toString(36)
                .substr(2, 9)}`,
              ticketId:
                customer.currentSupportFlow.tempData?.ticketId || "pending",
              mediaType: mediaType,
              base64Data: base64Data,
              mimetype: message.media?.mimetype || message.mediaInfo?.mimetype,
              fileSize: mediaSizeMB,
              uploadedAt: new Date(),
              filename: filename,
              description: `Support media for ${customer.currentSupportFlow.mainCategory}`,
            };

            customer.supportMedia.push(supportMediaData);
            await customer.save();

            await sendWhatsAppMessage(
              phoneNumber,
              `✅ ${
                mediaType === "video"
                  ? "Video"
                  : mediaType === "voice"
                  ? "Voice note"
                  : "Image"
              } received and saved successfully (${mediaSizeMB.toFixed(1)}MB)!`
            );

            console.log(
              `Support ${mediaType} saved for customer: ${phoneNumber}`
            );
          } catch (error) {
            console.error("Error processing support media:", error);
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Failed to process media. Please try uploading again."
            );
          }
        }
        break;

        // Additional utility functions to add to your code:

        // Function to send main support menu
        async function sendMainSupportMenu(phoneNumber, customer) {
          await customer.updateConversationState("support");
          await customer.clearSupportFlow();

          await sendWhatsAppMessage(
            phoneNumber,
            "📞 *Customer Support* 📞\n\n" +
              "How can we help you today?\n\n" +
              "1. Delivery & Product Issues\n" +
              "2. Check My Delivery\n" +
              "3. Payment Problems\n" +
              "4. Speak to an Agent\n" +
              "5. Submit a Complaint\n" +
              "6. FAQs\n\n" +
              "Type the number to continue or 0 to return to main menu."
          );
        }

        // Function to handle timeout scenarios
        async function handleSupportTimeout(phoneNumber, customer) {
          if (
            customer.currentSupportFlow &&
            customer.currentSupportFlow.lastInteraction
          ) {
            const timeDiff =
              new Date() -
              new Date(customer.currentSupportFlow.lastInteraction);
            const timeoutMinutes = 10; // 10 minutes timeout

            if (timeDiff > timeoutMinutes * 60 * 1000) {
              await sendWhatsAppMessage(
                phoneNumber,
                "⏰ Your support session has timed out due to inactivity. Returning to main menu."
              );

              await customer.clearSupportFlow();
              await sendMainMenu(phoneNumber, customer);
              return true;
            }
          }
          return false;
        }

        // Function to create quick support ticket for urgent issues
        async function createUrgentSupportTicket(
          customer,
          issueType,
          orderId,
          description
        ) {
          const urgentTicket = {
            type: issueType,
            orderId: orderId,
            issueDetails: description,
            status: "open",
            priority: "urgent",
            estimatedResolutionTime: "within 1 hour",
            createdAt: new Date(),
          };

          const ticketId = await customer.createSupportTicket(urgentTicket);

          // Also send notification to admin/support team
          console.log(
            `URGENT TICKET CREATED: ${ticketId} for customer ${customer.phoneNumber[0]}`
          );

          return ticketId;
        }

        // Function to save all conversation data for support analytics
        async function logSupportInteraction(customer, action, details = {}) {
          if (!customer.supportInteractionHistory) {
            customer.supportInteractionHistory = [];
          }

          const currentSession = customer.supportInteractionHistory.find(
            (session) =>
              session.sessionId === customer.currentSupportFlow?.sessionId
          );

          if (currentSession) {
            currentSession.totalMessages += 1;
            currentSession.lastAction = action;
            currentSession.lastActionTime = new Date();
            if (details.mediaShared) {
              currentSession.mediaShared += 1;
            }
          } else {
            // Create new session
            customer.supportInteractionHistory.push({
              sessionId: "SESS" + Date.now(),
              startTime: new Date(),
              category: customer.currentSupportFlow?.mainCategory || "unknown",
              totalMessages: 1,
              mediaShared: details.mediaShared ? 1 : 0,
              currentAction: action,
            });
          }

          await customer.save();
        }

        // Enhanced error handling for media processing
        async function handleMediaError(phoneNumber, mediaType, error) {
          console.error(`Media processing error for ${mediaType}:`, error);

          let errorMessage =
            "❌ Sorry, there was an issue processing your media. ";

          switch (mediaType) {
            case "video":
              errorMessage +=
                "Please ensure your video is under 50MB and try again.";
              break;
            case "image":
              errorMessage +=
                "Please ensure your image is clear and under 10MB.";
              break;
            case "voice":
              errorMessage +=
                "Please ensure your voice note is clear and under 5MB.";
              break;
            default:
              errorMessage += "Please try uploading the file again.";
          }

          await sendWhatsAppMessage(phoneNumber, errorMessage);
        }

        // Function to validate order ID format
        function isValidOrderId(orderId) {
          // Assuming order IDs follow pattern like "ORD12345678" or similar
          return orderId && orderId.length > 3 && /^[A-Z0-9]+$/.test(orderId);
        }

        // Function to get order status in user-friendly format
        function getUserFriendlyOrderStatus(status) {
          const statusMap = {
            "cart-not-paid": "Cart (Not Paid)",
            "order-made-not-paid": "Order Created (Payment Pending)",
            "pay-not-confirmed": "Payment Not Confirmed",
            "order-confirmed": "Order Confirmed",
            "order not picked": "Awaiting Pickup",
            "issue-customer": "Issue Reported",
            "customer-confirmed": "Customer Confirmed",
            "order-refunded": "Refunded",
            "picking-order": "Being Prepared",
            "allocated-driver": "Driver Assigned",
            "ready to pickup": "Ready for Pickup",
            "order-not-pickedup": "Pickup Missed",
            "order-pickuped-up": "Picked Up",
            "on-way": "On the Way",
            "driver-confirmed": "Driver Confirmed",
            "order-processed": "Processed",
            refund: "Refund in Progress",
            "complain-order": "Complaint Filed",
            "issue-driver": "Driver Issue",
            "parcel-returned": "Returned",
            "order-complete": "Delivered",
          };

          return statusMap[status] || status;
        }

      // Modified account case to support the new menu structure
      case "profile":
        // Handle profile management
        if (["1", "2", "3", "4", "5", "6"].includes(text)) {
          switch (text) {
            case "1":
              // Update name
              await customer.updateConversationState("update_name");
              await sendWhatsAppMessage(
                phoneNumber,
                `Your current name is: ${customer.name}\n\nPlease enter your new name:`
              );
              break;

            case "2":
              // Update email
              await customer.updateConversationState("update_email");
              await sendWhatsAppMessage(
                phoneNumber,
                `Your current email is: ${
                  customer.contextData?.email || "Not provided"
                }\n\nPlease enter your new email:`
              );
              break;

            case "3":
              // Manage addresses
              await customer.updateConversationState("manage_addresses");
              let addressMessage = "Your saved addresses:\n\n";

              if (!customer.addresses || customer.addresses.length === 0) {
                addressMessage += "You don't have any saved addresses yet.\n\n";
              } else {
                customer.addresses.forEach((addr, index) => {
                  addressMessage += `${index + 1}.  ${addr.nickname}:  (${
                    addr.area
                  })\n`;
                });
                addressMessage += "\n";
              }

              addressMessage +=
                "What would you like to do?\n\n" +
                "1. Add a new address\n" +
                "2. Remove an address\n" +
                "3. Return to profile";

              await sendWhatsAppMessage(phoneNumber, addressMessage);
              break;

            case "4":
              // Go to account menu - UPDATED with new structure
              await customer.updateConversationState("account_main");
              let accountMessage =
                ` *My Account* \n\n` +
                `Please select an option:\n\n` +
                `1. Funds\n` +
                `2. Forman (eligibility)\n` +
                `3. Switch my number\n` +
                `4. Return to Profile`;
              await sendWhatsAppMessage(phoneNumber, accountMessage);
              break;

            case "5":
              // Manage bank accounts
              await customer.updateConversationState("manage_bank_accounts");
              let bankMsg = "*💳 Your Saved Bank Accounts:*\n\n";

              if (
                !customer.bankAccounts ||
                customer.bankAccounts.length === 0
              ) {
                bankMsg += "_No bank accounts saved yet._\n\n";
              } else {
                customer.bankAccounts.forEach((bank, i) => {
                  bankMsg += `${i + 1}. ${
                    bank.bankName
                  }\n   Account: ${bank.accountNumber.substring(0, 4)}xxxx (${
                    bank.accountHolderName
                  })\n`;
                });
                bankMsg += "\n";
              }

              bankMsg +=
                "What would you like to do?\n\n" +
                "1. Add a new bank account\n" +
                "2. Edit an existing bank account\n" +
                "3. Remove a bank account\n" +
                "4. Return to Profile";

              await sendWhatsAppMessage(phoneNumber, bankMsg);
              break;

            case "6":
              // Return to main menu
              await sendMainMenu(phoneNumber, customer);
              break;
          }
        } else {
          // Invalid input or default prompt resend
          let updatedProfileMessage =
            `👤 *Your Profile* 👤\n\n` +
            `Name: ${customer.name}\n` +
            `📱 Master Number: ${cleanPhoneNumber(
              customer.phoneNumber?.[0] || ""
            )}\n`;

          if (customer.phoneNumber.length > 1) {
            updatedProfileMessage += `🔗 Connected Numbers:\n`;
            customer.phoneNumber.slice(1).forEach((num, index) => {
              updatedProfileMessage += `   ${index + 1}. ${cleanPhoneNumber(
                num
              )}\n`;
            });
          }

          updatedProfileMessage +=
            `Email: ${customer.contextData?.email || "Not provided"}\n\n` +
            `Total Orders: ${customer.orderHistory.length}\n` +
            `Referral Code: ${
              customer.referralCode ||
              "CM" + customer._id.toString().substring(0, 6)
            }\n\n` +
            `What would you like to do?\n\n` +
            `1. Update Name\n` +
            `2. Update Email\n` +
            `3. Manage Addresses\n` +
            `4. My Account \n` +
            `5. Manage Bank Accounts\n` +
            `6. Return to Main Menu`;

          await sendWhatsAppMessage(phoneNumber, updatedProfileMessage);
        }
        break;

      // Bank Account Management Cases
      case "manage_bank_accounts":
        switch (text.trim()) {
          case "1":
            // Add new bank account - first step: ask for account holder name
            customer.updateConversationState("add_bank_holder_name");
            await sendWhatsAppMessage(
              phoneNumber,
              "Please enter the account holder name:"
            );
            break;

          case "2":
            // Edit existing bank account
            if (!customer.bankAccounts || customer.bankAccounts.length === 0) {
              await sendWhatsAppMessage(
                phoneNumber,
                "You don't have any saved bank accounts to edit. Would you like to add one?\n\n1. Add a new bank account\n2. Return to Profile"
              );
              break;
            }

            customer.updateConversationState("edit_bank_select");
            let editMsg = "*Select a bank account to edit:*\n\n";

            customer.bankAccounts.forEach((bank, i) => {
              editMsg += `${i + 1}. ${bank.bankName} (${
                bank.accountHolderName
              })\n`;
            });

            await sendWhatsAppMessage(phoneNumber, editMsg);
            break;

          case "3":
            // Remove bank account
            if (!customer.bankAccounts || customer.bankAccounts.length === 0) {
              await sendWhatsAppMessage(
                phoneNumber,
                "You don't have any saved bank accounts to remove.\n\nReturning to bank accounts menu..."
              );

              setTimeout(async () => {
                await customer.updateConversationState("manage_bank_accounts");
                let bankMsg = "*💳 Your Saved Bank Accounts:*\n\n";
                bankMsg += "_No bank accounts saved yet._\n\n";

                bankMsg +=
                  "What would you like to do?\n\n" +
                  "1. Add a new bank account\n" +
                  "2. Edit an existing bank account\n" +
                  "3. Remove a bank account\n" +
                  "4. Return to Profile";

                await sendWhatsAppMessage(phoneNumber, bankMsg);
              }, 1500);
              break;
            }

            customer.updateConversationState("remove_bank_account");
            let removeMsg = "*Select a bank account to remove:*\n\n";

            customer.bankAccounts.forEach((bank, i) => {
              removeMsg += `${i + 1}. ${
                bank.bankName
              } - Account: ${bank.accountNumber.substring(0, 4)}xxxx (${
                bank.accountHolderName
              })\n`;
            });

            await sendWhatsAppMessage(phoneNumber, removeMsg);
            break;

          case "4":
            // Return to profile
            customer.updateConversationState("profile");
            await sendWhatsAppMessage(phoneNumber, "Returning to profile...");

            // Return to profile with delay
            setTimeout(async () => {
              await customer.updateConversationState("profile");
              let updatedProfileMessage =
                `👤 *Your Profile* 👤\n\n` +
                `Name: ${customer.name}\n` +
                `📱 Master Number: ${cleanPhoneNumber(
                  customer.phoneNumber?.[0] || ""
                )}\n`;

              if (customer.phoneNumber.length > 1) {
                updatedProfileMessage += `🔗 Connected Numbers:\n`;
                customer.phoneNumber.slice(1).forEach((num, index) => {
                  updatedProfileMessage += `   ${index + 1}. ${cleanPhoneNumber(
                    num
                  )}\n`;
                });
              }

              updatedProfileMessage +=
                `Email: ${customer.contextData?.email || "Not provided"}\n\n` +
                `Total Orders: ${customer.orderHistory.length}\n` +
                `Referral Code: ${
                  customer.referralCode ||
                  "CM" + customer._id.toString().substring(0, 6)
                }\n\n` +
                `What would you like to do?\n\n` +
                `1. Update Name\n` +
                `2. Update Email\n` +
                `3. Manage Addresses\n` +
                `4. My Account \n` +
                `5. Manage Bank Accounts\n` +
                `6. Return to Main Menu`;

              await sendWhatsAppMessage(phoneNumber, updatedProfileMessage);
            }, 1500);
            break;

          default:
            await sendWhatsAppMessage(
              phoneNumber,
              "Invalid input. Please choose 1, 2, 3 or 4."
            );
        }
        break;

      case "remove_bank_account":
        const removeIndex = parseInt(text.trim()) - 1;

        if (
          isNaN(removeIndex) ||
          removeIndex < 0 ||
          !customer.bankAccounts ||
          removeIndex >= customer.bankAccounts.length
        ) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid selection. Please enter a valid number from the list."
          );
          break;
        }

        const removedBank = customer.bankAccounts.splice(removeIndex, 1)[0];
        customer.markModified("bankAccounts");

        await customer.save();

        await customer.updateConversationState("manage_bank_accounts");

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Removed bank: *${removedBank.bankName}* (${removedBank.accountHolderName})`
        );

        // Then re-show the updated list (optional but recommended)
        setTimeout(async () => {
          let bankMsg = "*💳 Your Saved Bank Accounts:*\n\n";

          if (!customer.bankAccounts || customer.bankAccounts.length === 0) {
            bankMsg += "_No bank accounts saved yet._\n\n";
          } else {
            customer.bankAccounts.forEach((bank, i) => {
              bankMsg += `${i + 1}. ${
                bank.bankName
              }\n   Account: ${bank.accountNumber.substring(0, 4)}xxxx (${
                bank.accountHolderName
              })\n`;
            });
            bankMsg += "\n";
          }

          bankMsg +=
            "What would you like to do?\n\n" +
            "1. Add a new bank account\n" +
            "2. Edit an existing bank account\n" +
            "3. Remove a bank account\n" +
            "4. Return to Profile";

          await sendWhatsAppMessage(phoneNumber, bankMsg);
        }, 800);
        break;

      // Add bank account flow
      case "add_bank_holder_name":
        // Save the account holder name and proceed to bank selection
        customer.contextData = customer.contextData || {};
        customer.contextData.tempBankAccount =
          customer.contextData.tempBankAccount || {};
        customer.contextData.tempBankAccount.accountHolderName = text.trim();
        customer.markModified("contextData");
        await customer.save();

        // Move to bank selection
        customer.updateConversationState("add_bank_select");

        // Show loading message
        await sendWhatsAppMessage(phoneNumber, "*Loading bank list...*");

        // Send the bank list after a short delay
        setTimeout(async () => {
          const bankListToSave = `
*Select a bank:*

2 - Bank Rakyat Indonesia (BRI)
3 - Bank Ekspor Indonesia
8 - Bank Mandiri
9 - Bank Negara Indonesia (BNI)
11 - Bank Danamon Indonesia
13 - Bank Permata
14 - Bank Central Asia (BCA)
16 - Bank Maybank
19 - Bank Panin
20 - Bank Arta Niaga Kencana
22 - Bank CIMB Niaga
23 - Bank UOB Indonesia
26 - Bank Lippo
28 - Bank OCBC NISP
30 - American Express Bank LTD
31 - Citibank
32 - JP. Morgan Chase Bank, N.A
33 - Bank of America, N.A
36 - Bank Multicor
37 - Bank Artha Graha
47 - Bank Pesona Perdania
52 - Bank ABN Amro
53 - Bank Keppel Tatlee Buana
57 - Bank BNP Paribas Indonesia
68 - Bank Woori Indonesia
76 - Bank Bumi Arta
87 - Bank Ekonomi
89 - Bank Haga
93 - Bank IFI
95 - Bank Century/Bank J Trust Indonesia
97 - Bank Mayapada
110 - Bank BJB
111 - Bank DKI
112 - Bank BPD D.I.Y
113 - Bank Jateng
114 - Bank Jatim
115 - Bank Jambi
116 - Bank Aceh
117 - Bank Sumut
118 - Bank Sumbar
119 - Bank Kepri
120 - Bank Sumsel dan Babel
121 - Bank Lampung
122 - Bank Kalsel
123 - Bank Kalbar
124 - Bank Kaltim
125 - Bank Kalteng
126 - Bank Sulsel
127 - Bank Sulut
128 - Bank NTB
129 - Bank Bali
130 - Bank NTT
131 - Bank Maluku
132 - Bank Papua
133 - Bank Bengkulu
134 - Bank Sulteng
135 - Bank Sultra
137 - Bank Banten
145 - Bank Nusantara Parahyangan
146 - Bank Swadesi
147 - Bank Muamalat
151 - Bank Mestika
152 - Bank Metro Express
157 - Bank Maspion
159 - Bank Hagakita
161 - Bank Ganesha
162 - Bank Windu Kentjana
164 - Bank ICBC Indonesia
166 - Bank Harmoni Internasional
167 - Bank QNB
200 - Bank Tabungan Negara (BTN)
405 - Bank Swaguna
425 - Bank BJB Syariah
426 - Bank Mega
441 - Bank Bukopin
451 - Bank Syariah Indonesia (BSI)
459 - Bank Bisnis Internasional
466 - Bank Sri Partha
484 - Bank KEB Hana Indonesia
485 - Bank MNC Internasional
490 - Bank Neo
494 - Bank BNI Agro
503 - Bank Nobu
506 - Bank Mega Syariah
513 - Bank Ina Perdana
517 - Bank Panin Dubai Syariah
521 - Bank Bukopin Syariah
523 - Bank Sahabat Sampoerna
535 - SeaBank
536 - Bank BCA Syariah
542 - Bank Jago
547 - Bank BTPN Syariah
553 - Bank Mayora
555 - Bank Index Selindo
947 - Bank Aladin Syariah

1 - Other (enter manually)
`;
          await sendWhatsAppMessage(phoneNumber, bankListToSave);
        }, 1000);
        break;

      case "add_bank_select":
        const allBankOptions = {
          2: "Bank Rakyat Indonesia (BRI)",
          3: "Bank Ekspor Indonesia",
          8: "Bank Mandiri",
          9: "Bank Negara Indonesia (BNI)",
          11: "Bank Danamon Indonesia",
          13: "Bank Permata",
          14: "Bank Central Asia (BCA)",
          16: "Bank Maybank",
          19: "Bank Panin",
          20: "Bank Arta Niaga Kencana",
          22: "Bank CIMB Niaga",
          23: "Bank UOB Indonesia",
          26: "Bank Lippo",
          28: "Bank OCBC NISP",
          30: "American Express Bank LTD",
          31: "Citibank",
          32: "JP. Morgan Chase Bank, N.A",
          33: "Bank of America, N.A",
          36: "Bank Multicor",
          37: "Bank Artha Graha",
          47: "Bank Pesona Perdania",
          52: "Bank ABN Amro",
          53: "Bank Keppel Tatlee Buana",
          57: "Bank BNP Paribas Indonesia",
          68: "Bank Woori Indonesia",
          76: "Bank Bumi Arta",
          87: "Bank Ekonomi",
          89: "Bank Haga",
          93: "Bank IFI",
          95: "Bank Century/Bank J Trust Indonesia",
          97: "Bank Mayapada",
          110: "Bank BJB",
          111: "Bank DKI",
          112: "Bank BPD D.I.Y",
          113: "Bank Jateng",
          114: "Bank Jatim",
          115: "Bank Jambi",
          116: "Bank Aceh",
          117: "Bank Sumut",
          118: "Bank Sumbar",
          119: "Bank Kepri",
          120: "Bank Sumsel dan Babel",
          121: "Bank Lampung",
          122: "Bank Kalsel",
          123: "Bank Kalbar",
          124: "Bank Kaltim",
          125: "Bank Kalteng",
          126: "Bank Sulsel",
          127: "Bank Sulut",
          128: "Bank NTB",
          129: "Bank Bali",
          130: "Bank NTT",
          131: "Bank Maluku",
          132: "Bank Papua",
          133: "Bank Bengkulu",
          134: "Bank Sulteng",
          135: "Bank Sultra",
          137: "Bank Banten",
          145: "Bank Nusantara Parahyangan",
          146: "Bank Swadesi",
          147: "Bank Muamalat",
          151: "Bank Mestika",
          152: "Bank Metro Express",
          157: "Bank Maspion",
          159: "Bank Hagakita",
          161: "Bank Ganesha",
          162: "Bank Windu Kentjana",
          164: "Bank ICBC Indonesia",
          166: "Bank Harmoni Internasional",
          167: "Bank QNB",
          200: "Bank Tabungan Negara (BTN)",
          405: "Bank Swaguna",
          425: "Bank BJB Syariah",
          426: "Bank Mega",
          441: "Bank Bukopin",
          451: "Bank Syariah Indonesia (BSI)",
          459: "Bank Bisnis Internasional",
          466: "Bank Sri Partha",
          484: "Bank KEB Hana Indonesia",
          485: "Bank MNC Internasional",
          490: "Bank Neo",
          494: "Bank BNI Agro",
          503: "Bank Nobu",
          506: "Bank Mega Syariah",
          513: "Bank Ina Perdana",
          517: "Bank Panin Dubai Syariah",
          521: "Bank Bukopin Syariah",
          523: "Bank Sahabat Sampoerna",
          535: "SeaBank",
          536: "Bank BCA Syariah",
          542: "Bank Jago",
          547: "Bank BTPN Syariah",
          553: "Bank Mayora",
          555: "Bank Index Selindo",
          947: "Bank Aladin Syariah",
        };

        if (text.trim() === "1") {
          // User wants to enter custom bank name
          customer.updateConversationState("add_bank_manual");
          await sendWhatsAppMessage(
            phoneNumber,
            "Please enter the custom bank name:"
          );
          break;
        }

        const selectedBank = allBankOptions[text.trim()];
        if (selectedBank) {
          // Save the selected bank name and proceed to account number
          customer.contextData = customer.contextData || {};
          customer.contextData.tempBankAccount =
            customer.contextData.tempBankAccount || {};
          customer.contextData.tempBankAccount.bankName = selectedBank;
          customer.markModified("contextData");
          await customer.save();

          // Move to account number input
          customer.updateConversationState("add_bank_account_number");
          await sendWhatsAppMessage(
            phoneNumber,
            "Please enter the account number:"
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid selection. Please enter a valid number from the list."
          );
        }
        break;

      case "add_bank_manual":
        // Save custom bank name and proceed to account number
        customer.contextData = customer.contextData || {};
        customer.contextData.tempBankAccount =
          customer.contextData.tempBankAccount || {};
        customer.contextData.tempBankAccount.bankName = text.trim();
        customer.markModified("contextData");
        await customer.save();

        // Move to account number input
        customer.updateConversationState("add_bank_account_number");
        await sendWhatsAppMessage(
          phoneNumber,
          "Please enter the account number:"
        );
        break;

      case "add_bank_account_number":
        // Save the account number and confirm all details
        const accountNumber = text.trim();

        // Simple validation for account number
        if (!/^\d{5,20}$/.test(accountNumber)) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid account number. Please enter a valid numeric account number (5-20 digits):"
          );
          break;
        }

        customer.contextData = customer.contextData || {};
        customer.contextData.tempBankAccount =
          customer.contextData.tempBankAccount || {};
        customer.contextData.tempBankAccount.accountNumber = accountNumber;
        customer.markModified("contextData");
        await customer.save();

        // Show confirmation of all details
        const tempBank = customer.contextData.tempBankAccount;
        customer.updateConversationState("add_bank_confirmation");

        await sendWhatsAppMessage(
          phoneNumber,
          `*Please confirm your bank details:*\n\n` +
            `Account Holder: ${tempBank.accountHolderName}\n` +
            `Bank: ${tempBank.bankName}\n` +
            `Account Number: ${tempBank.accountNumber}\n\n` +
            `Is this correct?\n` +
            `1. Yes, save these details\n` +
            `2. No, I need to make changes`
        );
        break;

      case "add_bank_confirmation":
        if (text.trim() === "1" || text.toLowerCase().includes("yes")) {
          // Initialize bankAccounts array if it doesn't exist
          if (!customer.bankAccounts) {
            customer.bankAccounts = [];
          }

          // Add the new bank account
          const newBankAccount = {
            accountHolderName:
              customer.contextData.tempBankAccount.accountHolderName,
            bankName: customer.contextData.tempBankAccount.bankName,
            accountNumber: customer.contextData.tempBankAccount.accountNumber,
          };

          customer.bankAccounts.push(newBankAccount);
          customer.markModified("bankAccounts");

          // Clear temporary data
          delete customer.contextData.tempBankAccount;
          customer.markModified("contextData");

          await customer.save();

          // Show success message
          await sendWhatsAppMessage(
            phoneNumber,
            "✅ Bank account added successfully!"
          );

          // Return to bank account management menu
          customer.updateConversationState("manage_bank_accounts");

          setTimeout(async () => {
            let bankMsg = "*💳 Your Saved Bank Accounts:*\n\n";

            customer.bankAccounts.forEach((bank, i) => {
              bankMsg += `${i + 1}. ${
                bank.bankName
              }\n   Account: ${bank.accountNumber.substring(0, 4)}xxxx (${
                bank.accountHolderName
              })\n`;
            });

            bankMsg +=
              "\nWhat would you like to do?\n\n" +
              "1. Add a new bank account\n" +
              "2. Edit an existing bank account\n" +
              "3. Remove a bank account\n" +
              "4. Return to Profile";

            await sendWhatsAppMessage(phoneNumber, bankMsg);
          }, 1000);
        } else if (text.trim() === "2" || text.toLowerCase().includes("no")) {
          // Ask which part they want to edit
          customer.updateConversationState("add_bank_edit_choice");
          await sendWhatsAppMessage(
            phoneNumber,
            "Which information would you like to change?\n\n" +
              "1. Account Holder Name\n" +
              "2. Bank\n" +
              "3. Account Number\n" +
              "4. Cancel and return to bank management"
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Invalid input. Please enter 1 (Yes) or 2 (No)."
          );
        }
        break;

      case "add_bank_edit_choice":
        switch (text.trim()) {
          case "1":
            // Edit account holder name
            customer.updateConversationState("add_bank_holder_name");
            await sendWhatsAppMessage(
              phoneNumber,
              "Please enter the account holder name:"
            );
            break;

          case "2":
            // Edit bank name - show bank selection again
            customer.updateConversationState("add_bank_select");
            await sendWhatsAppMessage(phoneNumber, "*Loading bank list...*");

            setTimeout(async () => {
              const bankListToSave = `
*Select a bank:*

2 - Bank Rakyat Indonesia (BRI)
3 - Bank Ekspor Indonesia
8 - Bank Mandiri
9 - Bank Negara Indonesia (BNI)
11 - Bank Danamon Indonesia
13 - Bank Permata
14 - Bank Central Asia (BCA)
16 - Bank Maybank
19 - Bank Panin
20 - Bank Arta Niaga Kencana
22 - Bank CIMB Niaga
23 - Bank UOB Indonesia
26 - Bank Lippo
28 - Bank OCBC NISP
30 - American Express Bank LTD
31 - Citibank
32 - JP. Morgan Chase Bank, N.A
33 - Bank of America, N.A
36 - Bank Multicor
37 - Bank Artha Graha
47 - Bank Pesona Perdania
52 - Bank ABN Amro
53 - Bank Keppel Tatlee Buana
57 - Bank BNP Paribas Indonesia
68 - Bank Woori Indonesia
76 - Bank Bumi Arta
87 - Bank Ekonomi
89 - Bank Haga
93 - Bank IFI
95 - Bank Century/Bank J Trust Indonesia
97 - Bank Mayapada
110 - Bank BJB
111 - Bank DKI
112 - Bank BPD D.I.Y
113 - Bank Jateng
114 - Bank Jatim
115 - Bank Jambi
116 - Bank Aceh
117 - Bank Sumut
118 - Bank Sumbar
119 - Bank Kepri
120 - Bank Sumsel dan Babel
121 - Bank Lampung
122 - Bank Kalsel
123 - Bank Kalbar
124 - Bank Kaltim
125 - Bank Kalteng
126 - Bank Sulsel
127 - Bank Sulut
128 - Bank NTB
129 - Bank Bali
130 - Bank NTT
131 - Bank Maluku
132 - Bank Papua
133 - Bank Bengkulu
134 - Bank Sulteng
135 - Bank Sultra
137 - Bank Banten
145 - Bank Nusantara Parahyangan
146 - Bank Swadesi
147 - Bank Muamalat
151 - Bank Mestika
152 - Bank Metro Express
157 - Bank Maspion
159 - Bank Hagakita
161 - Bank Ganesha
162 - Bank Windu Kentjana
164 - Bank ICBC Indonesia
166 - Bank Harmoni Internasional
167 - Bank QNB
200 - Bank Tabungan Negara (BTN)
405 - Bank Swaguna
425 - Bank BJB Syariah
426 - Bank Mega
441 - Bank Bukopin
451 - Bank Syariah Indonesia (BSI)
459 - Bank Bisnis Internasional
466 - Bank Sri Partha
484 - Bank KEB Hana Indonesia
485 - Bank MNC Internasional
490 - Bank Neo
494 - Bank BNI Agro
503 - Bank Nobu
506 - Bank Mega Syariah
513 - Bank Ina Perdana
517 - Bank Panin Dubai Syariah
521 - Bank Bukopin Syariah
523 - Bank Sahabat Sampoerna
535 - SeaBank
536 - Bank BCA Syariah
542 - Bank Jago
547 - Bank BTPN Syariah
553 - Bank Mayora
555 - Bank Index Selindo
947 - Bank Aladin Syariah

1 - Other (enter manually)
`;
              await sendWhatsAppMessage(phoneNumber, bankListToSave);
            }, 1000);
            break;

          case "3":
            // Edit account number
            customer.updateConversationState("add_bank_account_number");
            await sendWhatsAppMessage(
              phoneNumber,
              "Please enter the account number:"
            );
            break;

          case "4":
            // Cancel and return to bank management
            customer.updateConversationState("manage_bank_accounts");

            // Clear temporary data
            delete customer.contextData.tempBankAccount;
            customer.markModified("contextData");
            await customer.save();

            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Bank account creation canceled. Returning to bank management..."
            );

            setTimeout(async () => {
              let bankMsg = "*💳 Your Saved Bank Accounts:*\n\n";

              if (
                !customer.bankAccounts ||
                customer.bankAccounts.length === 0
              ) {
                bankMsg += "_No bank accounts saved yet._\n\n";
              } else {
                customer.bankAccounts.forEach((bank, i) => {
                  bankMsg += `${i + 1}. ${
                    bank.bankName
                  }\n   Account: ${bank.accountNumber.substring(0, 4)}xxxx (${
                    bank.accountHolderName
                  })\n`;
                });
                bankMsg += "\n";
              }

              bankMsg +=
                "What would you like to do?\n\n" +
                "1. Add a new bank account\n" +
                "2. Edit an existing bank account\n" +
                "3. Remove a bank account\n" +
                "4. Return to Profile";

              await sendWhatsAppMessage(phoneNumber, bankMsg);
            }, 1000);
            break;

          default:
            await sendWhatsAppMessage(
              phoneNumber,
              "Invalid input. Please choose 1, 2, 3, or 4."
            );
        }
        break;

      case "edit_bank_select":
        const editIndex = parseInt(text.trim()) - 1;

        if (
          isNaN(editIndex) ||
          editIndex < 0 ||
          !customer.bankAccounts ||
          editIndex >= customer.bankAccounts.length
        ) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid bank selection. Please enter a valid number from the list."
          );
          break;
        }

        // ✅ Store the selected index for use in next case
        customer.contextData = customer.contextData || {};
        customer.contextData.editBankIndex = editIndex;
        customer.markModified("contextData");
        await customer.save(); // 🔥 THIS is the missing piece

        // ✅ Move to next step
        customer.updateConversationState("edit_bank_field");
        await sendWhatsAppMessage(
          phoneNumber,
          `*Editing Bank Account:*\n` +
            `${customer.bankAccounts[editIndex].bankName} - Account: ${customer.bankAccounts[editIndex].accountNumber} (${customer.bankAccounts[editIndex].accountHolderName})\n\n` +
            `What would you like to edit?\n\n` +
            `1. Account Holder Name\n` +
            `2. Bank Name\n` +
            `3. Account Number\n` +
            `4. Cancel and return to bank management`
        );
        break;

      case "edit_bank_field":
        const editOption = text.trim();
        const bankIndex = customer.contextData?.editBankIndex;

        if (
          bankIndex === null ||
          typeof bankIndex === "undefined" ||
          !customer.bankAccounts ||
          bankIndex >= customer.bankAccounts.length
        ) {
          customer.updateConversationState("manage_bank_accounts");
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Something went wrong. Returning to bank management."
          );
          break;
        }

        switch (editOption) {
          case "1":
            // Edit account holder name
            customer.updateConversationState("edit_bank_account_holder");
            await sendWhatsAppMessage(
              phoneNumber,
              "Please enter the new account holder name:"
            );
            break;

          case "2":
            // Edit bank name - resend bank list
            customer.updateConversationState("edit_bank_name");
            await sendWhatsAppMessage(phoneNumber, "*Loading bank list...*");

            setTimeout(async () => {
              const bankListToSave = `
        *Select a bank:*
        
        2 - Bank Rakyat Indonesia (BRI)
        3 - Bank Ekspor Indonesia
        8 - Bank Mandiri
        9 - Bank Negara Indonesia (BNI)
        11 - Bank Danamon Indonesia
        13 - Bank Permata
        14 - Bank Central Asia (BCA)
        16 - Bank Maybank
        19 - Bank Panin
        22 - Bank CIMB Niaga
        23 - Bank UOB Indonesia
        30 - American Express Bank LTD
        31 - Citibank
        32 - JP. Morgan Chase Bank, N.A
        33 - Bank of America, N.A
        441 - Bank Bukopin
        451 - Bank Syariah Indonesia (BSI)
        503 - Bank Nobu
        535 - SeaBank
        536 - Bank BCA Syariah
        542 - Bank Jago
        547 - Bank BTPN Syariah
        
        1 - Other (enter manually)
                `;
              await sendWhatsAppMessage(phoneNumber, bankListToSave);
            }, 1000);
            break;

          case "3":
            // Edit account number
            customer.updateConversationState("edit_bank_account_number");
            await sendWhatsAppMessage(
              phoneNumber,
              "Please enter the new account number:"
            );
            break;

          case "4":
            // Cancel and return to bank management
            delete customer.contextData.editBankIndex;
            customer.markModified("contextData");
            await customer.save();

            await customer.updateConversationState("manage_bank_accounts");
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Edit cancelled. Returning to bank management..."
            );

            // Show bank management menu
            const bankAccounts = customer.bankAccounts || [];
            let bankMessage = "🏦 *Bank Account Management*\n\n";

            if (bankAccounts.length === 0) {
              bankMessage += "You have no saved bank accounts.\n\n";
              bankMessage += "1. Add New Bank Account\n";
              bankMessage += "2. Return to Profile\n";
              bankMessage += "0. Main Menu";
            } else {
              bankMessage += "*Your Bank Accounts:*\n\n";
              bankAccounts.forEach((account, index) => {
                bankMessage += `${index + 1}. ${account.bankName}\n`;
                bankMessage += `   Account: ${account.accountNumber}\n`;
                bankMessage += `   Name: ${account.accountHolderName}\n`;
                if (account.isDefault) {
                  bankMessage += `   ✅ Default Account\n`;
                }
                bankMessage += `\n`;
              });

              bankMessage += `\n*Options:*\n`;
              bankMessage += `${
                bankAccounts.length + 1
              }. Add New Bank Account\n`;
              bankMessage += `${bankAccounts.length + 2}. Edit an Account\n`;
              bankMessage += `${bankAccounts.length + 3}. Delete an Account\n`;
              bankMessage += `${
                bankAccounts.length + 4
              }. Set Default Account\n`;
              bankMessage += `0. Return to Profile`;
            }

            await sendWhatsAppMessage(phoneNumber, bankMessage);
            break;

          default:
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Invalid input. Please enter 1, 2, 3 or 4."
            );
        }
        break;

      case "edit_bank_account_holder":
        const index = customer.contextData?.editBankIndex;

        if (
          index === null ||
          typeof index === "undefined" ||
          !customer.bankAccounts ||
          index >= customer.bankAccounts.length
        ) {
          customer.updateConversationState("manage_bank_accounts");
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Something went wrong. Returning to bank management."
          );
          break;
        }

        customer.bankAccounts[index].accountHolderName = text.trim();
        customer.markModified("bankAccounts");

        // Clear the temp index BEFORE saving
        delete customer.contextData.editBankIndex;
        customer.markModified("contextData");

        // ✅ Only one save — await and done
        await customer.save();

        customer.updateConversationState("manage_bank_accounts"); // this saves too, but after prior save is done

        await sendWhatsAppMessage(
          phoneNumber,
          "✅ Account holder name updated successfully."
        );
        let updatedProfileMessage =
          `👤 *Your Profile* 👤\n\n` +
          `Name: ${customer.name}\n` +
          `📱 Master Number: ${cleanPhoneNumber(
            customer.phoneNumber?.[0] || ""
          )}\n`;

        if (customer.phoneNumber.length > 1) {
          updatedProfileMessage += `🔗 Connected Numbers:\n`;
          customer.phoneNumber.slice(1).forEach((num, index) => {
            updatedProfileMessage += `   ${index + 1}. ${cleanPhoneNumber(
              num
            )}\n`;
          });
        }

        updatedProfileMessage +=
          `Email: ${customer.contextData?.email || "Not provided"}\n\n` +
          `Total Orders: ${customer.orderHistory.length}\n` +
          `Referral Code: ${
            customer.referralCode ||
            "CM" + customer._id.toString().substring(0, 6)
          }\n\n` +
          `What would you like to do?\n\n` +
          `1. Update Name\n` +
          `2. Update Email\n` +
          `3. Manage Addresses\n` +
          `4. My Account \n` +
          `5. Manage Bank Accounts\n` +
          `6. Return to Main Menu`;

        await sendWhatsAppMessage(phoneNumber, updatedProfileMessage);
        break;

      case "edit_bank_name":
        const allBanks = {
          2: "Bank Rakyat Indonesia (BRI)",
          3: "Bank Ekspor Indonesia",
          8: "Bank Mandiri",
          9: "Bank Negara Indonesia (BNI)",
          11: "Bank Danamon Indonesia",
          13: "Bank Permata",
          14: "Bank Central Asia (BCA)",
          16: "Bank Maybank",
          19: "Bank Panin",
          20: "Bank Arta Niaga Kencana",
          22: "Bank CIMB Niaga",
          23: "Bank UOB Indonesia",
          26: "Bank Lippo",
          28: "Bank OCBC NISP",
          30: "American Express Bank LTD",
          31: "Citibank",
          32: "JP. Morgan Chase Bank, N.A",
          33: "Bank of America, N.A",
          36: "Bank Multicor",
          37: "Bank Artha Graha",
          47: "Bank Pesona Perdania",
          52: "Bank ABN Amro",
          53: "Bank Keppel Tatlee Buana",
          57: "Bank BNP Paribas Indonesia",
          68: "Bank Woori Indonesia",
          76: "Bank Bumi Arta",
          87: "Bank Ekonomi",
          89: "Bank Haga",
          93: "Bank IFI",
          95: "Bank Century/Bank J Trust Indonesia",
          97: "Bank Mayapada",
          110: "Bank BJB",
          111: "Bank DKI",
          112: "Bank BPD D.I.Y",
          113: "Bank Jateng",
          114: "Bank Jatim",
          115: "Bank Jambi",
          116: "Bank Aceh",
          117: "Bank Sumut",
          118: "Bank Sumbar",
          119: "Bank Kepri",
          120: "Bank Sumsel dan Babel",
          121: "Bank Lampung",
          122: "Bank Kalsel",
          123: "Bank Kalbar",
          124: "Bank Kaltim",
          125: "Bank Kalteng",
          126: "Bank Sulsel",
          127: "Bank Sulut",
          128: "Bank NTB",
          129: "Bank Bali",
          130: "Bank NTT",
          131: "Bank Maluku",
          132: "Bank Papua",
          133: "Bank Bengkulu",
          134: "Bank Sulteng",
          135: "Bank Sultra",
          137: "Bank Banten",
          145: "Bank Nusantara Parahyangan",
          146: "Bank Swadesi",
          147: "Bank Muamalat",
          151: "Bank Mestika",
          152: "Bank Metro Express",
          157: "Bank Maspion",
          159: "Bank Hagakita",
          161: "Bank Ganesha",
          162: "Bank Windu Kentjana",
          164: "Bank ICBC Indonesia",
          166: "Bank Harmoni Internasional",
          167: "Bank QNB",
          200: "Bank Tabungan Negara (BTN)",
          405: "Bank Swaguna",
          425: "Bank BJB Syariah",
          426: "Bank Mega",
          441: "Bank Bukopin",
          451: "Bank Syariah Indonesia (BSI)",
          459: "Bank Bisnis Internasional",
          466: "Bank Sri Partha",
          484: "Bank KEB Hana Indonesia",
          485: "Bank MNC Internasional",
          490: "Bank Neo",
          494: "Bank BNI Agro",
          503: "Bank Nobu",
          506: "Bank Mega Syariah",
          513: "Bank Ina Perdana",
          517: "Bank Panin Dubai Syariah",
          521: "Bank Bukopin Syariah",
          523: "Bank Sahabat Sampoerna",
          535: "SeaBank",
          536: "Bank BCA Syariah",
          542: "Bank Jago",
          547: "Bank BTPN Syariah",
          553: "Bank Mayora",
          555: "Bank Index Selindo",
          947: "Bank Aladin Syariah",
          1: "Other (enter manually)",
        };

        const selectedBankName = allBanks[text.trim()];
        const bankIndexToEdit = customer.contextData?.editBankIndex;

        if (
          bankIndexToEdit === null ||
          typeof bankIndexToEdit === "undefined" ||
          !customer.bankAccounts ||
          bankIndexToEdit >= customer.bankAccounts.length
        ) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid session. Returning to bank management..."
          );
          customer.updateConversationState("manage_bank_accounts");
          break;
        }

        if (text.trim() === "1") {
          customer.updateConversationState("edit_bank_manual_entry");
          await sendWhatsAppMessage(
            phoneNumber,
            "Please enter the new bank name manually:"
          );
          break;
        }

        if (!selectedBankName) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid selection. Please enter a valid number from the list."
          );
          break;
        }

        customer.bankAccounts[bankIndexToEdit].bankName = selectedBankName;
        customer.markModified("bankAccounts");

        delete customer.contextData.editBankIndex;
        customer.markModified("contextData");

        await customer.save();
        customer.updateConversationState("manage_bank_accounts");

        await sendWhatsAppMessage(
          phoneNumber,
          "✅ Bank name updated successfully."
        );
        let ProfileMessage =
          `👤 *Your Profile* 👤\n\n` +
          `Name: ${customer.name}\n` +
          `📱 Master Number: ${cleanPhoneNumber(
            customer.phoneNumber?.[0] || ""
          )}\n`;

        if (customer.phoneNumber.length > 1) {
          ProfileMessage += `🔗 Connected Numbers:\n`;
          customer.phoneNumber.slice(1).forEach((num, index) => {
            ProfileMessage += `   ${index + 1}. ${cleanPhoneNumber(num)}\n`;
          });
        }

        ProfileMessage +=
          `Email: ${customer.contextData?.email || "Not provided"}\n\n` +
          `Total Orders: ${customer.orderHistory.length}\n` +
          `Referral Code: ${
            customer.referralCode ||
            "CM" + customer._id.toString().substring(0, 6)
          }\n\n` +
          `What would you like to do?\n\n` +
          `1. Update Name\n` +
          `2. Update Email\n` +
          `3. Manage Addresses\n` +
          `4. My Account \n` +
          `5. Manage Bank Accounts\n` +
          `6. Return to Main Menu`;

        await sendWhatsAppMessage(phoneNumber, ProfileMessage);
        break;
      case "edit_bank_manual_entry":
        const manualBankIndex = customer.contextData?.editBankIndex;

        if (
          manualBankIndex === null ||
          typeof manualBankIndex === "undefined" ||
          !customer.bankAccounts ||
          manualBankIndex >= customer.bankAccounts.length
        ) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid session. Returning to bank management..."
          );
          customer.updateConversationState("manage_bank_accounts");
          break;
        }

        const manualBankName = text.trim();

        if (!manualBankName || manualBankName.length < 3) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Please enter a valid bank name (at least 3 characters)."
          );
          break;
        }

        customer.bankAccounts[manualBankIndex].bankName = manualBankName;
        customer.markModified("bankAccounts");

        delete customer.contextData.editBankIndex;
        customer.markModified("contextData");

        await customer.save();
        customer.updateConversationState("manage_bank_accounts");

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Bank name updated to *${manualBankName}* successfully.`
        );
        break;

      case "edit_bank_account_number":
        const editIdx = customer.contextData?.editBankIndex;

        if (
          editIdx === null ||
          typeof editIdx === "undefined" ||
          !customer.bankAccounts ||
          editIdx >= customer.bankAccounts.length
        ) {
          customer.updateConversationState("manage_bank_accounts");
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Something went wrong. Returning to bank management."
          );
          break;
        }

        const newAccountNumber = text.trim();

        if (!/^\d{5,20}$/.test(newAccountNumber)) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid account number. Please enter a numeric account number (5–20 digits)."
          );
          break;
        }

        customer.bankAccounts[editIdx].accountNumber = newAccountNumber;
        customer.markModified("bankAccounts");

        // Clean up index
        delete customer.contextData.editBankIndex;
        customer.markModified("contextData");

        // ✅ Only call .save() ONCE here, then await it before doing anything else
        await customer.save();

        // ✅ AFTER save, update state
        await customer.updateConversationState("manage_bank_accounts");

        await sendWhatsAppMessage(
          phoneNumber,
          "✅ Account number updated successfully."
        );
        let Message =
          `👤 *Your Profile* 👤\n\n` +
          `Name: ${customer.name}\n` +
          `📱 Master Number: ${cleanPhoneNumber(
            customer.phoneNumber?.[0] || ""
          )}\n`;

        if (customer.phoneNumber.length > 1) {
          Message += `🔗 Connected Numbers:\n`;
          customer.phoneNumber.slice(1).forEach((num, index) => {
            Message += `   ${index + 1}. ${cleanPhoneNumber(num)}\n`;
          });
        }

        Message +=
          `Email: ${customer.contextData?.email || "Not provided"}\n\n` +
          `Total Orders: ${customer.orderHistory.length}\n` +
          `Referral Code: ${
            customer.referralCode ||
            "CM" + customer._id.toString().substring(0, 6)
          }\n\n` +
          `What would you like to do?\n\n` +
          `1. Update Name\n` +
          `2. Update Email\n` +
          `3. Manage Addresses\n` +
          `4. My Account \n` +
          `5. Manage Bank Accounts\n` +
          `6. Return to Main Menu`;

        await sendWhatsAppMessage(phoneNumber, Message);
        break;

      // Enhanced main account menu
      case "account_main":
        switch (text) {
          case "1":
            // Enhanced funds display with real data
            const refundAmount =
              customer.shoppingHistory?.reduce((sum, order) => {
                return (
                  sum +
                  (order.refunds?.reduce(
                    (refSum, refund) => refSum + refund.refundAmount,
                    0
                  ) || 0)
                );
              }, 0) || 0;

            const foremanEarnings =
              customer.commissionTracking?.availableCommission || 0;
            const totalFunds = refundAmount + foremanEarnings;

            await customer.updateConversationState("account_funds");
            await sendWhatsAppMessage(
              phoneNumber,
              `💰 *My Funds* 💰\n\n` +
                `💼 *My Earnings (Foreman)*: Rs. ${foremanEarnings.toFixed(
                  2
                )}\n` +
                `🔄 *My Refunds*: Rs. ${refundAmount.toFixed(2)}\n` +
                `💰 *Total Funds Available*: Rs. ${totalFunds.toFixed(2)}\n\n` +
                `With these funds, you can buy anything you want from our shop — cement, bricks, paint, pipes... even your dreams! 🏗️\n\n` +
                `-------------------------------------------------------\n` +
                `ℹ️ *How to use your funds:*\n` +
                `- Visit our facility center\n` +
                `- Meet with our support team\n` +
                `- Use your funds to order products directly\n` +
                `-------------------------------------------------------\n\n` +
                `0. Return to Main Menu`
            );
            break;

          case "2":
            // Enhanced Foreman submenu with real status
            await customer.updateConversationState("account_forman");

            const isForemanApproved =
              customer.foremanStatus?.isForemanApproved || false;
            const isCommissionEligible =
              customer.foremanStatus?.isCommissionEligible || false;

            let foremanMenuText = `👨‍💼 *Foreman Details* 👨‍💼\n\n`;

            if (isForemanApproved) {
              foremanMenuText += `✅ *Status*: Approved Foreman\n`;
              if (customer.foremanStatus.foremanApprovalDate) {
                foremanMenuText += `📅 *Approved*: ${new Date(
                  customer.foremanStatus.foremanApprovalDate
                ).toLocaleDateString()}\n`;
              }
            } else {
              foremanMenuText += `⏳ *Status*: Not yet approved as Foreman\n`;
            }

            foremanMenuText +=
              `\nPlease select an option:\n\n` +
              `1. Foreman Status Details\n` +
              `2. Commission Details\n` +
              `3. Return to Account Menu`;

            await sendWhatsAppMessage(phoneNumber, foremanMenuText);
            break;

          case "3":
            // Number switching functionality (unchanged)
            if (!customer.phoneNumber || customer.phoneNumber.length === 0) {
              await sendWhatsAppMessage(
                phoneNumber,
                "❌ No linked numbers found."
              );
              break;
            }

            await customer.updateConversationState(
              "universal_number_switch_select"
            );
            let switchListMsg = `🔁 *Switch your Number* 🔁\n`;
            customer.phoneNumber.forEach((num, index) => {
              const label = index === 0 ? " (Current)" : "";
              switchListMsg += `${index + 1}. ${cleanPhoneNumber(
                num
              )}${label}\n`;
            });
            switchListMsg +=
              `\nReply with the index of the number you want to replace.\n\n` +
              `----------------------------------------------------\n` +
              `⚠️ All information will be transferred to the new number and this number will lose access.`;
            await sendWhatsAppMessage(phoneNumber, switchListMsg);
             switchListMsg +=
      
              `enter 0 to return to main menu.`;
            await sendWhatsAppMessage(phoneNumber, switchListMsg);
            break;

          case "4":
            // Return to profile (unchanged functionality)
            await customer.updateConversationState("profile");
            await sendWhatsAppMessage(
              phoneNumber,
              "Returning to your profile..."
            );

            setTimeout(async () => {
              let updatedProfileMessage =
                `👤 *Your Profile* 👤\n\n` +
                `Name: ${customer.name}\n` +
                `📱 Master Number: ${cleanPhoneNumber(
                  customer.phoneNumber?.[0] || ""
                )}\n`;

              if (customer.phoneNumber.length > 1) {
                updatedProfileMessage += `🔗 Connected Numbers:\n`;
                customer.phoneNumber.slice(1).forEach((num, index) => {
                  updatedProfileMessage += `   ${index + 1}. ${cleanPhoneNumber(
                    num
                  )}\n`;
                });
              }

              updatedProfileMessage +=
                `Email: ${customer.contextData?.email || "Not provided"}\n\n` +
                `Total Orders: ${customer.shoppingHistory?.length || 0}\n` +
                `Referral Code: ${customer.referralCode}\n\n` +
                `What would you like to do?\n\n` +
                `1. Update Name\n` +
                `2. Update Email\n` +
                `3. Manage Addresses\n` +
                `4. My Account\n` +
                `5. Manage Bank Accounts\n` +
                `6. Return to Main Menu`;

              await sendWhatsAppMessage(phoneNumber, updatedProfileMessage);
            }, 500);
            break;

          default:
            await sendWhatsAppMessage(
              phoneNumber,
              "Please select a valid option (1-4)."
            );
            break;
        }
        break;

      // Funds submenu handling
      // Funds submenu handling - simplified to show all details at once
      case "account_funds":
        await sendWhatsAppMessage(
          phoneNumber,
          ` *My Funds* \n\n` +
            ` *My Earnings (Forman)*: Rs. 5,200.00\n` +
            ` *My Refunds*: Rs. 1,000.00\n` +
            ` *Total Funds Available*: Rs. 6,200.00\n\n` +
            `With these funds, you can buy anything you want from our shop — cement, bricks, paint, pipes... even dreams \n\n` +
            `4. Return to Main Menu`
        );
        break;

      // Enhanced Foreman submenu handling
      case "account_forman":
        switch (text) {
          case "1":
            // Enhanced Foreman status with real data
            const isForemanApproved =
              customer.foremanStatus?.isForemanApproved || false;
            const foremanApprovalDate =
              customer.foremanStatus?.foremanApprovalDate;

            let statusMessage = `👨‍💼 *Foreman Status* 👨‍💼\n\n`;

            if (isForemanApproved) {
              statusMessage += `✅ *Status*: Approved Foreman\n`;
              if (foremanApprovalDate) {
                statusMessage += `📅 *Approved on*: ${new Date(
                  foremanApprovalDate
                ).toLocaleDateString()}\n`;
              }
              statusMessage += `🎯 *Commission Rate*: ${
                customer.foremanStatus.commissionRate || 5
              }%\n\n`;
              statusMessage += `🎉 Congratulations! You are an approved Foreman.\n`;
              statusMessage += `You can now refer customers and earn rewards!\n\n`;
            } else {
              statusMessage += `⏳ *Status*: Not approved as Foreman\n\n`;
              statusMessage += `You are not currently registered as a Foreman.\n`;
              statusMessage += `To become a Foreman:\n`;
              statusMessage += `• Continue being an active customer\n`;
              statusMessage += `• Refer friends and family\n`;
              statusMessage += `• Contact our support team\n\n`;
            }

            statusMessage += `Type any key to return to Foreman menu.`;
            await sendWhatsAppMessage(phoneNumber, statusMessage);
            break;

          case "2":
            // Enhanced Commission details with real data
            const isCommissionEligible =
              customer.foremanStatus?.isCommissionEligible || false;
            const commissionData = customer.commissionTracking || {
              totalCommissionEarned: 0,
              totalCommissionPaid: 0,
              availableCommission: 0,
            };

            let commissionMessage = `💼 *Commission Details* 💼\n\n`;

            if (isCommissionEligible) {
              commissionMessage += `✅ *Status*: Commission Eligible\n`;
              if (customer.foremanStatus.commissionEligibilityDate) {
                commissionMessage += `📅 *Eligible since*: ${new Date(
                  customer.foremanStatus.commissionEligibilityDate
                ).toLocaleDateString()}\n`;
              }
              commissionMessage += `💰 *Commission Rate*: ${
                customer.foremanStatus.commissionRate || 5
              }%\n\n`;
              commissionMessage += `📊 *Your Commission Summary*:\n`;
              commissionMessage += `• Total Earned: Rs. ${commissionData.totalCommissionEarned.toFixed(
                2
              )}\n`;
              commissionMessage += `• Already Paid: Rs. ${commissionData.totalCommissionPaid.toFixed(
                2
              )}\n`;
              commissionMessage += `• Available: Rs. ${commissionData.availableCommission.toFixed(
                2
              )}\n\n`;

              const successfulReferrals =
                customer.customersReferred?.filter((r) => r.hasPlacedOrder)
                  .length || 0;
              commissionMessage += `👥 *Successful Referrals*: ${successfulReferrals}\n`;
              commissionMessage += `🎯 *Total Referrals*: ${
                customer.customersReferred?.length || 0
              }\n\n`;

              if (commissionData.availableCommission > 0) {
                commissionMessage += `💰 You have commission available for withdrawal!\n`;
              }
            } else {
              commissionMessage += `⏳ *Status*: Not eligible for commission yet\n\n`;
              commissionMessage += `You haven't been approved for commission earning yet.\n`;
              commissionMessage += `Requirements:\n`;
              commissionMessage += `• Must be an approved Foreman\n`;
              commissionMessage += `• Must be manually approved by admin\n`;
              commissionMessage += `• Contact support for eligibility review\n\n`;
              commissionMessage += `💡 *Current Stats*:\n`;
              commissionMessage += `• Referrals Made: ${
                customer.customersReferred?.length || 0
              }\n`;
              commissionMessage += `• Videos Uploaded: ${
                customer.referralvideos?.length || 0
              }\n`;
            }

            commissionMessage += `\n---------------------------------------------------------\n`;
            commissionMessage += `ℹ️ *How to use your commission*:\n`;
            commissionMessage += `- Visit our facility center\n`;
            commissionMessage += `- Meet with support team\n`;
            commissionMessage += `- Use commission to order products\n\n`;
            commissionMessage += `Type any key to return to Foreman menu.`;

            await sendWhatsAppMessage(phoneNumber, commissionMessage);
            break;

          case "3":
            // Return to Account Menu
            await customer.updateConversationState("account_main");
            const refundAmount =
              customer.shoppingHistory?.reduce((sum, order) => {
                return (
                  sum +
                  (order.refunds?.reduce(
                    (refSum, refund) => refSum + refund.refundAmount,
                    0
                  ) || 0)
                );
              }, 0) || 0;
            const foremanEarnings =
              customer.commissionTracking?.availableCommission || 0;

            await sendWhatsAppMessage(
              phoneNumber,
              `💰 *My Account* 💰\n\n` +
                `Please select an option:\n\n` +
                `1. Funds (Rs. ${(refundAmount + foremanEarnings).toFixed(
                  2
                )} available)\n` +
                `2. Foreman (${
                  customer.foremanStatus?.isForemanApproved
                    ? "Approved"
                    : "Not Approved"
                })\n` +
                `3. Switch my number\n` +
                `4. Return to Profile`
            );
            break;

          default:
            // Return to Foreman menu with current status
            const currentStatus = customer.foremanStatus?.isForemanApproved
              ? "Approved"
              : "Not Approved";
            const commissionStatus = customer.foremanStatus
              ?.isCommissionEligible
              ? "Eligible"
              : "Not Eligible";

            await sendWhatsAppMessage(
              phoneNumber,
              `👨‍💼 *Foreman Details* 👨‍💼\n\n` +
                `Current Status: ${currentStatus}\n` +
                `Commission: ${commissionStatus}\n\n` +
                `Please select an option:\n\n` +
                `1. Foreman Status Details\n` +
                `2. Commission Details\n` +
                `3. Return to Account Menu`
            );
            break;
        }
        break;

      case "universal_number_switch_select": {
        let selectedIndex = -1;
        const selection = text.trim();

        if (/^\d+$/.test(selection)) {
          const idx = parseInt(selection) - 1;
          if (idx >= 0 && idx < customer.phoneNumber.length) {
            selectedIndex = idx;
          }
        } else {
          const normalized = cleanPhoneNumber(selection);
          selectedIndex = customer.phoneNumber.findIndex(
            (num) => cleanPhoneNumber(num) === normalized
          );
        }

        if (selectedIndex === -1) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid input. Please enter a valid number or index from the list."
          );
          return;
        }

        // Initialize AND save the index
        customer.set("contextData.numberSwitchIndex", selectedIndex);
        customer.markModified("contextData");
        customer.conversationState = "universal_number_switch_input";
        await customer.save();

        console.log("✅ Saved numberSwitchIndex:", selectedIndex);

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Got it! Now send the *new number* (starting with country code e.g 62 without any spaces and + symbol) you'd like to use instead.`
        );
        break;
      }

      // In your Customer schema, add this field:
      // tempNumberToSwitch: { type: String, default: null },

      // Then modify these case handlers:

      case "universal_number_switch_input": {
        console.log("📦 Loaded contextData:", customer.contextData);

        const switchIdx = customer.contextData?.numberSwitchIndex;
        console.log("Switch index from contextData:", switchIdx);

        if (
          switchIdx === undefined ||
          switchIdx < 0 ||
          switchIdx >= customer.phoneNumber.length
        ) {
          console.error("❌ Invalid or missing switchIdx:", switchIdx);
          await sendWhatsAppMessage(
            phoneNumber,
            `❌ Switch failed. Please start again from the switch menu.`
          );
          await customer.updateConversationState("account_main");
          return;
        }

        const newRaw = text.trim().replace(/[^0-9]/g, "");
        const newFormatted = `${newRaw}@c.us`;
        console.log("New formatted number:", newFormatted);

        if (!/^\d{10,15}$/.test(newRaw)) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Please enter a valid number (10–15 digits)."
          );
          return;
        }

        // Store the new number in a dedicated field
        customer.tempNumberToSwitch = newFormatted;
        console.log("Saving tempNumberToSwitch:", newFormatted);
        customer.conversationState = "universal_number_switch_confirm";
        await customer.save();

        // Verify the data was saved correctly
        console.log(
          "After save - tempNumberToSwitch:",
          customer.tempNumberToSwitch
        );

        await sendWhatsAppMessage(
          phoneNumber,
          `📱 Is this number correct? *${cleanPhoneNumber(
            newFormatted
          )}*\n\n1. Yes, continue\n2. No, I want to edit it`
        );
        break;
      }

      case "universal_number_switch_confirm": {
        console.log("Processing confirmation with input:", text);
        console.log("Current tempNumberToSwitch:", customer.tempNumberToSwitch);

        const answer = text.trim().toLowerCase();

        if (answer === "2" || answer === "no") {
          // User wants to edit the number
          customer.conversationState = "universal_number_switch_input";
          await customer.save();

          await sendWhatsAppMessage(
            phoneNumber,
            `Please enter the *new number* again (starting with country code e.g 62 without any spaces and + symbol):`
          );
          return;
        }

        if (answer !== "1" && answer !== "yes") {
          await sendWhatsAppMessage(
            phoneNumber,
            `Please reply with *1* (Yes) or *2* (No).`
          );
          return;
        }

        // User confirmed the number, now check if it exists in the database
        const switchIdx = customer.contextData?.numberSwitchIndex;
        const newNumber = customer.tempNumberToSwitch;

        console.log("Retrieved switch index:", switchIdx);
        console.log("Retrieved new number:", newNumber);

        if (switchIdx === undefined || switchIdx === null) {
          console.error("Missing switch index in contextData");
          await sendWhatsAppMessage(
            phoneNumber,
            `❌ Switch failed. Missing index information. Please start again from the switch menu.`
          );
          await customer.updateConversationState("account_main");
          return;
        }

        if (!newNumber) {
          console.error("Missing new number in tempNumberToSwitch");
          await sendWhatsAppMessage(
            phoneNumber,
            `❌ Switch failed. Missing new number information. Please start again from the switch menu.`
          );
          await customer.updateConversationState("account_main");
          return;
        }

        try {
          // Check if the number already exists in another account
          const existingCustomer = await Customer.findOne({
            phoneNumber: newNumber,
            _id: { $ne: customer._id }, // Exclude current customer
          });

          if (existingCustomer) {
            console.log("Number already exists in another account");
            await sendWhatsAppMessage(
              phoneNumber,
              `❌ This number is already associated with another account. Please try a different number.`
            );
            customer.conversationState = "universal_number_switch_input";
            await customer.save();
            return;
          }

          // Final warning about account transfer
          customer.conversationState = "universal_number_switch_final_confirm";
          await customer.save();

          await sendWhatsAppMessage(
            phoneNumber,
            `⚠️ *Warning*: All your account progress will be switched to ${cleanPhoneNumber(
              newNumber
            )}. Are you sure?\n\n1. Yes, switch my number\n2. No, cancel\n ------------------------------------------------------------------\nAll the information related to this number will be switched to the new number and the account and information will no longer be available to you on this number
`
          );
        } catch (error) {
          console.error("Error during number existence check:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            `❌ An error occurred during the switch process. Please try again later.`
          );
          await customer.updateConversationState("account_main");
        }
        break;
      }

      case "universal_number_switch_final_confirm": {
        const answer = text.trim().toLowerCase();

        if (answer === "2" || answer === "no") {
          // User canceled the operation
          await sendWhatsAppMessage(
            phoneNumber,
            `✅ Number switch canceled. Returning to Account menu.`
          );
          await customer.updateConversationState("account_main");
          return;
        }

        if (answer !== "1" && answer !== "yes") {
          await sendWhatsAppMessage(
            phoneNumber,
            `Please reply with *1* (Yes) or *2* (No).`
          );
          return;
        }

        // User gave final confirmation, proceed with the switch
        const switchIdx = customer.contextData?.numberSwitchIndex;
        const newNumber = customer.tempNumberToSwitch;

        if (
          switchIdx === undefined ||
          switchIdx < 0 ||
          switchIdx >= customer.phoneNumber.length ||
          !newNumber
        ) {
          console.error("❌ Invalid data for switch:", {
            switchIdx,
            newNumber,
          });
          await sendWhatsAppMessage(
            phoneNumber,
            `❌ Switch failed. Please start again from the switch menu.`
          );
          await customer.updateConversationState("account_main");
          return;
        }

        const oldNumber = customer.phoneNumber[switchIdx];
        customer.phoneNumber[switchIdx] = newNumber;

        // Add to history
        customer.numberLinkedHistory = customer.numberLinkedHistory || [];
        customer.numberLinkedHistory.push({
          number: oldNumber,
          replacedWith: newNumber,
          replacedAt: new Date(),
        });

        // Clear the temporary data
        customer.tempNumberToSwitch = null;
        await customer.updateConversationState("account_main");
        await customer.save();

        // Send notifications as in original code
        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Replaced *${cleanPhoneNumber(
            oldNumber
          )}* with *${cleanPhoneNumber(newNumber)}* successfully.`
        );
        await sendWhatsAppMessage(
          phoneNumber,
          ` All your progress has been shifted to the new number.`
        );
        await sendWhatsAppMessage(
          phoneNumber,
          ` You can start shopping as a new customer with a 'hi' massage with this number !!! .`
        );

        await sendWhatsAppMessage(
          newNumber,
          `🎉  hi ${customer.name} , Your account of  Construction Materials Hub! 🏗️ has been swicthed to this number `
        );
        await sendWhatsAppMessage(
          newNumber,
          `You can continue ordering here with your new  number with the same saved  progress  `
        );
        // Store the old number for verification purpose
        customer.pendingVerificationOldNumber = oldNumber;
        customer.tempVerificationTries = 0;
        await customer.save();

        await sendWhatsAppMessage(
          newNumber,
          `📩 To verify your account, please enter the number (with country code, no + or spaces) from which you switched to this number.`
        );

        await Customer.updateOne(
          { _id: customer._id },
          { conversationState: "verify_switched_number" }
        );

        break;
      }

      case "verify_switched_number": {
        const input = text.trim().replace(/[^0-9]/g, "") + "@c.us";

        if (!customer.pendingVerificationOldNumber) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Something went wrong. Please try again later."
          );
          await customer.updateConversationState("account_main");
          return;
        }

        if (input === customer.pendingVerificationOldNumber) {
          // SUCCESS ✅
          customer.conversationState = "account_main";
          customer.tempVerificationTries = 0;
          customer.pendingVerificationOldNumber = null;
          await customer.save();

          await sendWhatsAppMessage(
            phoneNumber,
            `✅ Verified successfully! You can now continue shopping with this number.`
          );
          await sendMainMenu(phoneNumber, customer);
          return;
        }

        customer.tempVerificationTries += 1;

        if (customer.tempVerificationTries >= 3) {
          // FAILURE ❌ — Revert the switch
          const currentIndex = customer.phoneNumber.findIndex(
            (num) => num === phoneNumber
          );

          if (currentIndex === -1 || !customer.pendingVerificationOldNumber) {
            await sendWhatsAppMessage(
              phoneNumber,
              `❌ Verification failed and we couldn't revert the switch. Please contact support.`
            );
            await customer.updateConversationState("account_main");
            return;
          }

          const failedNumber = customer.phoneNumber[currentIndex];
          const revertNumber = customer.pendingVerificationOldNumber;

          // Replace new number back with old
          customer.phoneNumber[currentIndex] = revertNumber;

          customer.numberLinkedHistory.push({
            number: failedNumber,
            revertedBackTo: revertNumber,
            revertedAt: new Date(),
          });

          customer.tempVerificationTries = 0;
          customer.pendingVerificationOldNumber = null;
          await customer.save();

          // Notify NEW number (failed one)
          await sendWhatsAppMessage(
            phoneNumber,
            `❌ Verification failed. You have been switched back to your original number.`
          );

          // Notify OLD number (restored one)
          await sendWhatsAppMessage(
            revertNumber,
            `⚠️ Verification to switch your number to *${cleanPhoneNumber(
              failedNumber
            )}* failed. You can continue shopping here as usual.`
          );

          await sendMainMenu(revertNumber, customer);
        } else {
          // Try again
          const triesLeft = 3 - customer.tempVerificationTries;
          await customer.save();

          await sendWhatsAppMessage(
            phoneNumber,
            `❌ Incorrect number. You have ${triesLeft} attempt(s) remaining.\n\nPlease enter the number you switched *from*.`
          );
        }
        break;
      }

      case "update_name":
        // Update customer name
        customer.name = text;
        await customer.save();

        await sendWhatsAppMessage(
          phoneNumber,
          `Your name has been updated to ${text}. Returning to profile...`
        );
        // Clean phone number for display by removing @c.us
        const displayPhoneNumber = cleanPhoneNumber(
          customer.phoneNumber?.[0] || phoneNumber
        );
        // Return to profile
        setTimeout(async () => {
          await customer.updateConversationState("profile");
          let updatedProfileMessage =
            `👤 *Your Profile* 👤\n\n` +
            `Name: ${customer.name}\n` +
            `📱 Master Number: ${cleanPhoneNumber(
              customer.phoneNumber?.[0] || ""
            )}\n`;

          if (customer.phoneNumber.length > 1) {
            updatedProfileMessage += `🔗 Connected Numbers:\n`;
            customer.phoneNumber.slice(1).forEach((num, index) => {
              updatedProfileMessage += `   ${index + 1}. ${cleanPhoneNumber(
                num
              )}\n`;
            });
          }

          updatedProfileMessage +=
            `Email: ${customer.contextData?.email || "Not provided"}\n\n` +
            `Total Orders: ${customer.orderHistory.length}\n` +
            `Referral Code: ${
              customer.referralCode ||
              "CM" + customer._id.toString().substring(0, 6)
            }\n\n` +
            `What would you like to do?\n\n` +
            `1. Update Name\n` +
            `2. Update Email\n` +
            `3. Manage Addresses\n` +
            `4. My Account \n` +
            `5. Manage Bank Accounts\n` +
            `6. Return to Main Menu`;

          await sendWhatsAppMessage(phoneNumber, updatedProfileMessage);
        }, 1500);
        break;

      case "update_email":
        // Basic email validation
        const profileEmailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (profileEmailRegex.test(text)) {
          // Update email
          if (!customer.contextData) customer.contextData = {};
          customer.contextData.email = text;
          await customer.save();

          await sendWhatsAppMessage(
            phoneNumber,
            `Your email has been updated to ${text}. Returning to profile...`
          );

          // Return to profile
          setTimeout(async () => {
            await customer.updateConversationState("profile");
            let updatedProfileMessage =
              `👤 *Your Profile* 👤\n\n` +
              `Name: ${customer.name}\n` +
              `📱 Master Number: ${cleanPhoneNumber(
                customer.phoneNumber?.[0] || ""
              )}\n`;

            if (customer.phoneNumber.length > 1) {
              updatedProfileMessage += `🔗 Connected Numbers:\n`;
              customer.phoneNumber.slice(1).forEach((num, index) => {
                updatedProfileMessage += `   ${index + 1}. ${cleanPhoneNumber(
                  num
                )}\n`;
              });
            }

            updatedProfileMessage +=
              `Email: ${customer.contextData?.email || "Not provided"}\n\n` +
              `Total Orders: ${customer.orderHistory.length}\n` +
              `Referral Code: ${
                customer.referralCode ||
                "CM" + customer._id.toString().substring(0, 6)
              }\n\n` +
              `What would you like to do?\n\n` +
              `1. Update Name\n` +
              `2. Update Email\n` +
              `3. Manage Addresses\n` +
              `4. My Account \n` +
              `5. Manage Bank Accounts\n` +
              `6. Return to Main Menu`;

            await sendWhatsAppMessage(phoneNumber, updatedProfileMessage);
          }, 1500);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please enter a valid email address, or type 0 to return to the main menu."
          );
        }
        break;

      // Modify manage_addresses case to include the new option
      case "manage_addresses":
        if (["1", "2", "3", "4"].includes(text)) {
          switch (text) {
            case "1":
              // Start the new step-by-step address collection process
              await customer.updateConversationState(
                "add_address_nickname_step"
              );
              await sendWhatsAppMessage(
                phoneNumber,
                "Let's add a new address step by step.\n\nFirst, please enter a nickname for this address (e.g., 'Home', 'Office', 'Work'):"
              );
              break;

            // Keep other options unchanged
            case "2":
              // Remove address - No changes needed
              if (!customer.addresses || customer.addresses.length === 0) {
                await sendWhatsAppMessage(
                  phoneNumber,
                  "You don't have any addresses to remove."
                );

                // Return to address management
                setTimeout(async () => {
                  await customer.updateConversationState("manage_addresses");
                  await sendWhatsAppMessage(
                    phoneNumber,
                    "What would you like to do?\n\n" +
                      "1. Add a new address\n" +
                      "2. Remove an address\n" +
                      "3. Return to profile\n" +
                      "4. View Addresses"
                  );
                }, 1500);
              } else {
                await customer.updateConversationState("remove_address");
                let removeMessage =
                  "Which address would you like to remove?\n\n";

                customer.addresses.forEach((addr, index) => {
                  removeMessage += `${index + 1}. ${
                    addr.nickname || "Address"
                  }: ${addr.fullAddress || "No address"}\n`;
                });

                await sendWhatsAppMessage(phoneNumber, removeMessage);
              }
              break;

            case "3":
              // Return to profile - No changes needed
              await customer.updateConversationState("profile");
              let updatedProfileMessage =
                `👤 *Your Profile* 👤\n\n` +
                `Name: ${customer.name}\n` +
                `📱 Master Number: ${cleanPhoneNumber(
                  customer.phoneNumber?.[0] || ""
                )}\n`;

              if (customer.phoneNumber.length > 1) {
                updatedProfileMessage += `🔗 Connected Numbers:\n`;
                customer.phoneNumber.slice(1).forEach((num, index) => {
                  updatedProfileMessage += `   ${index + 1}. ${cleanPhoneNumber(
                    num
                  )}\n`;
                });
              }

              updatedProfileMessage +=
                `Email: ${customer.contextData?.email || "Not provided"}\n\n` +
                `Total Orders: ${customer.orderHistory.length}\n` +
                `Referral Code: ${
                  customer.referralCode ||
                  "CM" + customer._id.toString().substring(0, 6)
                }\n\n` +
                `What would you like to do?\n\n` +
                `1. Update Name\n` +
                `2. Update Email\n` +
                `3. Manage Addresses\n` +
                `4. My Account \n` +
                `5. Manage Bank Accounts\n` +
                `6. Return to Main Menu`;

              await sendWhatsAppMessage(phoneNumber, updatedProfileMessage);
              break;

            case "4":
              // View addresses - No changes needed
              if (!customer.addresses || customer.addresses.length === 0) {
                await sendWhatsAppMessage(
                  phoneNumber,
                  "You don't have any saved addresses yet."
                );

                // Return to address management
                setTimeout(async () => {
                  await customer.updateConversationState("manage_addresses");
                  await sendWhatsAppMessage(
                    phoneNumber,
                    "What would you like to do?\n\n" +
                      "1. Add a new address\n" +
                      "2. Remove an address\n" +
                      "3. Return to profile\n" +
                      "4. View Addresses"
                  );
                }, 1500);
              } else {
                await customer.updateConversationState("view_addresses");
                let viewMessage = "Your saved addresses:\n\n";

                customer.addresses.forEach((addr, index) => {
                  viewMessage += `${index + 1}. ${
                    addr.nickname || "Address"
                  }: ${addr.area ? ` (${addr.area})` : ""}\n`;
                });
                viewMessage += "-------------------------------------------";
                viewMessage += "\nBack: return and back";

                viewMessage +=
                  "\n\nEnter the number of the address you want to edit or type 'back' to return.";

                await sendWhatsAppMessage(phoneNumber, viewMessage);
              }
              break;
          }
        } else {
          // Default address management menu display
          console.log(
            "Customer addresses:",
            JSON.stringify(customer.addresses || [])
          );

          await customer.updateConversationState("manage_addresses");
          let addressMessage = "Your saved addresses:\n\n";

          if (!customer.addresses || customer.addresses.length === 0) {
            addressMessage += "You don't have any saved addresses yet.\n\n";
          } else {
            // Iterate through each address and safely access properties
            customer.addresses.forEach((addr, index) => {
              const nickname = addr.nickname || "Address";
              const fullAddress = addr.fullAddress || "No address provided";
              const area = addr.area ? ` (${addr.area})` : "";

              addressMessage += `${
                index + 1
              }. ${nickname}: ${fullAddress}${area}\n`;
            });
            addressMessage += "\n";
          }

          addressMessage +=
            "What would you like to do?\n\n" +
            "1. Add a new address\n" +
            "2. Remove an address\n" +
            "3. Return to profile\n" +
            "4. View Addresses";

          await sendWhatsAppMessage(phoneNumber, addressMessage);
        }
        break;

      // Step 1: Collect nickname
      case "add_address_nickname_step":
        try {
          // Initialize contextData if it doesn't exist
          if (!customer.contextData) {
            customer.contextData = {};
          }

          // Initialize a new empty address in contextData
          customer.contextData.tempAddress = {
            nickname: text,
            fullAddress: "",
            area: "",
            googleMapLink: "",
          };

          // Save the data
          await customer.save();
          console.log("Saved nickname to tempAddress:", text);

          // Move to next step - asking for full address
          await customer.updateConversationState(
            "add_address_fulladdress_step"
          );
          await sendWhatsAppMessage(
            phoneNumber,
            `Great! Your address will be saved as "${text}".\n\nNow, please enter the full address:`
          );
        } catch (error) {
          console.error("Error saving address nickname:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            "Sorry, there was an error. Let's try again."
          );

          // Return to address management
          await customer.updateConversationState("manage_addresses");
        }
        break;

      // UPDATED add_address_fulladdress_step case (modified to show dynamic areas)
      case "add_address_fulladdress_step":
        try {
          // Make sure contextData and tempAddress exist
          if (!customer.contextData || !customer.contextData.tempAddress) {
            // Recover by recreating the contextData
            if (!customer.contextData) {
              customer.contextData = {};
            }

            customer.contextData.tempAddress = {
              nickname: "Address",
              fullAddress: "",
              area: "",
              areaDisplayName: "",
              areaDeliveryFee: 0,
              googleMapLink: "",
            };
          }

          // Save the full address
          customer.contextData.tempAddress.fullAddress = text;
          await customer.save();
          console.log("Saved full address to tempAddress:", text);

          // Move to next step - asking for area with dynamic areas
          await customer.updateConversationState("add_address_area_step");

          // Get active areas and display them
          const activeAreas = await getActiveAreas();
          const areasDisplay = formatAreasForDisplay(activeAreas);

          await sendWhatsAppMessage(
            phoneNumber,
            `Please select your area:\n\n${areasDisplay}`
          );
        } catch (error) {
          console.error("Error saving address fullAddress:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            "Sorry, there was an error. Let's try again from the beginning."
          );

          // Return to address management
          await customer.updateConversationState("manage_addresses");
        }
        break;

      case "add_address_area_step":
        try {
          const activeAreas = await getActiveAreas();
          const selectedIndex = parseInt(text) - 1;

          if (selectedIndex < 0 || selectedIndex >= activeAreas.length) {
            const areasDisplay = formatAreasForDisplay(activeAreas);
            await sendWhatsAppMessage(
              phoneNumber,
              `Please select a valid area number.\n${areasDisplay}`
            );
            return;
          }

          if (!customer.contextData || !customer.contextData.tempAddress) {
            throw new Error("Address information was lost");
          }

          const selectedArea = activeAreas[selectedIndex];
          customer.contextData.tempAddress.area = selectedArea.area;
          customer.contextData.tempAddress.state = selectedArea.state;
          customer.contextData.tempAddress.areaDisplayName = `${selectedArea.state} - ${selectedArea.displayName}`;
          customer.contextData.tempAddress.areaDeliveryFee =
            selectedArea.truckPrice;

          await customer.save();

          await customer.updateConversationState("add_address_maplink_step");
          await sendWhatsAppMessage(
            phoneNumber,
            "Almost done! Finally, please enter a Google Maps link for this address (or type 'none'):"
          );
        } catch (error) {
          console.error("Error saving address area:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            "Sorry, there was an error. Let's try again."
          );
          await customer.updateConversationState("manage_addresses");
        }
        break;
      // Step 4: Collect map link and finalize the address
      case "add_address_maplink_step":
        try {
          // Make sure contextData and tempAddress exist
          if (!customer.contextData || !customer.contextData.tempAddress) {
            throw new Error("Address information was lost. Please start over.");
          }

          // Get the temporary address data
          const tempAddress = customer.contextData.tempAddress;

          // Create the final address object
          const newAddress = {
            nickname: tempAddress.nickname || "Address",
            fullAddress: tempAddress.fullAddress || "No address provided",
            area: tempAddress.area || "",
            googleMapLink: text.toLowerCase() === "none" ? "" : text,
            isDefault: !customer.addresses || customer.addresses.length === 0,
          };

          console.log("Creating final address:", newAddress);

          // Add to addresses array
          if (!customer.addresses) customer.addresses = [];
          customer.addresses.push(newAddress);

          // Clean up temporary data
          delete customer.contextData.tempAddress;
          await customer.save();

          // Send confirmation message
          await sendWhatsAppMessage(
            phoneNumber,
            `Great! Your address "${newAddress.nickname}" has been added${
              newAddress.isDefault ? " and set as your default address" : ""
            }!`
          );

          // Return to address management after a brief delay
          setTimeout(async () => {
            await customer.updateConversationState("manage_addresses");
            let addressMessage = "Your saved addresses:\n\n";

            customer.addresses.forEach((addr, index) => {
              const nickname = addr.nickname || "Address";
              const fullAddress = addr.fullAddress || "No address provided";
              const area = addr.area ? ` (${addr.area})` : "";

              addressMessage += `${index + 1}. ${nickname}: ${area}\n`;
            });
            addressMessage += "\n";

            addressMessage +=
              "What would you like to do?\n\n" +
              "1. Add a new address\n" +
              "2. Remove an address\n" +
              "3. Return to profile\n" +
              "4. View Addresses";

            await sendWhatsAppMessage(phoneNumber, addressMessage);
          }, 1500);
        } catch (error) {
          console.error("Error finalizing address:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            "Sorry, there was an error: " +
              error.message +
              ". Let's try again from the beginning."
          );

          // Return to address management
          await customer.updateConversationState("manage_addresses");
        }
        break;
      case "view_addresses":
        if (text.toLowerCase() === "back") {
          // Return to manage addresses
          await customer.updateConversationState("manage_addresses");

          // Show address management menu
          let addressMessage = "Your saved addresses:\n\n";
          if (!customer.addresses || customer.addresses.length === 0) {
            addressMessage += "You don't have any saved addresses yet.\n\n";
          } else {
            customer.addresses.forEach((addr, index) => {
              const nickname = addr.nickname || "Address";
              const fullAddress = addr.fullAddress || "No address provided";
              const area = addr.area ? ` (${addr.area})` : "";

              addressMessage += `${index + 1}. ${nickname}: ${area}\n`;
            });
            addressMessage += "\n";
          }

          addressMessage +=
            "What would you like to do?\n\n" +
            "1. Add a new address\n" +
            "2. Remove an address\n" +
            "3. Return to profile\n" +
            "4. View Addresses";

          await sendWhatsAppMessage(phoneNumber, addressMessage);
        } else {
          const addressIndex = parseInt(text) - 1;

          // Validate the address index
          if (
            addressIndex >= 0 &&
            customer.addresses &&
            addressIndex < customer.addresses.length
          ) {
            const selectedAddress = customer.addresses[addressIndex];

            // Log the address data for debugging
            console.log(
              `Selected address at index ${addressIndex}:`,
              selectedAddress
            );

            // Save the index for the edit operation
            if (!customer.contextData) {
              customer.contextData = {};
            }
            customer.contextData.editAddressIndex = addressIndex;
            await customer.save();

            // Display full address details
            let detailsMessage = `**Address Details:**\n\n`;
            detailsMessage += `Nickname: ${
              selectedAddress.nickname || "Not set"
            }\n`;
            detailsMessage += `Full Address: ${
              selectedAddress.fullAddress || "Not set"
            }\n`;
            detailsMessage += `Area: ${selectedAddress.area || "Not set"}\n`;
            detailsMessage += `Google Maps Link: ${
              selectedAddress.googleMapLink || "Not set"
            }\n\n`;

            detailsMessage += `What would you like to do?\n`;
            detailsMessage += `-------------\n`;
            detailsMessage += `1. Edit this address\n`;
            detailsMessage += `2. Return to Address List\n`;

            await customer.updateConversationState("address_details_options");
            await sendWhatsAppMessage(phoneNumber, detailsMessage);
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              "Please select a valid address number or type 'back' to return."
            );
          }
        }
        break;

      case "address_details_options":
        if (text === "1") {
          // Verify we have the index saved
          if (
            !customer.contextData ||
            customer.contextData.editAddressIndex === undefined
          ) {
            console.error("Missing address index in contextData");
            await sendWhatsAppMessage(
              phoneNumber,
              "Sorry, we've lost track of which address you're editing. Let's try again."
            );

            await customer.updateConversationState("manage_addresses");
            break;
          }

          const addressIndex = customer.contextData.editAddressIndex;

          // Verify the address index is valid
          if (
            addressIndex < 0 ||
            !customer.addresses ||
            addressIndex >= customer.addresses.length
          ) {
            console.error(`Invalid address index: ${addressIndex}`);
            await sendWhatsAppMessage(
              phoneNumber,
              "Sorry, the address you're trying to edit couldn't be found. Let's try again."
            );

            await customer.updateConversationState("manage_addresses");
            break;
          }

          // Send edit options
          let editMessage = `**What would you like to edit?**\n`;
          editMessage += `-------------\n`;
          editMessage += `1. Nickname\n`;
          editMessage += `2. Full Address\n`;
          editMessage += `3. Area\n`;
          editMessage += `4. Google Maps Link\n`;
          editMessage += `5. Return to Address List\n`;

          await customer.updateConversationState("edit_address_select");
          await sendWhatsAppMessage(phoneNumber, editMessage);
        } else if (text === "2") {
          // Return to address list
          await customer.updateConversationState("view_addresses");
          let viewMessage = "Your saved addresses:\n\n";

          customer.addresses.forEach((addr, index) => {
            const nickname = addr.nickname || "Address";
            const fullAddress = addr.fullAddress || "No address provided";
            const area = addr.area ? ` (${addr.area})` : "";

            viewMessage += `${index + 1}. ${nickname}: ${area}\n`;
          });
          viewMessage += "-------------------------------------------";
          viewMessage += "\nBack: return and back";

          viewMessage +=
            "\n\nEnter the number of the address you want to edit or type 'back' to return.";

          await sendWhatsAppMessage(phoneNumber, viewMessage);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please select a valid option (1 or 2)."
          );
        }
        break;
      // Fixed edit_address_select case - For selecting which field to edit
      case "edit_address_select":
        if (["1", "2", "3", "4", "5"].includes(text)) {
          // Verify we have the index saved
          if (
            !customer.contextData ||
            customer.contextData.editAddressIndex === undefined
          ) {
            console.error("Missing address index in contextData");
            await sendWhatsAppMessage(
              phoneNumber,
              "Sorry, we've lost track of which address you're editing. Let's try again."
            );

            await customer.updateConversationState("manage_addresses");
            break;
          }

          const addressIndex = customer.contextData.editAddressIndex;

          // Verify the address index is valid
          if (
            addressIndex < 0 ||
            !customer.addresses ||
            addressIndex >= customer.addresses.length
          ) {
            console.error(`Invalid address index: ${addressIndex}`);
            await sendWhatsAppMessage(
              phoneNumber,
              "Sorry, the address you're trying to edit couldn't be found. Let's try again."
            );

            await customer.updateConversationState("manage_addresses");
            break;
          }

          if (text === "5") {
            // Return to address list
            await customer.updateConversationState("view_addresses");
            let viewMessage = "Your saved addresses:\n\n";

            customer.addresses.forEach((addr, index) => {
              const nickname = addr.nickname || "Address";
              const fullAddress = addr.fullAddress || "No address provided";
              const area = addr.area ? ` (${addr.area})` : "";

              viewMessage += `${index + 1}. ${nickname}: ${area}\n`;
            });

            viewMessage += "-------------------------------------------";
            viewMessage += "\nBack: return and back";

            viewMessage +=
              "\n\nEnter the number of the address you want to edit or type 'back' to return.";
            await sendWhatsAppMessage(phoneNumber, viewMessage);
          } else {
            // Store which field we're editing
            const editFields = {
              1: "nickname",
              2: "fullAddress",
              3: "area",
              4: "googleMapLink",
            };

            customer.contextData.editAddressField = editFields[text];
            await customer.save();

            // Log debug info
            console.log(
              `Ready to edit ${editFields[text]} for address index ${addressIndex}`
            );

            // Get current value for the field
            const currentValue =
              customer.addresses[addressIndex][editFields[text]] || "Not set";

            // Prompt for new value
            await customer.updateConversationState("edit_address_value");
            await sendWhatsAppMessage(
              phoneNumber,
              `Current ${editFields[text]}: ${currentValue}\n\nPlease enter the new ${editFields[text]}:`
            );
          }
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please select a valid option (1-5)."
          );
        }
        break;

      // Fixed edit_address_value case - For updating the selected field
      case "edit_address_value":
        try {
          // Verify we have the necessary context data
          if (
            !customer.contextData ||
            customer.contextData.editAddressIndex === undefined ||
            !customer.contextData.editAddressField
          ) {
            throw new Error(
              "Missing required context data for editing address"
            );
          }

          // Get the index and field to edit
          const addressIndex = customer.contextData.editAddressIndex;
          const fieldToEdit = customer.contextData.editAddressField;

          // Validate the address index
          if (
            addressIndex < 0 ||
            !customer.addresses ||
            addressIndex >= customer.addresses.length
          ) {
            throw new Error(`Invalid address index: ${addressIndex}`);
          }

          // Log update info
          console.log(
            `Updating address ${addressIndex}, field ${fieldToEdit} to "${text}"`
          );

          // Get the address before update (for logging)
          const beforeUpdate = { ...customer.addresses[addressIndex] };

          // Update the address field
          customer.addresses[addressIndex][fieldToEdit] = text;
          await customer.save();

          // Log the before and after for debugging
          console.log("Address before update:", beforeUpdate);
          console.log(
            "Address after update:",
            customer.addresses[addressIndex]
          );

          // Confirm the update
          await sendWhatsAppMessage(
            phoneNumber,
            `Address ${fieldToEdit} updated successfully!`
          );

          // Show the updated address details
          const updatedAddress = customer.addresses[addressIndex];
          let detailsMessage = `Updated Address Details:\n\n`;
          detailsMessage += `Nickname: ${
            updatedAddress.nickname || "Not set"
          }\n`;
          detailsMessage += `Full Address: ${
            updatedAddress.fullAddress || "Not set"
          }\n`;
          detailsMessage += `Area: ${updatedAddress.area || "Not set"}\n`;
          detailsMessage += `Google Maps Link: ${
            updatedAddress.googleMapLink || "Not set"
          }\n\n`;

          detailsMessage += `What would you like to edit?\n\n`;
          detailsMessage += `1. Nickname\n`;
          detailsMessage += `2. Full Address\n`;
          detailsMessage += `3. Area\n`;
          detailsMessage += `4. Google Maps Link\n`;
          detailsMessage += `5. Return to Address List\n`;

          // Return to edit options
          await customer.updateConversationState("edit_address_select");
          await sendWhatsAppMessage(phoneNumber, detailsMessage);
        } catch (error) {
          console.error("Error updating address:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            `Sorry, there was an error updating your address: ${error.message}. Let's try again.`
          );

          // Return to address management
          await customer.updateConversationState("manage_addresses");
          let addressMessage = "Your saved addresses:\n\n";

          if (!customer.addresses || customer.addresses.length === 0) {
            addressMessage += "You don't have any saved addresses yet.\n\n";
          } else {
            customer.addresses.forEach((addr, index) => {
              const nickname = addr.nickname || "Address";
              const fullAddress = addr.fullAddress || "No address provided";
              const area = addr.area ? ` (${addr.area})` : "";

              addressMessage += `${
                index + 1
              }. ${nickname}: ${fullAddress}${area}\n`;
            });
            addressMessage += "\n";
          }

          addressMessage +=
            "What would you like to do?\n\n" +
            "1. Add a new address\n" +
            "2. Remove an address\n" +
            "3. Return to profile\n" +
            "4. View Addresses";

          await sendWhatsAppMessage(phoneNumber, addressMessage);
        }
        break;
      // Fixed remove_address case - For safely removing an address
      case "remove_address":
        try {
          const removeIndex = parseInt(text) - 1;

          // Validate the address index
          if (isNaN(removeIndex)) {
            await sendWhatsAppMessage(
              phoneNumber,
              "Please enter a number to select which address to remove."
            );
            break;
          }

          // Check if the index is valid
          if (
            removeIndex < 0 ||
            !customer.addresses ||
            removeIndex >= customer.addresses.length
          ) {
            await sendWhatsAppMessage(
              phoneNumber,
              "Please select a valid address number from the list."
            );
            break;
          }

          // Store address info for confirmation message
          const addressToRemove = customer.addresses[removeIndex];
          const removedName = addressToRemove.nickname || "Address";
          const wasDefault = addressToRemove.isDefault || false;

          console.log(
            `Removing address at index ${removeIndex}:`,
            addressToRemove
          );

          // Remove the address
          customer.addresses.splice(removeIndex, 1);

          // If we removed the default address and there are other addresses, set a new default
          if (wasDefault && customer.addresses.length > 0) {
            customer.addresses[0].isDefault = true;
            console.log(`Set new default address:`, customer.addresses[0]);
          }

          // Save changes
          await customer.save();

          // Confirm removal
          await sendWhatsAppMessage(
            phoneNumber,
            `Address "${removedName}" has been removed successfully.`
          );

          // Return to address management after a brief delay
          setTimeout(async () => {
            await customer.updateConversationState("manage_addresses");

            let addressMessage = "Your saved addresses:\n\n";

            if (!customer.addresses || customer.addresses.length === 0) {
              addressMessage += "You don't have any saved addresses yet.\n\n";
            } else {
              customer.addresses.forEach((addr, index) => {
                const nickname = addr.nickname || "Address";
                const fullAddress = addr.fullAddress || "No address provided";
                const area = addr.area ? ` (${addr.area})` : "";

                addressMessage += `${index + 1}. ${nickname}: ${area}\n`;
              });
              addressMessage += "\n";
            }

            addressMessage +=
              "What would you like to do?\n\n" +
              "1. Add a new address\n" +
              "2. Remove an address\n" +
              "3. Return to profile\n" +
              "4. View Addresses";

            await sendWhatsAppMessage(phoneNumber, addressMessage);
          }, 1500);
        } catch (error) {
          console.error("Error removing address:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            `Sorry, there was an error removing the address: ${error.message}. Please try again.`
          );

          await customer.updateConversationState("manage_addresses");
        }
        break;
      // Import the OrderProcessingMiddleware

      // Enhanced order history with shopping history schema
      case "order_history":
        if (customer.shoppingHistory && customer.shoppingHistory.length > 0) {
          await customer.updateConversationState("order_history");

          const orderListMessage = generateEnhancedOrderHistoryList(customer);
          await sendWhatsAppMessage(phoneNumber, orderListMessage);

          await sendWhatsAppMessage(
            phoneNumber,
            "Enter the order number to view details, type 'back' to return to the main menu."
          );

          await customer.addToChatHistory(orderListMessage, "bot");
          await customer.addToChatHistory(
            "Enter the order number to view details, type 'back' to return to the main menu.",
            "bot"
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "You don't have any order history yet. Start shopping to create your first order!"
          );
          await sendMainMenu(phoneNumber, customer);
        }
        break;

      // Enhanced order completion with middleware integration
      case "order_complete":
        try {
          // Prepare order data
          const orderData = {
            orderId:
              customer.latestOrderId || "ORD" + Date.now().toString().slice(-8),
            items: customer.cart.items.map((item) => ({
              ...item,
              isDiscountedProduct: item.isDiscountedProduct || false,
            })),
            totalAmount:
              customer.cart.totalAmount + (customer.cart.deliveryCharge || 0),
            deliveryCharge: customer.cart.deliveryCharge || 0,
            discounts: {
              firstOrderDiscount: customer.cart.firstOrderDiscount || 0,
              ecoDeliveryDiscount: customer.cart.ecoDeliveryDiscount || 0,
              referralDiscount: customer.cart.referralDiscount || 0,
            },
            status: "order-confirmed",
            paymentStatus: "paid",
            paymentMethod:
              customer.contextData?.paymentMethod || "Bank Transfer",
            transactionId: customer.contextData?.transactionId,
            deliveryAddress: customer.cart.deliveryAddress,
            deliveryOption: customer.cart.deliveryOption,
            deliveryLocation: customer.cart.deliveryLocation,
          };

          // Process order using middleware
          const orderResult = await OrderProcessingMiddleware.processNewOrder(
            orderData,
            customer._id
          );

          if (!orderResult.success) {
            throw new Error(orderResult.error);
          }

          // Clear cart and update state
          await customer.emptyCart();
          await customer.updateConversationState("main_menu");

          // Generate confirmation message
          let confirmationMessage = `✅ *Order Confirmed!* ✅\n\n`;
          confirmationMessage += `📦 Order ID: ${orderResult.orderId}\n`;
          confirmationMessage += `💰 Total Amount: ${formatRupiah(
            orderData.totalAmount
          )}\n`;
          confirmationMessage += `🚚 Delivery: ${orderData.deliveryOption}\n`;
          confirmationMessage += `📍 Location: ${orderData.deliveryLocation}\n\n`;

          // Add referral commission info if processed
          if (orderResult.commissionProcessed) {
            confirmationMessage += `💰 Commission of ${formatRupiah(
              orderResult.commissionAmount
            )} processed for referrer: ${orderResult.referrerInfo?.name}\n\n`;
          }

          // Add first-time customer welcome message
          if (customer.isFirstTimeCustomer) {
            confirmationMessage += `🎉 Welcome to our family! This is your first order.\n\n`;
          }

          confirmationMessage += `📱 You can track your order by typing "5" in the main menu.\n\n`;
          confirmationMessage += `Thank you for choosing us! 🙏`;

          await sendWhatsAppMessage(phoneNumber, confirmationMessage);

          // Log successful order processing
          console.log(
            `Order ${orderResult.orderId} processed successfully for customer ${customer.name}`
          );
          if (orderResult.commissionProcessed) {
            console.log(
              `Commission of ${orderResult.commissionAmount} processed for referrer ${orderResult.referrerInfo?.name}`
            );
          }

          // Send main menu after confirmation
          setTimeout(async () => {
            await sendMainMenu(phoneNumber, customer);
          }, 2000);
        } catch (error) {
          console.error("Error completing order:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Error processing your order. Please contact support."
          );

          // Return to cart or main menu on error
          await customer.updateConversationState("main_menu");
          await sendMainMenu(phoneNumber, customer);
        }
        break;

      // New case for order refund processing
      case "process_refund":
        try {
          const {
            orderId,
            refundAmount,
            refundReason,
            refundedItems,
            staffInfo,
          } = customer.contextData;

          const refundData = {
            refundAmount: refundAmount,
            refundReason: refundReason,
            refundedItems: refundedItems || [],
          };

          const refundResult =
            await OrderProcessingMiddleware.processOrderRefund(
              customer._id,
              orderId,
              refundData,
              staffInfo
            );

          if (refundResult.success) {
            await sendWhatsAppMessage(
              phoneNumber,
              `✅ Refund processed successfully!\n\n` +
                `🔄 Refund ID: ${refundResult.refundId}\n` +
                `💰 Amount: ${formatRupiah(refundAmount)}\n` +
                `📝 Reason: ${refundReason}\n\n` +
                `Your refund will be processed within 3-5 business days.`
            );
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              `❌ Error processing refund: ${refundResult.error}`
            );
          }

          await customer.updateConversationState("main_menu");
          await sendMainMenu(phoneNumber, customer);
        } catch (error) {
          console.error("Error in refund processing:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Error processing refund. Please contact support."
          );
        }
        break;

      // New case for order replacement processing
      case "process_replacement":
        try {
          const {
            orderId,
            replacementReason,
            originalItems,
            replacementItems,
            priceDifference,
            staffInfo,
          } = customer.contextData;

          const replacementData = {
            replacementReason: replacementReason,
            originalItems: originalItems || [],
            replacementItems: replacementItems || [],
            priceDifference: priceDifference || 0,
          };

          const replacementResult =
            await OrderProcessingMiddleware.processOrderReplacement(
              customer._id,
              orderId,
              replacementData,
              staffInfo
            );

          if (replacementResult.success) {
            let message = `✅ Replacement processed successfully!\n\n`;
            message += `🔄 Replacement ID: ${replacementResult.replacementId}\n`;
            message += `📝 Reason: ${replacementReason}\n`;

            if (priceDifference > 0) {
              message += `💰 Additional Amount: ${formatRupiah(
                priceDifference
              )}\n`;
            } else if (priceDifference < 0) {
              message += `💰 Refund Amount: ${formatRupiah(
                Math.abs(priceDifference)
              )}\n`;
            }

            message += `\nYour replacement order will be processed shortly.`;

            await sendWhatsAppMessage(phoneNumber, message);
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              `❌ Error processing replacement: ${replacementResult.error}`
            );
          }

          await customer.updateConversationState("main_menu");
          await sendMainMenu(phoneNumber, customer);
        } catch (error) {
          console.error("Error in replacement processing:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Error processing replacement. Please contact support."
          );
        }
        break;

      // New case for adding order corrections
      case "add_order_correction":
        try {
          const {
            orderId,
            originalField,
            originalValue,
            newValue,
            correctionReason,
            staffInfo,
          } = customer.contextData;

          const correctionData = {
            originalField: originalField,
            originalValue: originalValue,
            newValue: newValue,
            correctionReason: correctionReason,
          };

          const correctionResult =
            await OrderProcessingMiddleware.addOrderCorrection(
              customer._id,
              orderId,
              correctionData,
              staffInfo
            );

          if (correctionResult.success) {
            await sendWhatsAppMessage(
              phoneNumber,
              `✅ Order correction added successfully!\n\n` +
                `🔧 Correction ID: ${correctionResult.correctionId}\n` +
                `📝 Field: ${originalField}\n` +
                `📝 Original: ${originalValue}\n` +
                `📝 New: ${newValue}\n` +
                `📝 Reason: ${correctionReason}\n\n` +
                `Correction has been logged and will be reviewed.`
            );
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              `❌ Error adding correction: ${correctionResult.error}`
            );
          }

          await customer.updateConversationState("main_menu");
          await sendMainMenu(phoneNumber, customer);
        } catch (error) {
          console.error("Error adding order correction:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Error adding correction. Please contact support."
          );
        }
        break;

      // New case for viewing order analytics
      case "view_order_analytics":
        try {
          const analyticsResult =
            await OrderProcessingMiddleware.getOrderAnalytics(customer._id);

          if (analyticsResult.success && analyticsResult.analytics.length > 0) {
            const analytics = analyticsResult.analytics[0];

            let analyticsMessage = `📊 *Your Order Analytics* 📊\n\n`;
            analyticsMessage += `👤 Customer: ${analytics.name}\n`;
            analyticsMessage += `📦 Total Orders: ${analytics.totalOrders}\n`;
            analyticsMessage += `💰 Total Spent: ${formatRupiah(
              analytics.totalSpent
            )}\n`;
            analyticsMessage += `🔄 Total Refunded: ${formatRupiah(
              analytics.totalRefunded
            )}\n`;
            analyticsMessage += `📈 Average Order Value: ${formatRupiah(
              analytics.avgOrderValue
            )}\n`;

            if (analytics.isForeman) {
              analyticsMessage += `\n🏆 *Foreman Status* 🏆\n`;
              analyticsMessage += `💼 Commission Eligible: ${
                analytics.isCommissionEligible ? "Yes" : "No"
              }\n`;
              analyticsMessage += `💰 Commission Generated: ${formatRupiah(
                analytics.commissionGenerated
              )}\n`;
            }

            await sendWhatsAppMessage(phoneNumber, analyticsMessage);
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              "📊 No analytics data available yet. Start shopping to see your statistics!"
            );
          }

          await customer.updateConversationState("main_menu");
          await sendMainMenu(phoneNumber, customer);
        } catch (error) {
          console.error("Error viewing analytics:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Error retrieving analytics. Please contact support."
          );
        }
        break;

        // Helper function to generate enhanced order history list (updated to work with middleware)
        function generateEnhancedOrderHistoryList(customer) {
          if (
            !customer.shoppingHistory ||
            customer.shoppingHistory.length === 0
          ) {
            return "📦 *Your Order History* 📦\n\nNo orders found.";
          }

          // Sort orders by date (newest first)
          const sortedOrders = [...customer.shoppingHistory].sort((a, b) => {
            return new Date(b.orderDate) - new Date(a.orderDate);
          });

          let orderList = `📦 *Your Order History* 📦\n\n`;
          orderList += `Total Orders: ${sortedOrders.length}\n\n`;

          sortedOrders.forEach((order, index) => {
            const orderDate = new Date(order.orderDate);
            const statusEmoji = getOrderStatusEmoji(order.status);

            orderList += `${index + 1}. ${statusEmoji} ${order.orderId}\n`;
            orderList += `   💰 ${formatRupiah(order.totalAmount)}\n`;
            orderList += `   📅 ${orderDate.toLocaleDateString()}\n`;
            orderList += `   📊 ${order.status}\n`;

            // Show refund info if applicable
            if (order.refunds && order.refunds.length > 0) {
              const totalRefunded = order.refunds.reduce(
                (sum, refund) => sum + refund.refundAmount,
                0
              );
              orderList += `   🔄 Refunded: ${formatRupiah(totalRefunded)}\n`;
            }

            // Show replacement info if applicable
            if (order.replacements && order.replacements.length > 0) {
              orderList += `   🔄 Replacements: ${order.replacements.length}\n`;
            }

            // Show corrections info if applicable
            if (order.corrections && order.corrections.length > 0) {
              orderList += `   🔧 Corrections: ${order.corrections.length}\n`;
            }

            orderList += `\n`;
          });

          orderList += `\nEnter order number to view details.`;
          return orderList;
        }

        // Helper function to format currency (assuming this exists)
        function formatRupiah(amount) {
          return new Intl.NumberFormat("id-ID", {
            style: "currency",
            currency: "IDR",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(amount);
        }
        // Helper function to get status emoji
        function getOrderStatusEmoji(status) {
          const statusEmojis = {
            "cart-not-paid": "🛒",
            "order-made-not-paid": "⏳",
            "pay-not-confirmed": "💳",
            "order-confirmed": "✅",
            "order not picked": "📋",
            "issue-customer": "⚠️",
            "customer-confirmed": "👍",
            "order-refunded": "🔄",
            "picking-order": "📦",
            "allocated-driver": "🚚",
            "ready to pickup": "📬",
            "order-not-pickedup": "❌",
            "order-pickuped-up": "🚛",
            "on-way": "🛣️",
            "driver-confirmed": "✅",
            "order-processed": "⚙️",
            refund: "💸",
            "complain-order": "❗",
            "issue-driver": "🚨",
            "parcel-returned": "↩️",
            "order-complete": "🎉",
          };
          return statusEmojis[status] || "📦";
        }

      case "order_details":
        const orderNumber = parseInt(text);

        // Check if input is a valid order number
        if (
          customer.orderHistory &&
          customer.orderHistory.length > 0 &&
          orderNumber > 0 &&
          orderNumber <= customer.orderHistory.length
        ) {
          // Orders are sorted newest to oldest, so we need to adjust the index
          const sortedOrders = [...customer.orderHistory].sort((a, b) => {
            return new Date(b.orderDate) - new Date(a.orderDate);
          });

          // Convert from order number to array index
          const orderIndex = orderNumber - 1;
          const order = sortedOrders[orderIndex];

          if (order) {
            // Enhanced order details with more information
            let orderDetails = `📦 *Order #${order.orderId}* 📦\n\n`;

            // Order date and time with better formatting
            const orderDate = new Date(order.orderDate);
            orderDetails += `Date: ${orderDate.toLocaleDateString()} at ${orderDate.toLocaleTimeString()}\n`;

            // Status with emoji indicators
            const statusEmojis = {
              pending: "⏳",
              confirmed: "✅",
              processing: "🔄",
              shipped: "🚚",
              delivered: "📬",
              cancelled: "❌",
            };
            orderDetails += `Status: ${statusEmojis[order.status] || ""} ${
              order.status
            }\n`;

            // Delivery details with more information
            orderDetails += `Delivery: ${order.deliveryType}\n`;
            if (order.deliveryLocation)
              orderDetails += `Location: ${order.deliveryLocation}\n`;

            // Payment info with emoji indicators
            const paymentEmojis = {
              pending: "⏳",
              paid: "",
              failed: "❌",
            };
            orderDetails += `Payment Status: ${
              paymentEmojis[order.paymentStatus] || ""
            } ${order.paymentStatus}\n`;
            orderDetails += `Payment Method: ${
              order.paymentMethod || "Bank Transfer"
            }\n`;

            // Add transaction ID if available
            if (order.transactionId) {
              orderDetails += `Transaction ID: ${order.transactionId}\n`;
            }

            // Add estimated or actual delivery date
            if (order.deliveryDate) {
              const deliveryDate = new Date(order.deliveryDate);
              orderDetails += `${
                order.status === "delivered"
                  ? "Delivered on"
                  : "Estimated delivery"
              }: ${deliveryDate.toLocaleDateString()}\n`;
            }

            orderDetails += `\n📝 *Items Ordered* 📝\n`;

            // Enhanced items list with better formatting
            let subtotal = 0;
            order.items.forEach((item, i) => {
              orderDetails += `${i + 1}. ${item.productName} (${
                item.weight
              })\n`;
              orderDetails += `   • Quantity: ${item.quantity}\n`;
              orderDetails += `   • Unit Price: ${formatRupiah(item.price)}\n`;
              orderDetails += `   • Subtotal: ${formatRupiah(
                item.totalPrice
              )}\n\n`;
              subtotal += item.totalPrice;
            });

            // Detailed cost breakdown
            orderDetails += `📊 *Cost Breakdown* 📊\n`;
            orderDetails += `Subtotal: ${formatRupiah(subtotal)}\n`;

            if (order.deliveryCharge > 0) {
              orderDetails += `Delivery Charge: ${formatRupiah(
                order.deliveryCharge
              )}\n`;
            }

            // Add discounts if applied
            if (order.firstOrderDiscount && order.firstOrderDiscount > 0) {
              orderDetails += `First Order Discount: -${formatRupiah(
                order.firstOrderDiscount
              )}\n`;
            }

            // Final total
            orderDetails += `\n💲 *Total Paid: ${formatRupiah(
              order.totalAmount
            )}* 💲\n\n`;

            orderDetails +=
              "Type 0 to return to main menu or 'back' to view order history list.";

            await sendWhatsAppMessage(phoneNumber, orderDetails);
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              "Order not found. Please try again."
            );

            // Send the order list again
            const orderListMessage = generateOrderHistoryList(customer);
            await sendWhatsAppMessage(phoneNumber, orderListMessage);
          }
        } else if (text.toLowerCase() === "back") {
          await customer.updateConversationState("order_history");

          // Send the order list
          const orderListMessage = generateOrderHistoryList(customer);
          await sendWhatsAppMessage(phoneNumber, orderListMessage);
        } else {
          await sendMainMenu(phoneNumber, customer);
        }
        break;
      case "order_confirmation": {
        // 1) figure out which order we're updating
        let idx = -1;
        const latestId = customer.contextData.latestOrderId;
        if (latestId) {
          idx = customer.orderHistory.findIndex((o) => o.orderId === latestId);
        }
        // fallback to the last order if that lookup failed
        if (idx < 0 && customer.orderHistory.length > 0) {
          idx = customer.orderHistory.length - 1;
        }

        // if we've found an order, update its status
        if (idx >= 0) {
          customer.orderHistory[idx].status = "pay-not-confirmed";
          customer.currentOrderStatus = "pay-not-confirmed";
          await customer.save();
        } else {
          // defensive: nothing to update
          console.error("No order to confirm for", customer.phoneNumber);
        }

        // 2) advance the conversation
        await customer.updateConversationState("order_confirmation");

        // 3) notify the user
        const latestOrder = customer.orderHistory[idx];
        if (latestOrder) {
          await sendWhatsAppMessage(
            phoneNumber,
            `Your order is in progress and will be confirmed once payment is verified\n` +
              `🧾 Order ID: *#${latestOrder.orderId}*\n` +
              `Keep it safe please, ${customer.name}.`
          );
        }

        // 🛒 CLEAR CART AFTER ORDER CONFIRMATION
        customer.cart = {
          items: [],
          totalAmount: 0,
          deliveryCharge: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await customer.save();
        console.log(`Cart cleared for customer: ${customer.phoneNumber}`);

        // 4) self-pickup branch
        if (latestOrder?.deliveryType === "self_pickup") {
          if (latestOrder.totalAmount >= 25_000_000) {
            await sendWhatsAppMessage(
              phoneNumber,
              "🕐 Your order will be ready in 1 hour for pickup!"
            );
          } else if (latestOrder.totalAmount < 2_000_000) {
            await sendWhatsAppMessage(
              phoneNumber,
              "🛍️ Your order is ready for pickup immediately!"
            );
          } else {
            await sendWhatsAppMessage(
              phoneNumber,
              "📦 Your order will be prepared for pickup shortly!"
            );
          }

          await customer.updateConversationState("pickup_date_main");
          await sendWhatsAppMessage(
            phoneNumber,
            "📅 *When are you planning to pick up?*\n" +
              "1. Today\n" +
              "2. Tomorrow\n" +
              "3. Later (choose a custom date within the next 13 days)"
          );
          return; // wait for their reply
        }

        // 5) non-pickup: wrap up & return to main menu
        setTimeout(async () => {
          await sendWhatsAppMessage(
            phoneNumber,
            "Thank you for shopping with us! 😊\n" +
              "Don't forget to share your referral link and check out our discounts for more savings."
          );
          await customer.updateConversationState("main_menu");
          await sendMainMenu(phoneNumber, customer);
        }, 3000);

        break;
      }
      // =============================================================================
      // SIMPLIFIED REFERRAL CASES - Clean and working
      // =============================================================================

      // Enhanced referral case with commission eligibility check
      case "referral":
        // Check if customer can see commission options
        const canSeeCommission =
          customer.foremanStatus?.isCommissionEligible || false;

        let referralIntroMessage = "🎉 Welcome to our Referral Program!\n\n";

        if (canSeeCommission) {
          const commissionRate = customer.foremanStatus?.commissionRate || 5;
          const availableCommission =
            customer.commissionTracking?.availableCommission || 0;

          referralIntroMessage += `💰 You're eligible to earn ${commissionRate}% commission!\n`;
          referralIntroMessage += `💼 Available commission: Rs. ${availableCommission.toFixed(
            2
          )}\n\n`;
        }

        referralIntroMessage +=
          `🎥 Share videos with friends and earn rewards!\n\n` +
          `📱 Please record and send your referral video now\n\n` +
          `📏 Max size: 15MB\n` +
          `⏱️ Keep it under 1 minute for best results!`;

        await sendSequentialMessages(phoneNumber, referralIntroMessage);
        await sendSequentialMessages(
          phoneNumber,
          "📱 Send your video now or type '0' to return to main menu",
          1000
        );
        await sendSequentialMessages(
          phoneNumber,
          "See the video below and follow the instructions to know better what to say",
          1000
        );
        await sendSequentialMessages(
          phoneNumber,
          "What to mention in the video:\n- Mention Your Name\n- What you do\n- Why do you like us",
          1000
        );

        // Send demo video if available
        try {
          const videoSent = await sendActivatedDemoVideo(customer, phoneNumber);
          if (!videoSent) {
            await sendSequentialMessages(
              phoneNumber,
              "❌ No demo video available at the moment. Please proceed with creating your own video.",
              1000
            );
          }
        } catch (error) {
          console.error("Error sending demo video:", error);
          await sendSequentialMessages(
            phoneNumber,
            "❌ Unable to send demo video. Please proceed with creating your own video.",
            1000
          );
        }

        await customer.updateConversationState("create_video");
        break;

      // Debug case to check customersReferred field
      case "check_referrals":
        try {
          const totalReferrals = customer.customersReferred?.length || 0;
          const pendingReferrals =
            customer.referralTracking?.pendingReferrals?.length || 0;
          const registeredReferrals = customer.customersReferred?.length || 0;
          const orderedReferrals =
            customer.customersReferred?.filter((ref) => ref.hasPlacedOrder)
              .length || 0;

          let debugMessage = `🔍 *Referral Debug Info* 🔍\n\n`;
          debugMessage += `👤 Customer: ${customer.name}\n`;
          debugMessage += `📊 Total Confirmed Referrals: ${totalReferrals}\n`;
          debugMessage += `⏳ Pending Referrals: ${pendingReferrals}\n`;
          debugMessage += `✅ Registered: ${registeredReferrals}\n`;
          debugMessage += `🛒 Placed Orders: ${orderedReferrals}\n\n`;

          // Show pending referrals
          if (
            customer.referralTracking?.pendingReferrals &&
            customer.referralTracking.pendingReferrals.length > 0
          ) {
            debugMessage += `📋 *Pending Referrals:*\n`;
            customer.referralTracking.pendingReferrals
              .slice(0, 3)
              .forEach((ref, index) => {
                debugMessage += `${index + 1}. ${ref.phoneNumber} - ${
                  ref.status || "pending"
                }\n`;
                debugMessage += `   Sent: ${
                  ref.dateShared ? ref.dateShared.toDateString() : "N/A"
                }\n`;
              });
            if (customer.referralTracking.pendingReferrals.length > 3) {
              debugMessage += `... and ${
                customer.referralTracking.pendingReferrals.length - 3
              } more pending\n`;
            }
            debugMessage += `\n`;
          }

          // Show confirmed referrals
          if (
            customer.customersReferred &&
            customer.customersReferred.length > 0
          ) {
            debugMessage += `📋 *Confirmed Referrals:*\n`;
            customer.customersReferred.slice(0, 3).forEach((ref, index) => {
              debugMessage += `${index + 1}. ${ref.customerName} (${
                ref.phoneNumber
              })\n`;
              debugMessage += `   Orders: ${
                ref.totalOrdersCount || 0
              }, Spent: Rs. ${ref.totalSpentAmount || 0}\n`;
            });
            if (customer.customersReferred.length > 3) {
              debugMessage += `... and ${
                customer.customersReferred.length - 3
              } more confirmed\n`;
            }
          }

          await sendWhatsAppMessage(phoneNumber, debugMessage);
          await sendMainMenu(phoneNumber, customer);
        } catch (error) {
          console.error("Error checking referrals:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Error checking referrals. Please contact support."
          );
        }
        break;

      case "create_video":
        if (message.hasMedia && message.type === "video") {
          try {
            // 1. Download video buffer directly
            const response = await axios.get(message.media.url, {
              responseType: "arraybuffer",
            });
            const videoBuffer = Buffer.from(response.data, "binary");

            // 2. Convert to Base64
            const base64Video = videoBuffer.toString("base64");
            const videoSizeMB = (base64Video.length * 3) / 4 / (1024 * 1024);

            // 3. Validate size
            if (videoSizeMB > 15) {
              await sendWhatsAppMessage(
                phoneNumber,
                `❌ Video too large (${videoSizeMB.toFixed(
                  1
                )}MB). Max 15MB allowed.`
              );
              break;
            }

            // 4. Save to database
            const videoId = "VID" + Date.now().toString().slice(-6);
            customer.referralvideos.push({
              imageId: videoId,
              mediaType: "video",
              mimetype: message.media.mimetype || "video/mp4",
              filename: `referral_${videoId}.mp4`,
              base64Data: base64Video,
              fileSize: videoSizeMB,
              approvalDate: new Date(),
              status: "unverified",
              sharedWith: [], // Initialize empty array
            });

            await customer.save();

            // 5. Confirm receipt
            await sendSequentialMessages(
              phoneNumber,
              `✅ Video received (${videoSizeMB.toFixed(1)}MB)`,
              "📱 Now send recipient's phone number\nExample: 03001234567",
              1000
            );
            await customer.updateConversationState("add_contact");
          } catch (error) {
            console.error("Video processing error:", error);
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Failed to process video. Please try again."
            );
          }
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "🎥 Please send a video file or type '0' to cancel"
          );
          await sendWhatsAppMessage(
            phoneNumber,
            `If the video is large, please allow a little extra time for it to load or upload. Thank you for your patience! Don't worry, it's uploading — please wait up to 3 minutes`
          );
        }
        break;

      case "add_contact":
        if (text === "0") {
          await sendMainMenu(phoneNumber, customer);
          break;
        }

        // Get the latest video
        if (!customer.referralvideos || customer.referralvideos.length === 0) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ No video found. Please create one first."
          );
          await sendMainMenu(phoneNumber, customer);
          break;
        }

        const latestVideo =
          customer.referralvideos[customer.referralvideos.length - 1];
        if (!latestVideo.sharedWith) latestVideo.sharedWith = [];

        // Extract only digits from input
        const rawNumber = text.replace(/\D/g, "");

        // Validate number format (at least 8 digits)
        if (rawNumber.length < 8) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid number! Please send a valid phone number (at least 8 digits)\nExample: 03001234567\n\nOr type '0' to return to main menu"
          );
          break;
        }

        // Prevent sending to self
        const currentUserNumber = phoneNumber
          .replace(/@.*$/, "")
          .replace(/\D/g, "");
        if (rawNumber === currentUserNumber) {
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ You can't send a referral to yourself!\nPlease provide a different phone number."
          );
          break;
        }

        // Check for duplicates
        const existingContact = latestVideo.sharedWith.find((contact) => {
          const contactNumber = contact.phoneNumber.replace(/\D/g, "");
          return contactNumber === rawNumber;
        });

        if (existingContact) {
          await sendWhatsAppMessage(
            phoneNumber,
            "⚠️ This contact was already added!"
          );
          break;
        }

        // ============= NEW CUSTOMER ONLY REFERRAL VALIDATION =============
        // Check if this customer can be referred (new customers only)
        try {
          const referralValidation = await Customer.canBeReferred(rawNumber);
          
          if (!referralValidation.canRefer) {
            let errorMessage = `❌ *Cannot Refer This Customer*\n\n`;
            errorMessage += `📋 Reason: ${referralValidation.reason}\n\n`;
            
            if (referralValidation.existingReferrer) {
              errorMessage += `👤 This customer was already referred by: ${referralValidation.existingReferrer}\n\n`;
            }
            
            errorMessage += `ℹ️ *Referral Rule:*\n`;
            errorMessage += `• Referrals only apply to NEW customers\n`;
            errorMessage += `• Customers already in the system cannot be referred\n\n`;
            errorMessage += `Send another number or type '0' for main menu.`;
            
            await sendWhatsAppMessage(phoneNumber, errorMessage);
            break;
          }
          
          // Log successful validation
          console.log(`✅ Referral Validation Passed for ${rawNumber}: ${referralValidation.reason}`);
          
        } catch (validationError) {
          console.error("Error validating referral:", validationError);
          // Continue with referral if validation fails (fail-open for better UX)
        }
        // ============= END REFERRAL VALIDATION =============

        // Store contact
        const newContact = {
          name: "Contact",
          phoneNumber: rawNumber,
          dateShared: new Date(),
          status: "pending",
        };

        latestVideo.sharedWith.push(newContact);
        await customer.save();

        await sendWhatsAppMessage(
          phoneNumber,
          `✅ Contact added: ${rawNumber}\n\n🚀 Sending your referral now...`
        );

        try {
          console.log("🚀 Attempting to send referral...");
          await sendReferralToContact(customer, latestVideo, newContact);

          // ✅ ONLY UPDATE customersReferred AFTER SUCCESSFUL SEND
          newContact.status = "sent";
          newContact.dateSent = new Date();

          // 🎯 DIRECT REFERRAL PROCESSING - Create referral record ONLY after successful send
          const referralResult = await createReferralRecord(
            customer,
            rawNumber,
            latestVideo.imageId
          );

          if (referralResult.success) {
            console.log(
              `✅ customersReferred updated for ${customer.name} - Added ${rawNumber}`
            );
          } else {
            console.log(`⚠️ Warning: ${referralResult.message}`);
          }

          await customer.save();
          await customer.updateConversationState("add_contact");

          let successMessage = `✅ Referral sent successfully to ${rawNumber}!\n\n`;

          if (customer.foremanStatus?.isCommissionEligible) {
            const commissionRate = customer.foremanStatus.commissionRate || 5;
            successMessage += `💰 Earn ${commissionRate}% commission when they make their first purchase!\n\n`;
          } else {
            successMessage += `🎁 Earn rewards when they make their first purchase!\n\n`;
          }

          successMessage += `Type '0' to return to main menu or send another number to continue.`;
          await sendSequentialMessages(phoneNumber, successMessage, 1000);
        } catch (error) {
          console.error("❌ Error in referral sending process:", error);
          newContact.status = "failed";
          // ❌ DO NOT UPDATE customersReferred if sending failed
          await customer.save();
          await sendWhatsAppMessage(
            phoneNumber,
            `❌ Error sending to ${rawNumber}.\n\nPlease check the number and try again, or contact support.\n\nSend another contact number or type '0' for main menu.`
          );
        }
        break;

      // Enhanced order completion with direct referral commission processing
      case "order_complete":
        try {
          // Prepare order data
          const orderData = {
            orderId:
              customer.latestOrderId || "ORD" + Date.now().toString().slice(-8),
            orderDate: new Date(),
            items: customer.cart.items.map((item) => ({
              ...item,
              isDiscountedProduct: item.isDiscountedProduct || false,
            })),
            totalAmount:
              customer.cart.totalAmount + (customer.cart.deliveryCharge || 0),
            deliveryCharge: customer.cart.deliveryCharge || 0,
            discounts: {
              firstOrderDiscount: customer.cart.firstOrderDiscount || 0,
              ecoDeliveryDiscount: customer.cart.ecoDeliveryDiscount || 0,
              referralDiscount: customer.cart.referralDiscount || 0,
            },
            status: "order-confirmed",
            paymentStatus: "paid",
            paymentMethod:
              customer.contextData?.paymentMethod || "Bank Transfer",
            transactionId: customer.contextData?.transactionId,
            deliveryAddress: customer.cart.deliveryAddress,
            deliveryOption: customer.cart.deliveryOption,
            deliveryLocation: customer.cart.deliveryLocation,
          };

          // Add order to shopping history
          await customer.addToShoppingHistory(orderData);

          // Process referral commission if customer was referred
          let commissionResult = {
            processed: false,
            amount: 0,
            referrerInfo: null,
          };
          if (customer.referralTracking?.primaryReferrer) {
            commissionResult = await processReferralCommissionForOrder(
              customer,
              orderData
            );
          }

          // Update first-time customer status
          if (customer.isFirstTimeCustomer) {
            customer.isFirstTimeCustomer = false;
            await customer.save();
          }

          // Clear cart and update state
          await customer.emptyCart();
          await customer.updateConversationState("main_menu");

          // Generate confirmation message
          let confirmationMessage = `✅ *Order Confirmed!* ✅\n\n`;
          confirmationMessage += `📦 Order ID: ${orderData.orderId}\n`;
          confirmationMessage += `💰 Total Amount: ${formatRupiah(
            orderData.totalAmount
          )}\n`;
          confirmationMessage += `🚚 Delivery: ${orderData.deliveryOption}\n`;
          confirmationMessage += `📍 Location: ${orderData.deliveryLocation}\n\n`;

          // Add referral commission info if processed
          if (commissionResult.processed) {
            confirmationMessage += `💰 Commission of ${formatRupiah(
              commissionResult.amount
            )} processed for referrer: ${
              commissionResult.referrerInfo?.name
            }\n\n`;
          }

          // Add first-time customer welcome message
          if (customer.isFirstTimeCustomer) {
            confirmationMessage += `🎉 Welcome to our family! This is your first order.\n\n`;
          }

          confirmationMessage += `📱 You can track your order by typing "5" in the main menu.\n\n`;
          confirmationMessage += `Thank you for choosing us! 🙏`;

          await sendWhatsAppMessage(phoneNumber, confirmationMessage);

          // Log successful order processing
          console.log(
            `Order ${orderData.orderId} processed successfully for customer ${customer.name}`
          );
          if (commissionResult.processed) {
            console.log(
              `Commission of ${commissionResult.amount} processed for referrer ${commissionResult.referrerInfo?.name}`
            );
          }

          // Send main menu after confirmation
          setTimeout(async () => {
            await sendMainMenu(phoneNumber, customer);
          }, 2000);
        } catch (error) {
          console.error("Error completing order:", error);
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Error processing your order. Please contact support."
          );
          await customer.updateConversationState("main_menu");
          await sendMainMenu(phoneNumber, customer);
        }
        break;

        // ===================== HELPER FUNCTIONS =====================

        // Function to create referral record when sending referral
        // Now includes 5-day rule validation and direct linking for existing customers
        async function createReferralRecord(
          referrerCustomer,
          referredPhoneNumber,
          videoId
        ) {
          try {
            // Normalize phone number
            const normalizedPhone = referredPhoneNumber.replace(/\D/g, "");

            console.log(
              `🔄 Creating referral record for ${normalizedPhone} by ${referrerCustomer.name}`
            );

            // ============= NEW CUSTOMER ONLY VALIDATION =============
            const referralValidation = await Customer.canBeReferred(normalizedPhone);
            
            if (!referralValidation.canRefer) {
              console.log(`❌ Referral Rejected: ${referralValidation.reason}`);
              return {
                success: false,
                message: referralValidation.reason,
                existingCustomerBlocked: true
              };
            }
            
            console.log(`✅ New Customer Validation Passed: ${referralValidation.reason}`);
            // ============= END VALIDATION =============

            // 🎯 For NEW customers only - Store in pending referrals
            // Initialize referral tracking if not exists
            if (!referrerCustomer.referralTracking) {
              referrerCustomer.referralTracking = {
                totalReferralsSent: 0,
                totalSuccessfulReferrals: 0,
                totalCommissionEarned: 0,
                lastReferralDate: new Date(),
                pendingReferrals: [], // 📝 Store pending referrals here
              };
            }

            // Initialize pendingReferrals array if not exists
            if (!referrerCustomer.referralTracking.pendingReferrals) {
              referrerCustomer.referralTracking.pendingReferrals = [];
            }

            // Check if this phone number is already in pending referrals
            let existingPendingReferral =
              referrerCustomer.referralTracking.pendingReferrals.find((ref) => {
                const refPhone = ref.phoneNumber.replace(/\D/g, "");
                return refPhone === normalizedPhone;
              });

            if (!existingPendingReferral) {
              // Create new pending referral record
              const newPendingReferral = {
                phoneNumber: normalizedPhone,
                referralDate: new Date(),
                videoId: videoId,
                status: "pending_registration",
                dateShared: new Date(),
              };

              referrerCustomer.referralTracking.pendingReferrals.push(
                newPendingReferral
              );
              referrerCustomer.referralTracking.totalReferralsSent += 1;
              referrerCustomer.referralTracking.lastReferralDate = new Date();

              console.log(`✅ Added new pending referral: ${normalizedPhone}`);
              console.log(
                `📊 Total pending referrals: ${referrerCustomer.referralTracking.pendingReferrals.length}`
              );

              // Save and verify
              await referrerCustomer.save();
              console.log(
                `💾 Saved referrer customer with ${referrerCustomer.referralTracking.pendingReferrals.length} pending referrals`
              );

              // Double-check the save worked
              const verifyCustomer = await Customer.findById(
                referrerCustomer._id
              );
              console.log(
                `🔍 Verification: Customer has ${
                  verifyCustomer.referralTracking?.pendingReferrals?.length || 0
                } pending referrals in database`
              );

              return {
                success: true,
                message: "Referral tracking initiated in pending referrals",
                isNewCustomer: true,
                totalPendingReferrals:
                  referrerCustomer.referralTracking.pendingReferrals.length,
              };
            } else {
              console.log(
                `⚠️ Customer ${normalizedPhone} already in pending referrals by ${referrerCustomer.name}`
              );
              return {
                success: false,
                message: "Customer already in pending referrals",
                totalPendingReferrals:
                  referrerCustomer.referralTracking.pendingReferrals.length,
              };
            }
          } catch (error) {
            console.error("❌ Error in createReferralRecord:", error);
            return {
              success: false,
              error: error.message,
            };
          }
        }

        // Function to link referred customer when they register
        async function linkReferredCustomerOnRegistration(
          newCustomer,
          referrerPhoneNumber
        ) {
          try {
            // Find the referrer by phone number
            const referrerCustomer = await Customer.findOne({
              phoneNumber: { $regex: referrerPhoneNumber.replace(/\D/g, "") },
            });

            if (!referrerCustomer) {
              console.log("Referrer not found during customer registration");
              return false;
            }

            // Find the pending referral record
            const normalizedNewCustomerPhone =
              newCustomer.phoneNumber[0].replace(/\D/g, "");

            // Look in pendingReferrals first
            const pendingReferral =
              referrerCustomer.referralTracking?.pendingReferrals?.find(
                (ref) => {
                  const refPhone = ref.phoneNumber.replace(/\D/g, "");
                  return refPhone === normalizedNewCustomerPhone;
                }
              );

            if (pendingReferral) {
              // Initialize customersReferred array if not exists
              if (!referrerCustomer.customersReferred) {
                referrerCustomer.customersReferred = [];
              }

              // Move from pending to actual referral with proper ObjectId
              const newReferralRecord = {
                customerId: newCustomer._id, // ✅ Now we have a real ObjectId
                customerName: newCustomer.name,
                phoneNumber: normalizedNewCustomerPhone,
                referralDate: pendingReferral.referralDate,
                videoUsed: pendingReferral.videoId,
                hasPlacedOrder: false,
                firstOrderDate: null,
                totalOrdersCount: 0,
                totalSpentAmount: 0,
                commissionGenerated: 0,
              };

              referrerCustomer.customersReferred.push(newReferralRecord);

              // Remove from pending referrals
              referrerCustomer.referralTracking.pendingReferrals =
                referrerCustomer.referralTracking.pendingReferrals.filter(
                  (ref) => {
                    const refPhone = ref.phoneNumber.replace(/\D/g, "");
                    return refPhone !== normalizedNewCustomerPhone;
                  }
                );

              // Update the new customer's referral tracking
              newCustomer.referralTracking = {
                primaryReferrer: {
                  customerId: referrerCustomer._id,
                  customerName: referrerCustomer.name,
                  phoneNumber: referrerCustomer.phoneNumber[0],
                  referralDate: pendingReferral.referralDate,
                  videoId: pendingReferral.videoId,
                },
                isReferred: true,
              };

              // Update referrer's successful referrals count
              if (!referrerCustomer.referralTracking.totalSuccessfulReferrals) {
                referrerCustomer.referralTracking.totalSuccessfulReferrals = 0;
              }
              referrerCustomer.referralTracking.totalSuccessfulReferrals += 1;

              await referrerCustomer.save();
              await newCustomer.save();

              console.log(
                `✅ Moved pending referral to customersReferred: ${newCustomer.name} linked to ${referrerCustomer.name}`
              );
              console.log(
                `📊 Referrer now has ${referrerCustomer.customersReferred.length} confirmed referrals`
              );

              return true;
            }

            console.log(
              `⚠️ No pending referral found for ${normalizedNewCustomerPhone}`
            );
            return false;
          } catch (error) {
            console.error("Error linking referred customer:", error);
            return false;
          }
        }

        // Function to process referral commission when referred customer places order
        async function processReferralCommissionForOrder(
          referredCustomer,
          orderData
        ) {
          try {
            // Check if customer was referred
            const primaryReferrer =
              referredCustomer.referralTracking?.primaryReferrer;
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
            await updateReferrerRecord(
              referrerCustomer,
              referredCustomer,
              orderData
            );

            // Calculate and add commission
            const commissionAmount = await addCommissionEarned(
              referrerCustomer,
              orderData,
              {
                customerId: referredCustomer._id,
                customerName: referredCustomer.name,
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
                  referrerCustomer.commissionTracking?.totalCommissionEarned ||
                  0,
              },
            };
          } catch (error) {
            console.error("Error processing referral commission:", error);
            return { processed: false, amount: 0, referrerInfo: null };
          }
        }

        // Function to update referrer's customer record with new referral data
        async function updateReferrerRecord(
          referrerCustomer,
          referredCustomer,
          orderData
        ) {
          try {
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

            const commissionRate =
              referrerCustomer.foremanStatus?.commissionRate || 5;
            const orderCommission = (eligibleAmount * commissionRate) / 100;

            referralRecord.commissionGenerated =
              (referralRecord.commissionGenerated || 0) + orderCommission;

            await referrerCustomer.save();
          } catch (error) {
            console.error("Error updating referrer record:", error);
          }
        }

        // Function to add commission earned to referrer
        // Now also credits the commission wallet (banking style ledger)
        async function addCommissionEarned(
          referrerCustomer,
          orderData,
          referredCustomerInfo
        ) {
          try {
            // Calculate commission amount
            const eligibleAmount = orderData.items.reduce((sum, item) => {
              return sum + (item.isDiscountedProduct ? 0 : item.totalPrice);
            }, 0);

            const commissionRate =
              referrerCustomer.foremanStatus?.commissionRate || 1; // Updated to 1% default
            const commissionAmount = (eligibleAmount * commissionRate) / 100;

            if (commissionAmount <= 0) {
              return 0;
            }

            // Initialize commission tracking if not exists
            if (!referrerCustomer.commissionTracking) {
              referrerCustomer.commissionTracking = {
                totalCommissionEarned: 0,
                availableCommission: 0,
                paidCommission: 0,
                commissionHistory: [],
              };
            }

            // Add commission to tracking
            referrerCustomer.commissionTracking.totalCommissionEarned +=
              commissionAmount;
            referrerCustomer.commissionTracking.availableCommission +=
              commissionAmount;

            // Add commission history record
            referrerCustomer.commissionTracking.commissionHistory.push({
              type: "earned",
              amount: commissionAmount,
              date: new Date(),
              relatedOrderId: orderData.orderId,
              referredCustomerId: referredCustomerInfo.customerId.toString(),
              referredCustomerName: referredCustomerInfo.customerName,
              orderAmount: orderData.totalAmount,
              eligibleAmount: eligibleAmount,
              commissionRate: commissionRate,
              isPaid: false,
            });

            // ============= COMMISSION WALLET (Banking Style) =============
            // Also credit the commission wallet with ledger entry
            if (!referrerCustomer.commissionWallet) {
              referrerCustomer.commissionWallet = {
                currentBalance: 0,
                totalCredits: 0,
                totalDebits: 0,
                ledger: []
              };
            }
            
            const newBalance = referrerCustomer.commissionWallet.currentBalance + commissionAmount;
            
            // Get referred customer phone
            let referredPhone = "Unknown";
            try {
              const refCust = await Customer.findById(referredCustomerInfo.customerId);
              if (refCust && refCust.phoneNumber && refCust.phoneNumber[0]) {
                referredPhone = refCust.phoneNumber[0];
              }
            } catch (e) {
              console.log("Could not get referred customer phone");
            }
            
            // Add ledger entry (banking style)
            referrerCustomer.commissionWallet.ledger.push({
              transactionId: "CWT" + Date.now().toString().slice(-10),
              date: new Date(),
              billNumber: orderData.orderId,
              fromReferredCustomer: {
                customerId: referredCustomerInfo.customerId.toString(),
                customerName: referredCustomerInfo.customerName,
                phoneNumber: referredPhone
              },
              type: "add_commission",
              credit: commissionAmount,
              debit: 0,
              balanceAfter: newBalance,
              note: `ADD commission from order ${orderData.orderId}`
            });
            
            // Update wallet totals
            referrerCustomer.commissionWallet.currentBalance = newBalance;
            referrerCustomer.commissionWallet.totalCredits += commissionAmount;
            // ============= END COMMISSION WALLET =============

            await referrerCustomer.save();
            
            console.log(`💰 Commission credited: Rs.${commissionAmount.toFixed(2)} to ${referrerCustomer.name}'s wallet`);
            console.log(`📊 New wallet balance: Rs.${newBalance.toFixed(2)}`);
            
            return commissionAmount;
          } catch (error) {
            console.error("Error adding commission earned:", error);
            return 0;
          }
        }

        // Function to get referral statistics for a customer
        async function getReferralStatistics(customerId) {
          try {
            const customer = await Customer.findById(customerId);
            if (!customer) return null;

            const stats = {
              totalReferrals: customer.customersReferred?.length || 0,
              successfulReferrals: 0,
              pendingReferrals: 0,
              totalCommissionEarned:
                customer.commissionTracking?.totalCommissionEarned || 0,
              availableCommission:
                customer.commissionTracking?.availableCommission || 0,
              totalOrdersFromReferrals: 0,
              totalRevenueFromReferrals: 0,
            };

            if (customer.customersReferred) {
              customer.customersReferred.forEach((ref) => {
                if (ref.hasPlacedOrder) {
                  stats.successfulReferrals++;
                  stats.totalOrdersFromReferrals += ref.totalOrdersCount || 0;
                  stats.totalRevenueFromReferrals += ref.totalSpentAmount || 0;
                } else {
                  stats.pendingReferrals++;
                }
              });
            }

            return stats;
          } catch (error) {
            console.error("Error getting referral statistics:", error);
            return null;
          }
        }

        // Helper function to format currency
        function formatRupiah(amount) {
          return new Intl.NumberFormat("id-ID", {
            style: "currency",
            currency: "IDR",
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
          }).format(amount);
        }
        // =============================================================================
        // HELPER FUNCTION - Send referral to contacts using UltraMsg
        // =============================================================================
        // ─── HELPER: downloadMediaBuffer ─────────────────────────────────────────────
        async function downloadMediaBuffer(mediaUrl) {
          try {
            const response = await axios({
              method: "GET",
              url: mediaUrl,
              responseType: "arraybuffer",
            });
            return Buffer.from(response.data, "binary");
          } catch (error) {
            console.error("Error downloading media:", error);
            throw error;
          }
        }

        // ─── FIXED sendActivatedDemoVideo - Removed problematic substring ───────────────────────────
        async function sendActivatedDemoVideo(customer, phoneNumber) {
          try {
            const Video = require("../models/video"); // Import your Video model

            // Check for expired videos first
            await Video.checkExpiredVideos();
            await Video.updateCurrentlyActiveStatus();

            // Find the currently active referral demo video (159A)
            const demoVideo = await Video.findOne({
              videoType: "referral",
              isActive: true,
              isCurrentlyActive: true,
            });

            if (!demoVideo) {
              console.log("No active referral demo video found in database");
              return false;
            }

            // Check if the video is currently active based on schedule
            if (!demoVideo.checkCurrentlyActive()) {
              console.log(
                "Demo video found but not currently active based on schedule"
              );
              return false;
            }

            // Validate video data
            if (!demoVideo.base64Data || !demoVideo.mimetype) {
              console.log("Demo video missing base64Data or mimetype");
              return false;
            }

            // Prepare caption - use saved message if available, otherwise default
            let caption = "";

            if (
              demoVideo.textBox &&
              demoVideo.textBox.isActive &&
              demoVideo.textBox.content
            ) {
              // Use the saved custom message from admin for 159A
              caption = demoVideo.textBox.content;
              console.log(
                "Using custom demo message from admin:",
                caption ? "Message found" : "No message"
              );
            } else {
              // Default demo caption if no custom message is saved
              caption =
                `📹 Here's how to create your referral video:\n\n` +
                `📝 What to mention:\n` +
                `• Your name\n` +
                `• What you do\n` +
                `• Why you recommend us\n\n` +
                `🎯 Keep it personal and authentic!`;
              console.log("Using default demo video caption");
            }

            // Send via UltraMsg API
            const result = await axios.post(
              `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/video`,
              new URLSearchParams({
                token: ULTRAMSG_CONFIG.token,
                to: phoneNumber + "@c.us",
                video: `data:${demoVideo.mimetype};base64,${demoVideo.base64Data}`,
                caption: caption,
              }),
              {
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                timeout: 30000, // 30 second timeout
              }
            );

            if (!result.data?.sent) {
              throw new Error(
                `UltraMsg demo video send failed: ${JSON.stringify(
                  result.data
                )}`
              );
            }

            console.log("Demo video sent successfully:", {
              videoId: demoVideo._id,
              videoTitle: demoVideo.title,
              fileSize: demoVideo.fileSize,
              phoneNumber: phoneNumber,
              videoType: "referral_demo",
              messageType:
                demoVideo.textBox &&
                demoVideo.textBox.isActive &&
                demoVideo.textBox.content
                  ? "custom"
                  : "default",
              captionIncluded: !!caption,
            });

            // Record that the video was sent (for analytics)
            await demoVideo.recordSent();

            return true;
          } catch (error) {
            console.error("Error sending demo video:", {
              error: error.message,
              stack: error.stack,
              phoneNumber: phoneNumber,
            });

            // Don't throw, just return false to allow graceful handling
            return false;
          }
        }

        // ─── UPDATED sendReferralToContact - Sends Introduction Video First, Then Referral ───────────────────────────
        async function sendReferralToContact(customer, video, contact) {
          try {
            console.log(
              `🚀 Starting referral process for contact: ${contact.phoneNumber}`
            );

            // STEP 1: Send Introduction Video (159B) first
            const introVideoSent = await sendIntroductionVideo(
              contact.phoneNumber,
              customer
            );

            if (introVideoSent) {
              console.log("✅ Introduction video sent successfully");
              // Add delay between videos to ensure proper delivery
              await new Promise((resolve) => setTimeout(resolve, 3000));
            } else {
              console.log(
                "⚠️ No introduction video available, proceeding with referral only"
              );
            }

            // STEP 2: Send the user's referral video
            const caption =
              `🎉 Personal Referral from ${customer.name}\n` +
              `💰 Use code: ${customer.referralCode || "WELCOME10"}\n` +
              `for 10% first purchase discount!\n\n` +
              `👆 ${customer.name} personally recommends us!`;

            const result = await axios.post(
              `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/video`,
              new URLSearchParams({
                token: ULTRAMSG_CONFIG.token,
                to: contact.phoneNumber + "@c.us",
                video: `data:${video.mimetype};base64,${video.base64Data}`,
                caption: caption,
              }),
              {
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                timeout: 30000,
              }
            );

            if (!result.data?.sent) {
              throw new Error(
                `UltraMsg referral video send failed: ${JSON.stringify(
                  result.data
                )}`
              );
            }

            console.log("✅ Referral video sent successfully");

            // STEP 3: Send welcome message (FIRST PART)
            await new Promise((resolve) => setTimeout(resolve, 2000));

            const welcomeMessage1 =
              `🙏 Welcome to our family!\n\n` +
              `🎁 Your discount code: ${customer.referralCode || "WELCOME10"}`;

            await axios.post(
              `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/chat`,
              new URLSearchParams({
                token: ULTRAMSG_CONFIG.token,
                to: contact.phoneNumber + "@c.us",
                body: welcomeMessage1,
              }),
              {
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
              }
            );

            console.log("✅ Welcome message 1 sent successfully");

            // STEP 4: Send second message (CALL TO ACTION)
            await new Promise((resolve) => setTimeout(resolve, 1500));

            const welcomeMessage2 =
              `💬 Reply with "hi" to start shopping or visit our website!\n\n` +
              `Thank you for trusting us! 🌟`;

            await axios.post(
              `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/chat`,
              new URLSearchParams({
                token: ULTRAMSG_CONFIG.token,
                to: contact.phoneNumber + "@c.us",
                body: welcomeMessage2,
              }),
              {
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
              }
            );

            const welcomeMessage3 = `📞 ${customer.name} (${customer.phoneNumber[0]}) referred you\n\n`;

            await axios.post(
              `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/chat`,
              new URLSearchParams({
                token: ULTRAMSG_CONFIG.token,
                to: contact.phoneNumber + "@c.us",
                body: welcomeMessage3,
              }),
              {
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
              }
            );

            console.log("✅ Welcome message 2 and 3 sent successfully");
            return true;
          } catch (error) {
            console.error("❌ Error in sendReferralToContact:", {
              error: error.message,
              stack: error.stack,
              contactPhone: contact.phoneNumber,
              customerName: customer.name,
            });
            throw new Error("Failed to send complete referral package");
          }
        }
        // ─── UPDATED sendReferralToContact - Sends Introduction Video First, Then Referral ───────────────────────────
        async function sendcustomizedmassages(customer, video, contact) {
          try {
            console.log(
              `🚀 Starting referral process for contact: ${contact.phoneNumber}`
            );

            const welcomeMessage =
              `📞 ${customer.name} (${customer.phoneNumber}) referred you\n\n` +
              `💬 Reply with hi to start or visit our website!\n\n` +
              (await axios.post(
                `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/chat`,
                new URLSearchParams({
                  token: ULTRAMSG_CONFIG.token,
                  to: contact.phoneNumber + "@c.us",
                  body: welcomeMessage,
                }),
                {
                  headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                  },
                }
              ));

            console.log("✅ customized refferal  message sent successfully");
            return true;
          } catch (error) {
            console.error("❌ Error in sendReferralToContact:", {
              error: error.message,
              stack: error.stack,
              contactPhone: contact.phoneNumber,
              customerName: customer.name,
            });
            throw new Error("Failed to send complete referral package");
          }
        }

        // ─── FIXED sendIntroductionVideo - Removed problematic substring ───────────────────────────
        async function sendIntroductionVideo(phoneNumber, referringCustomer) {
          try {
            const Video = require("../models/video"); // Import your Video model

            // Check for expired videos first
            await Video.checkExpiredVideos();
            await Video.updateCurrentlyActiveStatus();

            // Find the currently active introduction video (159B)
            const introVideo = await Video.findOne({
              videoType: "introduction",
              isActive: true,
              isCurrentlyActive: true,
            });

            if (!introVideo) {
              console.log("No active introduction video found in database");
              return false;
            }

            // Check if the video is currently active based on schedule
            if (!introVideo.checkCurrentlyActive()) {
              console.log(
                "Introduction video found but not currently active based on schedule"
              );
              return false;
            }

            // Validate video data
            if (!introVideo.base64Data || !introVideo.mimetype) {
              console.log("Introduction video missing base64Data or mimetype");
              return false;
            }

            // Prepare caption for introduction video
            let caption = "";

            if (
              introVideo.textBox &&
              introVideo.textBox.isActive &&
              introVideo.textBox.content
            ) {
              // Use the saved custom message from admin for 159B
              caption = introVideo.textBox.content;

              // Add referrer information to the custom message
              if (referringCustomer && referringCustomer.name) {
                caption += `\n\n👋 You were referred by: ${referringCustomer.name}`;
              }

              console.log("Using custom introduction message");
            } else {
              // Default introduction message if no custom message is saved
              if (referringCustomer && referringCustomer.name) {
                caption =
                  `👋 Welcome! You were referred by ${referringCustomer.name}\n\n` +
                  `🏢 Let us introduce ourselves and our services...\n\n` +
                  `🌟 We're excited to serve you!`;
              } else {
                caption =
                  `👋 Welcome to our family!\n\n` +
                  `🏢 Let us introduce ourselves and our services...\n\n` +
                  `🌟 We're excited to serve you!`;
              }
              console.log("Using default introduction message");
            }

            // Send introduction video via UltraMsg API
            const result = await axios.post(
              `${ULTRAMSG_CONFIG.baseURL}/${ULTRAMSG_CONFIG.instanceId}/messages/video`,
              new URLSearchParams({
                token: ULTRAMSG_CONFIG.token,
                to: phoneNumber + "@c.us",
                video: `data:${introVideo.mimetype};base64,${introVideo.base64Data}`,
                caption: caption,
              }),
              {
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                timeout: 30000,
              }
            );

            if (!result.data?.sent) {
              throw new Error(
                `UltraMsg introduction video send failed: ${JSON.stringify(
                  result.data
                )}`
              );
            }

            console.log("Introduction video sent successfully:", {
              videoId: introVideo._id,
              videoTitle: introVideo.title,
              fileSize: introVideo.fileSize,
              phoneNumber: phoneNumber,
              videoType: "introduction",
              captionIncluded: !!caption,
              referringCustomer: referringCustomer?.name || "unknown",
              customMessage: !!(
                introVideo.textBox &&
                introVideo.textBox.isActive &&
                introVideo.textBox.content
              ),
            });

            // Record that the video was sent (for analytics)
            await introVideo.recordSent();

            return true;
          } catch (error) {
            console.error("Error sending introduction video:", {
              error: error.message,
              stack: error.stack,
              phoneNumber: phoneNumber,
              referringCustomer: referringCustomer?.name || "unknown",
            });

            // Don't throw, just return false to allow graceful handling
            return false;
          }
        }
      // Simplified discount_products case (no more discounts state needed)
      case "discount_products":
        // Check if customer is trying to go back to main menu
        if (text === "0") {
          await sendMainMenu(phoneNumber, customer);
          break;
        }

        // Convert user input to a number
        const selectedProductNumber = parseInt(text);

        // Validate the product number
        const selectedProduct = await getDiscountProductByNumber(
          selectedProductNumber
        );

        if (selectedProduct) {
          console.log(
            "Selected Discounted Product:",
            JSON.stringify(selectedProduct, null, 2)
          );

          // Check if product is still in stock
          if (selectedProduct.stock <= 0) {
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Sorry, this product is currently out of stock. Please choose another option."
            );
            await sendDiscountedProductsList(phoneNumber, customer);
            break;
          }

          // Store selected discounted product info
          customer.currentDiscountProductId = selectedProduct.id;
          customer.currentDiscountProductName = selectedProduct.name;
          customer.currentDiscountProductPrice = selectedProduct.discountPrice;
          customer.currentDiscountProductOriginalPrice =
            selectedProduct.originalPrice;
          await customer.save();

          console.log(
            "Saved discount product ID:",
            customer.currentDiscountProductId
          );

          // Move to showing product details
          await customer.updateConversationState("discount_product_details");

          // Get the actual product from database
          const product = await Product.findOne({
            productId: selectedProduct.id,
          }).lean();

          if (product) {
            // Create a modified product object with discount price
            const modifiedProduct = {
              ...product,
              price: selectedProduct.discountPrice,
              originalPrice: selectedProduct.originalPrice,
            };

            // Send product details with discount information
            await sendProductDetails(
              phoneNumber,
              customer,
              modifiedProduct,
              true, // isDiscounted flag
              selectedProduct.originalPrice
            );
          } else {
            console.error(
              `Product not found in database: ${selectedProduct.id}`
            );
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Sorry, this product is temporarily unavailable. Please choose another option."
            );
            await sendDiscountedProductsList(phoneNumber, customer);
          }
        } else {
          // Invalid product number
          console.log(`Invalid product selection: ${selectedProductNumber}`);

          // Send error message
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Invalid selection. Please choose a product number from the list shown below."
          );

          // Resend the discount products list
          await sendDiscountedProductsList(phoneNumber, customer);
        }
        break;

      // Modified discount_product_details case
      case "discount_product_details":
        // Handle buy options for discounted products
        if (text === "1") {
          // Yes, add to cart
          await customer.updateConversationState("discount_select_weight");

          const discountProductId = customer.currentDiscountProductId;
          console.log("Product ID attempting to find:", discountProductId);

          if (!discountProductId) {
            console.error("Missing discount product ID");
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Sorry, there was an error processing your request. Please try selecting the product again."
            );
            await sendDiscountedProductsList(phoneNumber, customer);
            break;
          }

          // Get product from database
          const product = await Product.findOne({
            productId: discountProductId,
          }).lean();

          if (!product) {
            console.error(`Product not found with ID: ${discountProductId}`);
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Sorry, we couldn't find this product. Please try another product."
            );
            await sendDiscountedProductsList(phoneNumber, customer);
            break;
          }

          // Default weight options (you can modify this based on your product structure)
          const weightOptions = ["1kg", "5kg", "10kg", "25kg", "50kg"];

          // Create weight selection message with discounted price
          let weightMessage = "⚖️ *Please select the weight option:*\n\n";
          const discountPrice = customer.currentDiscountProductPrice;
          const basePrice = product.NormalPrice || discountPrice;
          const priceRatio = discountPrice / basePrice;

          weightOptions.forEach((weight, index) => {
            // Calculate discounted weight price
            let weightPrice = basePrice;
            if (weight.includes("5kg")) {
              weightPrice = basePrice * 4.5;
            } else if (weight.includes("10kg")) {
              weightPrice = basePrice * 9;
            } else if (weight.includes("25kg")) {
              weightPrice = basePrice * 22;
            } else if (weight.includes("50kg")) {
              weightPrice = basePrice * 45;
            }

            // Apply discount to the weight price
            weightPrice = Math.round(weightPrice * priceRatio);

            weightMessage += `${index + 1}. ${weight} - ${formatRupiah(
              weightPrice
            )} ✨ *DISCOUNTED*\n`;
          });

          // Store weight options for later use
          customer.contextData = customer.contextData || {};
          customer.contextData.weightOptions = weightOptions;
          await customer.save();

          await sendWhatsAppMessage(phoneNumber, weightMessage);
        } else if (text === "2") {
          // No, return to discount products list
          await customer.updateConversationState("discount_products");
          await sendDiscountedProductsList(phoneNumber, customer);
        } else if (text === "3") {
          // Return to main menu
          await sendMainMenu(phoneNumber, customer);
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please select a valid option (1, 2, or 3), or type 0 to return to the main menu."
          );
        }
        break;

      // Modified discount_select_weight case
      case "discount_select_weight":
        const discountProductId = customer.currentDiscountProductId;
        if (!discountProductId) {
          console.error("Missing discount product ID");
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Sorry, there was an error. Please try again."
          );
          await sendMainMenu(phoneNumber, customer);
          break;
        }

        // Get product from database
        const discountProductForWeight = await Product.findOne({
          productId: discountProductId,
        }).lean();

        if (!discountProductForWeight) {
          console.error(`Product not found with ID: ${discountProductId}`);
          await sendWhatsAppMessage(
            phoneNumber,
            "❌ Product not found. Let's return to the main menu."
          );
          await sendMainMenu(phoneNumber, customer);
          break;
        }

        // Get stored weight options
        const weightOptions = customer.contextData?.weightOptions || [
          "1kg",
          "5kg",
          "10kg",
          "25kg",
          "50kg",
        ];

        const discountWeightIndex = parseInt(text) - 1;
        if (
          discountWeightIndex >= 0 &&
          discountWeightIndex < weightOptions.length
        ) {
          // Save selected weight
          customer.contextData = customer.contextData || {};
          customer.contextData.selectedWeight =
            weightOptions[discountWeightIndex];
          await customer.save();

          // Send confirmation message
          await sendWhatsAppMessage(
            phoneNumber,
            `✅ You have chosen ${weightOptions[discountWeightIndex]}. Great choice!`
          );

          // Small delay before asking for quantity
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Ask for quantity
          await customer.updateConversationState("discount_select_quantity");
          await sendWhatsAppMessage(
            phoneNumber,
            "🔢 How many units would you like to order? Enter the quantity as a number."
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            `Please select a valid weight option (1 to ${weightOptions.length}), or type 0 to return to the main menu.`
          );
        }
        break;

      // Modified discount_select_quantity case
      case "discount_select_quantity":
        const discountQuantity = parseInt(text);
        if (!isNaN(discountQuantity) && discountQuantity > 0) {
          // Save quantity
          customer.contextData = customer.contextData || {};
          customer.contextData.quantity = discountQuantity;
          await customer.save();

          // ✅ RESET TIMER WHEN DISCOUNT ITEMS ADDED
          await resetCartTimer(customer);

          // Get product from database
          const product = await Product.findOne({
            productId: customer.currentDiscountProductId,
          }).lean();

          if (!product) {
            await sendWhatsAppMessage(
              phoneNumber,
              "❌ Product not found. Let's return to the main menu."
            );
            await sendMainMenu(phoneNumber, customer);
            break;
          }

          // Check stock availability
          const availableStock = product.Stock || 0;
          if (availableStock < discountQuantity) {
            await sendWhatsAppMessage(
              phoneNumber,
              `❌ Sorry, we only have ${availableStock} items in stock. Please enter a quantity of ${availableStock} or less.`
            );
            break;
          }

          // Calculate pricing
          const discountedPrice = customer.currentDiscountProductPrice;
          const selectedWeight = customer.contextData.selectedWeight;
          const basePrice = product.NormalPrice || discountedPrice;

          // Calculate weight-specific price with discount applied
          let weightPrice = discountedPrice;
          const priceRatio = discountedPrice / basePrice;

          if (selectedWeight.includes("5kg")) {
            weightPrice = basePrice * 4.5 * priceRatio;
          } else if (selectedWeight.includes("10kg")) {
            weightPrice = basePrice * 9 * priceRatio;
          } else if (selectedWeight.includes("25kg")) {
            weightPrice = basePrice * 22 * priceRatio;
          } else if (selectedWeight.includes("50kg")) {
            weightPrice = basePrice * 45 * priceRatio;
          }

          // Round to whole number
          weightPrice = Math.round(weightPrice);
          const totalPrice = weightPrice * discountQuantity;

          // Add to cart
          customer.cart = customer.cart || { items: [], totalAmount: 0 };
          customer.cart.items.push({
            productId: product.productId,
            productName: product.productName,
            category: product.categories || "General",
            subCategory: product.subCategories || "General",
            weight: customer.contextData.selectedWeight,
            quantity: discountQuantity,
            price: weightPrice,
            originalPrice: customer.currentDiscountProductOriginalPrice,
            totalPrice: totalPrice,
            imageUrl: product.masterImage
              ? `data:${
                  product.masterImage.contentType
                };base64,${product.masterImage.data.toString("base64")}`
              : null,
            isDiscounted: true,
          });

          // Update cart total
          customer.cart.totalAmount = customer.cart.items.reduce(
            (total, item) => total + item.totalPrice,
            0
          );
          await customer.save();
          await resetCartTimer(customer);

          // Confirm addition to cart
          await customer.updateConversationState("post_add_to_cart");
          const message = `✅ *Added to your cart!*

🛍️ ${product.productName}
📦 ${discountQuantity} units (${customer.contextData.selectedWeight}) 
💰 ${formatRupiah(totalPrice)} *(DISCOUNTED PRICE)*`;

          await sendWhatsAppMessage(phoneNumber, message);
          await sendWhatsAppMessage(
            phoneNumber,
            "🎯 *What would you like to do next?*\n\n1️⃣ View cart\n2️⃣ Proceed to checkout\n3️⃣ Continue shopping\n0️⃣ Return to main menu"
          );
        } else {
          await sendWhatsAppMessage(
            phoneNumber,
            "Please enter a valid quantity as a positive number, or type 0 to return to the main menu."
          );
        }
        break;

      default:
        // If we don't recognize the state, reset to main menu
        await sendMainMenu(phoneNumber, customer);
        break;
    }
  } catch (error) {
    console.error("Error in processChatMessage:", error);

    // Try to send an error message and reset to main menu
    try {
      await sendWhatsAppMessage(
        phoneNumber,
        "Sorry, something went wrong. Let's start fresh from the main menu."
      );

      const customer = await Customer.findOne({ phoneNumber: phoneNumber });

      if (customer) {
        await sendMainMenu(phoneNumber, customer);
      }
    } catch (innerError) {
      console.error("Error in error handler:", innerError);
    }
  }
}

// Update the sendMainMenu function
async function sendMainMenu(phoneNumber, customer) {
  // Send discount message first
  await sendWhatsAppMessage(
    phoneNumber,
    `🏷 Get 10% discount on first order straight away 💰
`
  );

  // PERFORMANCE FIX: Removed artificial 500ms delay that slowed response time

  const menuText =
    "Main Menu:\n" +
    "1. Explore materials for shopping\n" +
    "2. My orders/History\n" +
    "3. Avail discounts\n" +
    "4. Learn about our referral program\n" +
    "5. Support\n" +
    "6. My profile\n" +
    "7. Go to my cart\n" +
    "-------------------\n" +
    "any moment (0) you come back to this menu\n" +
    "Type the number of your choice ";

  await sendWhatsAppMessage(phoneNumber, menuText);

  // Add both messages to chat history
  await customer.addToChatHistory(
    "🏷️ *Get 10% discount on first order straight away* 💰",
    "bot"
  );
  await customer.addToChatHistory(menuText, "bot");
  await customer.updateConversationState("main_menu");
}

// Simplified function to send discounted products list
async function sendDiscountedProductsList(phoneNumber, customer) {
  console.log("Fetching all discount products");

  // Send welcome message for discounts
  await sendWhatsAppMessage(
    phoneNumber,
    "🎁 *Special Discounts Available!* 🎁\n\nHere are all our current discounted products:"
  );

  // Get all discounted products
  const discountProducts = await getDiscountedProducts();

  if (discountProducts.length === 0) {
    await sendWhatsAppMessage(
      phoneNumber,
      "Sorry, there are no discounted products available at the moment. Please check back later or browse our regular products."
    );
    return;
  }

  // Create a single product list message
  let productsMessage = "📋 *Discounted Products:*\n\n";

  // Add all products to the message with formatting
  discountProducts.forEach((product, index) => {
    const productNumber = index + 1;
    const discountPercent = Math.round(
      (1 - product.discountPrice / product.originalPrice) * 100
    );

    productsMessage += `${productNumber}. ${product.name}\n`;
    productsMessage += `💰 Price: ${formatRupiah(product.discountPrice)} `;
    productsMessage += `(${discountPercent}% OFF! Was: ${formatRupiah(
      product.originalPrice
    )})\n`;
    productsMessage += `📦 Stock: ${product.stock} available\n\n`;
  });

  // Send the product list
  await sendWhatsAppMessage(phoneNumber, productsMessage);

  // Send instruction as a separate message
  await sendWhatsAppMessage(
    phoneNumber,
    "💡 Select a product number to view details and add to cart, or type 0 to return to main menu."
  );
}

// ============================================================================
// BATCH DISCOUNT ELIGIBILITY - Shows discounted products + eligible categories
// ============================================================================
async function sendBatchDiscountEligibility(phoneNumber, customer) {
  console.log(`Checking batch discount eligibility for ${phoneNumber}`);

  try {
    // Initialize contextData if needed
    if (!customer.contextData) {
      customer.contextData = {};
    }

    // First, show all discounted products (like original behavior)
    await sendWhatsAppMessage(
      phoneNumber,
      "🎁 *Special Discounts Available!* 🎁\n\nHere are all our current discounted products:"
    );

    // Get all discounted products
    const discountProducts = await getDiscountedProducts();
    console.log(`Found ${discountProducts.length} discounted products`);
    
    // Store product IDs for selection (using productId strings like "P001")
    customer.contextData.discountProductList = discountProducts.map(p => p.id);
    console.log(`Stored discountProductList:`, customer.contextData.discountProductList);
    
    if (discountProducts.length > 0) {
      // Create a single product list message
      let productsMessage = "📋 *Discounted Products:*\n\n";

      // Add all products to the message with formatting
      discountProducts.forEach((product, index) => {
        const productNumber = index + 1;
        const discountPercent = Math.round(
          (1 - product.discountPrice / product.originalPrice) * 100
        );

        productsMessage += `${productNumber}. ${product.name}\n`;
        productsMessage += `💰 Price: ${formatRupiah(product.discountPrice)} `;
        productsMessage += `(${discountPercent}% OFF! Was: ${formatRupiah(
          product.originalPrice
        )})\n`;
        productsMessage += `📦 Stock: ${product.stock} available\n\n`;
      });

      await sendWhatsAppMessage(phoneNumber, productsMessage);
    } else {
      await sendWhatsAppMessage(
        phoneNumber,
        "📋 No general discounted products available right now."
      );
    }

    // Now check for special discount categories the customer is eligible for
    // Update customer fields first from latest data
    const customerPhone = phoneNumber.replace(/@c\.us|@s\.whatsapp\.net/g, "");
    
    let eligibility = await DiscountEligibility.findOne({ phoneNumber: customerPhone });
    
    if (!eligibility) {
      // Create new eligibility record with customer data
      eligibility = new DiscountEligibility({
        customerId: customer._id,
        phoneNumber: customerPhone,
        isForeman: customer.isForeman || false,
        hasCommission: customer.hasCommission || false,
        referralCount: customer.referralCount || 0,
        isReferred: customer.isReferred || false,
        accountCreatedAt: customer.createdAt || new Date(),
        firstPurchaseDate: customer.firstPurchaseDate || null,
        totalSpending: customer.totalSpending || 0,
        largestSinglePurchase: customer.largestSinglePurchase || 0,
      });
    } else {
      // Update existing eligibility with latest customer data
      eligibility.isForeman = customer.isForeman || false;
      eligibility.hasCommission = customer.hasCommission || false;
      eligibility.referralCount = customer.referralCount || 0;
      eligibility.totalSpending = customer.totalSpending || 0;
      eligibility.largestSinglePurchase = customer.largestSinglePurchase || 0;
    }

    // Update eligibility categories based on latest customer data
    eligibility.updateEligibility();
    await eligibility.save();
    
    console.log(`Eligibility categories:`, eligibility.eligibleCategories);
    
    const eligibleCategories = eligibility.eligibleCategories
      .filter(cat => cat.isActive)
      .map(cat => cat.category);

    console.log(`Eligible categories for customer:`, eligibleCategories);

    // Category display names for chatbot
    const categoryDisplay = {
      foremen: { name: "Foremen Discounts", emoji: "👷" },
      foremen_commission: { name: "Foremen+ Special", emoji: "👷‍♂️" },
      referral_3_days: { name: "Referral Rewards", emoji: "🔗" },
      new_customer_referred: { name: "New Customer Referral", emoji: "🆕" },
      new_customer: { name: "New Customer Welcome", emoji: "👋" },
      shopping_30m: { name: "VIP Exclusive", emoji: "💎" },
      shopping_100m_60d: { name: "Valued Customer", emoji: "🏆" },
      everyone: { name: "Everyone Discount", emoji: "🏷️" },
    };

    await new Promise(resolve => setTimeout(resolve, 300));

    // Build the combined menu
    let menuMessage = "";
    const eligibleCatList = [];
    
    // Start numbering after the products
    const productCount = discountProducts.length;
    
    if (eligibleCategories.length > 0) {
      menuMessage = "✨ *Your Special Discount Categories:*\n\n";
      
      eligibleCategories.forEach((cat, idx) => {
        const display = categoryDisplay[cat];
        if (display) {
          menuMessage += `${String.fromCharCode(65 + idx)}. ${display.emoji} ${display.name}\n`;
          eligibleCatList.push(cat);
        }
      });
      
      menuMessage += "\n";
    }

    // Store eligible categories for selection
    customer.contextData.eligibleBatchCategories = eligibleCatList;
    
    // Update state and save everything together
    customer.conversationState = "batch_discount_menu";
    customer.lastInteraction = new Date();
    await customer.save();
    console.log(`Saved customer context - Products: ${customer.contextData.discountProductList?.length}, Categories: ${eligibleCatList.length}, State: ${customer.conversationState}`);

    // Instructions
    if (discountProducts.length > 0) {
      menuMessage += "💡 *Select a product number* (1-" + productCount + ") to view details and add to cart.\n";
    }
    if (eligibleCatList.length > 0) {
      menuMessage += "💡 *Type a letter* (A-" + String.fromCharCode(64 + eligibleCatList.length) + ") to see your special category discounts.\n";
    }
    menuMessage += "💡 Type *0* to return to main menu.";

    await sendWhatsAppMessage(phoneNumber, menuMessage);

  } catch (error) {
    console.error("Error checking batch discount eligibility:", error);
    await sendWhatsAppMessage(
      phoneNumber,
      "Sorry, I couldn't load discounts right now. Please try again later or type 0 for main menu."
    );
    // Keep state as main_menu so user can try again
    await customer.updateConversationState("main_menu");
  }
}

// Function to show batch discount products for a specific category
async function sendBatchDiscountProducts(phoneNumber, customer, category) {
  try {
    const categoryDisplay = {
      foremen: "foremen",
      foremen_commission: "foremen+", 
      referral_3_days: "You referred 3",
      new_customer_referred: "new_customer_ref",
      new_customer: "Hey new customer",
      shopping_30m: "VIP",
      shopping_100m_60d: "Valued customer",
      everyone: "Discount",
    };

    // Find all batch discounts for this category
    const batches = await BatchDiscount.find({
      discountCategory: category,
      isActive: true,
    }).populate("products");

    if (!batches || batches.length === 0) {
      await sendWhatsAppMessage(
        phoneNumber,
        `😔 No products are currently available in the *${categoryDisplay[category]}* category.\n\nType *0* to return to main menu.`
      );
      return;
    }

    // Collect all products from all batches
    let productsMessage = `🛍️ *${categoryDisplay[category]}* Products:\n\n`;
    const allProducts = [];

    for (const batch of batches) {
      if (batch.products && batch.products.length > 0) {
        for (const product of batch.products) {
          allProducts.push({
            id: product._id,
            name: product.productName,
            originalPrice: batch.originalPrice || product.NormalPrice,
            discountPrice: batch.discountPrice,
            discountPercentage: batch.discountPercentage,
            batchNumber: batch.batchNumber,
          });
        }
      }
    }

    if (allProducts.length === 0) {
      await sendWhatsAppMessage(
        phoneNumber,
        `😔 No products available in this category yet.\n\nType *0* for main menu.`
      );
      return;
    }

    // Store product list for selection and update state together
    customer.contextData.batchProductList = allProducts.map(p => p.id.toString());
    customer.conversationState = "batch_discount_product_select";
    customer.lastInteraction = new Date();
    await customer.save();

    allProducts.forEach((product, index) => {
      productsMessage += `${index + 1}. ${product.name}\n`;
      productsMessage += `   💰 Rp ${product.discountPrice.toLocaleString()} `;
      productsMessage += `(-${product.discountPercentage}% off!)\n`;
      productsMessage += `   Was: Rp ${product.originalPrice.toLocaleString()}\n\n`;
    });

    productsMessage += "💡 Select a product number to add to cart.\nType *0* for main menu.";

    await sendWhatsAppMessage(phoneNumber, productsMessage);

  } catch (error) {
    console.error("Error fetching batch discount products:", error);
    await sendWhatsAppMessage(
      phoneNumber,
      "Sorry, couldn't load products. Please try again or type 0 for main menu."
    );
  }
}

async function getDiscountProductsForCategory(category) {
  console.log(`Fetching discount products for category: ${category}`);

  try {
    // Base query for products with active discounts
    const baseQuery = {
      hasActiveDiscount: true,
      "discountConfig.isActive": true,
      visibility: "Public",
    };

    // Add category-specific filters based on forWho field
    let categoryQuery = {};
    switch (category) {
      case "1":
        categoryQuery = { "discountConfig.forWho": "public" };
        break;
      case "2":
        categoryQuery = { "discountConfig.forWho": "public referral" };
        break;
      case "3":
        categoryQuery = { "discountConfig.forWho": "forman referral" };
        break;
      case "4":
        categoryQuery = { "discountConfig.forWho": "forman" };
        break;
      case "5":
        categoryQuery = { "discountConfig.forWho": "forman earnings mlm" };
        break;
      default:
        categoryQuery = { "discountConfig.forWho": "public" };
    }

    // Combine queries
    const finalQuery = { ...baseQuery, ...categoryQuery };

    // Fetch products from database
    const products = await Product.find(finalQuery)
      .select("productId productName discountConfig NormalPrice Stock")
      .limit(9) // Limit to 9 products per category
      .lean();

    console.log(
      `Found ${products.length} discount products for category ${category}`
    );

    // Transform products to match the expected format
    const transformedProducts = products.map((product) => ({
      id: product.productId,
      name: product.productName,
      originalPrice:
        product.discountConfig.originalPrice || product.NormalPrice,
      discountPrice: product.discountConfig.newPrice,
      category: category,
      stock: product.Stock || 0,
    }));

    return transformedProducts;
  } catch (error) {
    console.error("Error fetching discount products:", error);
    return [];
  }
}

// ✅ FIXED recordCartOrder function
// Clean old unpaid carts when creating new ones
async function recordCartOrder(customer) {
  // ✅ FIX #1: Remove old unpaid/pending carts first
  customer.orderHistory = customer.orderHistory.filter((order) => {
    // REMOVE if: cart-not-paid OR order-made-not-paid with no payment
    if (order.status === "cart-not-paid") return false;
    if (
      order.status === "order-made-not-paid" &&
      order.paymentStatus === "pending"
    )
      return false;
    // KEEP all other orders (paid ones, confirmed ones, etc)
    return true;
  });

  console.log(
    `🧹 Cleaned old carts. Remaining orders: ${customer.orderHistory.length}`
  );

  // Create new cart-not-paid order
  const seq = await getNextSequence("orderId");
  const orderId = "ORD" + (10000 + seq);

  // ✅ FIX #2: Only calculate discount if TRULY first time customer
  let firstOrderDiscount = 0;
  if (customer.isFirstTimeCustomer && customer.orderHistory.length === 0) {
    // Calculate on subtotal + delivery (but delivery might not be set yet)
    // We'll finalize this in proceedToCheckout
    firstOrderDiscount = Math.round(customer.cart.totalAmount * 0.1);
    console.log(`✅ First order discount initialized: ₹${firstOrderDiscount}`);
  }

  // Eco delivery discount if applicable
  let ecoDeliveryDiscount = 0;
  if (customer.cart.deliverySpeed === "eco") {
    ecoDeliveryDiscount = Math.round(customer.cart.totalAmount * 0.05);
  }

  // Create cart order
  const cartOrder = {
    orderId,
    items: [...customer.cart.items],
    totalAmount: customer.cart.totalAmount,
    deliveryType: customer.cart.deliveryType || "truck",
    deliverySpeed: customer.cart.deliverySpeed || "normal",
    deliveryOption: customer.cart.deliveryOption || "Normal Delivery",
    deliveryLocation: customer.cart.deliveryLocation || "",
    deliveryTimeFrame: customer.cart.deliveryTimeFrame || "",
    deliveryCharge: customer.cart.deliveryCharge || 0,
    firstOrderDiscount: firstOrderDiscount,
    ecoDeliveryDiscount: ecoDeliveryDiscount,
    deliveryAddress: customer.cart.deliveryAddress || {},
    paymentStatus: "pending",
    status: "cart-not-paid",
    paymentMethod: "Bank Transfer",
    orderDate: new Date(),
  };

  // Add to history
  customer.orderHistory.push(cartOrder);
  customer.shoppingHistory.push(cartOrder);
  customer.latestOrderId = orderId;
  customer.currentOrderStatus = "cart-not-paid";

  await customer.save();

  console.log(`✅ New cart order created: ${orderId}`);
  return orderId;
}
// Simplified function to get discount product by number
async function getDiscountProductByNumber(number) {
  console.log(`Attempting to retrieve product for number: ${number}`);

  // Get all discounted products
  const products = await getDiscountedProducts();

  // Check if the number is valid (1-based indexing)
  const index = number - 1;

  if (index >= 0 && index < products.length) {
    const selectedProduct = products[index];
    console.log(`Found product: ${selectedProduct.name}`);
    console.log(`Product ID: ${selectedProduct.id}`);

    return selectedProduct;
  } else {
    console.log(`No product found for number ${number}`);
    return null;
  }
}

async function sendProductsList(phoneNumber, customer, categoryOrSubcategory) {
  console.log(`🔍 Searching products for: "${categoryOrSubcategory}"`);

  let products = [];

  // Strategy 1: Try finding by subcategory first
  products = await Product.find({
    subCategories: categoryOrSubcategory,
    productType: { $in: ["Child", "Normal"] },
    visibility: "Public",
  }).lean();

  console.log(`📦 Found ${products.length} products by subcategory`);

  // Strategy 2: If no products found, try finding by main category (for products without subcategories)
  if (products.length === 0) {
    products = await Product.find({
      categories: categoryOrSubcategory,
      $or: [
        { subCategories: { $exists: false } },
        { subCategories: "" },
        { subCategories: null },
      ],
      productType: { $in: ["Child", "Normal"] },
      visibility: "Public",
    }).lean();

    console.log(`📦 Found ${products.length} products by category`);
  }

  // No products found at all
  if (products.length === 0) {
    console.log(`❌ No products found for "${categoryOrSubcategory}"`);

    await sendWhatsAppMessage(
      phoneNumber,
      `❌ No products available in "${categoryOrSubcategory}" at the moment.\n\n` +
        `Please try another category or type 0 to return to main menu.`
    );

    await customer.updateConversationState("shopping_categories");
    await sendCategoriesList(phoneNumber, customer);
    return;
  }

  // ✅ Products found! Display them
  console.log(`✅ Displaying ${products.length} products`);

  let msg = `You selected: ${categoryOrSubcategory}\n\n`;
  msg += `Available products:\n\n`;

  // Store product IDs for later reference
  customer.contextData.productList = products.map((p) => p._id.toString());

  products.forEach((prod, idx) => {
    const price = prod.NormalPrice ?? 0;
    msg += `${idx + 1}. ${prod.productName} - Rp ${price.toLocaleString()}\n`;
  });

  msg +=
    `\nPlease enter the product number to view its details.` +
    `\nType 0 to return to main menu or type "View cart" to view your cart`;

  await sendWhatsAppMessage(phoneNumber, msg);
  await customer.save();
}
async function sendProductDetails(to, customer, product) {
  // Determine price
  const price =
    product.finalPrice != null
      ? product.finalPrice
      : product.NormalPrice || product.NormalPrice;

  // Build the prompt exactly as before
  const caption =
    `*${product.productName}*\n` +
    `${product.description || ""}\n\n` +
    `💰 Price: Rp ${price}\n\n` +
    `1- Yes I want to buy this add it to my cart\n` +
    `2- No return to previous menu\n` +
    `3- Return to main menu`;

  // Send product images (master + additional)
  if (product.masterImage && product.masterImage.data) {
    try {
      await sendProductImages(to, product, caption);
      console.log("📸 Product images sent successfully");
      return;
    } catch (error) {
      console.error("❌ Error sending product images:", error);
      // Fallback to text only
    }
  }

  // Otherwise fallback to text only
  await sendWhatsAppMessage(to, caption);
}

// Update the goToCart function to always show the number of items and total value
async function goToCart(phoneNumber, customer) {
  if (
    !customer.cart ||
    !customer.cart.items ||
    customer.cart.items.length === 0
  ) {
    await sendWhatsAppMessage(
      phoneNumber,
      "Your cart is empty. Start shopping to add items to your cart!"
    );
    await sendMainMenu(phoneNumber, customer);
    return;
  }

  // Format cart message
  let cartMessage = `🛒 *Your Shopping Cart* 🛒 (${customer.cart.items.length} items)\n\n`;

  customer.cart.items.forEach((item, index) => {
    cartMessage += `${index + 1}. ${item.productName} (${item.weight})\n`;
    cartMessage += `   Quantity: ${item.quantity}\n`;
    cartMessage += `   Price: ${item.price} each\n`;
    cartMessage += `   Total: ${item.totalPrice}\n\n`;
  });

  cartMessage += `Subtotal: ${customer.cart.totalAmount}\n`;
  if (customer.cart.deliveryCharge > 0) {
    cartMessage += `Delivery Charge: ${customer.cart.deliveryCharge}\n`;
    cartMessage += `Total: ${
      customer.cart.totalAmount + customer.cart.deliveryCharge
    }\n\n`;
  }

  cartMessage += "What would you like to do next?\n\n";
  cartMessage += "(A) Delete an item\n";
  cartMessage += "(B) Empty my cart fully\n";
  cartMessage += "(C) Proceed to payment\n";
  cartMessage += "(D) Go back to menu\n";
  cartMessage += "(E) View product details\n";

  await sendWhatsAppMessage(phoneNumber, cartMessage);
  await customer.updateConversationState("cart_view");
  await customer.addToChatHistory(cartMessage, "bot");
}

function generateOrderHistoryList(customer) {
  let message = "📦 *My orders/ History* 📦\n\n";

  if (!customer.orderHistory || customer.orderHistory.length === 0) {
    message += "You haven't placed any orders yet.\n";
    return message;
  } else {
    // Sort orders by date, newest first (handle missing dates)
    const sortedOrders = [...customer.orderHistory].sort((a, b) => {
      const dateA = a.orderDate || a.createdAt || 0;
      const dateB = b.orderDate || b.createdAt || 0;
      return new Date(dateB) - new Date(dateA);
    });

    // Display orders from newest to oldest, with descending numbering
    sortedOrders.forEach((order, index) => {
      const orderNumber = sortedOrders.length - index; // Reverse numbering
      message += `${orderNumber}. Order #${order.orderId}\n`;
      
      // Handle missing orderDate - try orderDate, createdAt, or show N/A
      const orderDate = order.orderDate || order.createdAt;
      const formattedDate = orderDate && !isNaN(new Date(orderDate).getTime()) 
        ? new Date(orderDate).toLocaleDateString() 
        : "N/A";
      message += `   Date: ${formattedDate}\n`;
      
      // Handle missing status - show a friendly default
      const orderStatus = order.status || "Pending";
      message += `   Status: ${orderStatus}\n`;

      // Add delivery location info
      if (order.deliveryLocation) {
        message += `   Delivery to: ${order.deliveryLocation}\n`;
      }

      // Add address info if available
      if (order.deliveryAddress && order.deliveryAddress.nickname) {
        message += `   Address: ${order.deliveryAddress.nickname} (${
          order.deliveryAddress.area || ""
        })\n`;
      }

      // Convert to Rp
      message += `   Total: Rp ${order.totalAmount}\n\n`;
    });
  }

  return message;
}

// Helper function to format prices in Rupiah
function formatRupiah(amount) {
  return `Rp ${amount}`;
}

// ✅ FIXED proceedToCheckout function
// Calculate discount on FINAL BILL (items + delivery), not just subtotal
async function proceedToCheckout(phoneNumber, customer) {
  try {
    console.log(`🛒 Starting checkout for ${phoneNumber}`);
    
    if (
      !customer.cart ||
      !customer.cart.items ||
      customer.cart.items.length === 0
    ) {
      await sendWhatsAppMessage(
        phoneNumber,
        "Your cart is empty. Start shopping to add items to your cart!"
      );
      await sendMainMenu(phoneNumber, customer);
      return;
    }

    // ✅ FIX #1: Clean up old unpaid carts first
    customer.orderHistory = customer.orderHistory.filter(
      (order) =>
        order.status !== "cart-not-paid" && order.paymentStatus !== "pending"
    );

    // ✅ FIX #2: Calculate discount on FINAL BILL (not just subtotal)
    if (customer.isFirstTimeCustomer && customer.orderHistory.length === 0) {
      // Calculate: items + delivery
      const subtotal = customer.cart.totalAmount;
      const deliveryCharge = customer.cart.deliveryCharge || 0;
      const beforeDiscount = subtotal + deliveryCharge;

      // Apply 10% discount on TOTAL BILL
      customer.cart.firstOrderDiscount = Math.round(beforeDiscount * 0.1);
      console.log(
        `✅ First order discount applied: ₹${customer.cart.firstOrderDiscount} (10% of ₹${beforeDiscount})`
      );
    } else {
      customer.cart.firstOrderDiscount = 0;
      console.log(`ℹ️ Not first order or already has discount`);
    }

    // Eco delivery discount remains the same
    if (customer.cart.deliverySpeed === "eco") {
      const subtotal = customer.cart.totalAmount;
      customer.cart.ecoDeliveryDiscount = Math.round(subtotal * 0.05);
    }

    await customer.save();

    // ✅ Automatically calculate vehicle type based on package size
    try {
      const productIds = customer.cart.items.map(item => item.productId);
      console.log(`🔍 Looking up ${productIds.length} products...`);
      
      const products = await Product.find({ _id: { $in: productIds } }).select('packageSize productName');
      
      console.log(`🔍 Checking package sizes for ${products.length} products...`);
      
      // Check if ANY product has Large package
      const hasLargePackage = products.some(product => {
        const size = product.packageSize || "Large"; // Default to Large if not set
        console.log(`   - ${product.productName}: ${size}`);
        return size === "Large";
      });
      
      // Auto-assign vehicle type based on package sizes
      if (hasLargePackage) {
        // If ANY product is Large, must use truck
        customer.cart.deliveryType = "truck";
        console.log(`🚚 Truck assigned: Cart contains large package(s)`);
      } else {
        // All products are Small, can use scooter
        customer.cart.deliveryType = "scooter";
        console.log(`🛵 Scooter assigned: All products are small packages`);
      }
      
      await customer.save();
    } catch (error) {
      console.error("❌ Error calculating vehicle:", error);
      console.error("Error details:", error.message, error.stack);
      // Default to truck if calculation fails
      customer.cart.deliveryType = "truck";
      await customer.save(); // ✅ Save after setting default
    }

    // Start checkout process with delivery speed options (not vehicle type)
    console.log(`✅ Updating conversation state to checkout_delivery`);
    await customer.updateConversationState("checkout_delivery");

    // Show discount message if applicable
    let discountInfo = "";
    if (customer.cart.firstOrderDiscount > 0) {
      discountInfo =
        `🎉 *FIRST ORDER DISCOUNT!* (10%)\n` +
        `You'll save: ₹${customer.cart.firstOrderDiscount}\n\n`;
    }

    // ✅ NEW: Show delivery speed options only (vehicle auto-assigned)
    const vehicleType = customer.cart.deliveryType === "scooter" ? "Scooter" : "Truck";
    
    console.log(`✅ Sending delivery speed options to ${phoneNumber}`);
    await sendWhatsAppMessage(
      phoneNumber,
      `🚚 *Choose Your Delivery Speed* 🚚\n\n` +
        discountInfo +
        `🚛 Vehicle: ${vehicleType} (auto-selected based on your items)\n\n` +
        `1. Normal Delivery - Arrives in 3-5 days (FREE)\n` +
        `2. Speed Delivery - Arrives within 24-48 hours (+₹50,000)\n` +
        `3. Early Morning Delivery - 4:00 AM–9:00 AM (+₹50,000)\n` +
        `4. 🌱 Eco Delivery - 8-10 days (5% discount on items!)\n` +
        `5. 🏪 Self Pickup - Pick up from our store\n\n` +
        `Select your preferred delivery speed (1-5):`
    );
    console.log(`✅ proceedToCheckout completed successfully`);
  } catch (error) {
    console.error("❌❌❌ CRITICAL ERROR in proceedToCheckout:", error);
    console.error("Error stack:", error.stack);
    throw error; // Re-throw to be caught by main error handler
  }
}
// UPDATED goToCart function with proper total calculation
async function goToCart(phoneNumber, customer) {
  if (
    !customer.cart ||
    !customer.cart.items ||
    customer.cart.items.length === 0
  ) {
    await sendWhatsAppMessage(
      phoneNumber,
      "Your cart is empty. Start shopping to add items to your cart!"
    );
    await sendMainMenu(phoneNumber, customer);
    return;
  }

  // Calculate totals
  const subtotal = customer.cart.totalAmount;
  const deliveryCharge = customer.cart.deliveryCharge || 0;
  const firstOrderDiscount = customer.cart.firstOrderDiscount || 0;
  const ecoDeliveryDiscount = customer.cart.ecoDeliveryDiscount || 0;
  const finalTotal =
    subtotal + deliveryCharge - firstOrderDiscount - ecoDeliveryDiscount;

  // Format cart message
  let cartMessage = `🛒 *Your Shopping Cart* 🛒 (${customer.cart.items.length} items)\n\n`;

  customer.cart.items.forEach((item, index) => {
    cartMessage += `${index + 1}. ${item.productName}`;
    if (item.weight) cartMessage += ` (${item.weight})`;
    cartMessage += `\n   Quantity: ${item.quantity}\n`;
    cartMessage += `   Price: ${formatRupiah(item.price)} each\n`;
    cartMessage += `   Total: ${formatRupiah(item.totalPrice)}\n\n`;
  });

  cartMessage += `Subtotal: ${formatRupiah(subtotal)}\n`;

  if (deliveryCharge > 0) {
    cartMessage += `Delivery Charge: ${formatRupiah(deliveryCharge)}\n`;
  }

  if (firstOrderDiscount > 0) {
    cartMessage += `First Order Discount (10%): -${formatRupiah(
      firstOrderDiscount
    )}\n`;
  }

  if (ecoDeliveryDiscount > 0) {
    cartMessage += `Eco Delivery Discount (5%): -${formatRupiah(
      ecoDeliveryDiscount
    )}\n`;
  }

  cartMessage += `\n*Final Total: ${formatRupiah(finalTotal)}*\n\n`;

  cartMessage += "What would you like to do next?\n\n";
  cartMessage += "(A) Delete an item\n";
  cartMessage += "(B) Empty my cart fully\n";
  cartMessage += "(C) Proceed to payment\n";
  cartMessage += "(D) Go back to menu\n";
  cartMessage += "(E) View product details\n";

  await sendWhatsAppMessage(phoneNumber, cartMessage);
  await customer.updateConversationState("cart_view");
  await customer.addToChatHistory(cartMessage, "bot");
}

// ✅ FIXED sendOrderSummary function
// Display discount correctly calculated on FINAL BILL
async function sendOrderSummary(phoneNumber, customer) {
  // 1) Calculate totals properly
  const subtotal = customer.cart.totalAmount;
  const deliveryCharge = customer.cart.deliveryCharge || 0;

  // ✅ FIX: Get discount that was already calculated in proceedToCheckout
  const firstOrderDiscount = customer.cart.firstOrderDiscount || 0;
  const ecoDeliveryDiscount = customer.cart.ecoDeliveryDiscount || 0;

  // Final total calculation (this is the correct total bill)
  const finalTotal =
    subtotal + deliveryCharge - firstOrderDiscount - ecoDeliveryDiscount;

  // 2) Update order status and SAVE THE CORRECT TOTAL AMOUNT
  const idx = customer.orderHistory.findIndex(
    (o) => o.orderId === customer.latestOrderId
  );
  if (idx >= 0) {
    customer.orderHistory[idx].status = "order-made-not-paid";
    // FIX: Save the final calculated total as totalAmount (not just subtotal)
    customer.orderHistory[idx].totalAmount = finalTotal;
    customer.orderHistory[idx].firstOrderDiscount = firstOrderDiscount;
    customer.orderHistory[idx].ecoDeliveryDiscount = ecoDeliveryDiscount;
    customer.currentOrderStatus = "order-made-not-paid";
    await customer.save();
    console.log(`📊 Order summary saved with total: ₹${finalTotal}`);
  }

  // 3) Build the summary message
  let message = "📋 *Your Order Summary*\n\n";

  // Line items
  message += "**Items:**\n";
  customer.cart.items.forEach((item, i) => {
    const name = (item.productName || "").replace(" (DISCOUNTED)", "");
    const weight = item.weight ? ` (${item.weight})` : "";
    const lineTotal = formatRupiah(item.totalPrice);
    message += `${i + 1}. ${name}${weight}\n`;
    message += `   Qty: ${
      item.quantity
    } × ₹${item.price.toLocaleString()} = ${lineTotal}\n`;
  });

  // Cost breakdown
  message += `\n**Cost Breakdown:**\n`;
  message += `Subtotal: ${formatRupiah(subtotal)}\n`;

  if (deliveryCharge > 0) {
    message += `Delivery: +${formatRupiah(deliveryCharge)}\n`;
  } else {
    message += `Delivery: Free ✓\n`;
  }

  // ✅ HIGHLIGHT DISCOUNT
  if (firstOrderDiscount > 0) {
    message += `\n🎉 **FIRST ORDER DISCOUNT (10%):** -${formatRupiah(
      firstOrderDiscount
    )}\n`;
  }

  if (ecoDeliveryDiscount > 0) {
    message += `🌱 **ECO DELIVERY DISCOUNT (5%):** -${formatRupiah(
      ecoDeliveryDiscount
    )}\n`;
  }

  // Delivery summary
  message += `\n**Delivery Details:**\n`;
  message += `Option: ${customer.cart.deliveryOption}\n`;

  if (customer.cart.deliveryTimeFrame) {
    message += `Time: ${customer.cart.deliveryTimeFrame}\n`;
  }

  if (customer.cart.deliveryType !== "self_pickup") {
    if (customer.cart.deliveryLocation) {
      message += `Area: ${customer.cart.deliveryLocation}\n`;
    }
  }

  // ✅ FINAL TOTAL (MOST IMPORTANT)
  message += `\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `💰 **TOTAL BILL: ${formatRupiah(finalTotal)}** 💰\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Checkout menu
  message +=
    `✅ **Ready to proceed?**\n\n` +
    `1️⃣ Yes, proceed to payment\n` +
    `2️⃣ Modify cart\n` +
    `3️⃣ I'll pay later\n` +
    `4️⃣ Cancel order\n\n` +
    `Type the number to continue:`;

  // Send message and log to chat history
  await sendWhatsAppMessage(phoneNumber, message);
  await customer.addToChatHistory(message, "bot");
}
// Additional helper functions for API endpoints

// Test endpoint for Ultramsg
router.get("/test-message", async (req, res) => {
  try {
    const { to, message } = req.query;

    if (!to || !message) {
      return res
        .status(400)
        .json({ error: "Missing to or message parameters" });
    }

    const result = await sendWhatsAppMessage(to, message);
    res.json(result);
  } catch (error) {
    console.error("Test message error:", error);
    res.status(500).json({ error: "Failed to send test message" });
  }
});

console.log("🚀 Ultramsg WhatsApp Bot Router Initialized");
console.log(`📱 Instance ID: ${ULTRAMSG_CONFIG.instanceId}`);
console.log(`🔗 Webhook endpoint: /webhook`);
console.log(`✅ Ready to receive messages via Ultramsg webhooks`);

// Export function for external use (e.g., from customers.js)
async function sendPickupConfirmationToCustomer(customer, order) {
  try {
    const phoneNumber = customer.phoneNumber;
    const currentDateTime = new Date().toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });

    const confirmationMessage = 
      `✅ *Order Pickup Confirmed!*\n\n` +
      `Thank you for picking up your order.\n\n` +
      `📦 *Order ID:* #${order.orderId}\n` +
      `📅 *Pickup Date & Time:* ${currentDateTime}\n\n` +
      `We hope everything is perfect! If you have any questions, feel free to contact support.\n\n` +
      `Thank you for choosing us! 😊`;

    await sendWhatsAppMessage(phoneNumber, confirmationMessage);
    console.log(`✅ Pickup confirmation sent for order ${order.orderId} to ${customer.phoneNumber}`);
    return true;
  } catch (error) {
    console.error(`❌ Error sending pickup confirmation:`, error);
    return false;
  }
}

module.exports = router;
module.exports.sendPickupConfirmationToCustomer = sendPickupConfirmationToCustomer;
