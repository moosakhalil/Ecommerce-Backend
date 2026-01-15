/**
 * Message Tracker Utility
 * Prevents duplicate webhook processing by tracking message IDs
 * 
 * This module provides simple in-memory deduplication for WhatsApp messages.
 * Messages are tracked by their unique ID (constructed from sender + timestamp + messageId)
 * and automatically cleaned up after 60 seconds.
 */

// In-memory cache for processed message IDs
const processedMessages = new Map();

// Time-to-live for cached message IDs (60 seconds)
const MESSAGE_TTL = 60 * 1000;

// Maximum entries before forced cleanup
const MAX_ENTRIES = 1000;

/**
 * Check if a message has already been processed
 * @param {string} messageId - Unique message identifier
 * @returns {boolean} - true if already processed, false if new
 */
function hasProcessed(messageId) {
  if (!messageId) {
    console.warn("⚠️ messageTracker: No messageId provided");
    return false;
  }
  
  // Check if message was already processed
  if (processedMessages.has(messageId)) {
    console.log(`⏭️ Duplicate message detected: ${messageId.substring(0, 30)}...`);
    return true;
  }
  
  // Mark message as processed
  processedMessages.set(messageId, Date.now());
  
  // Periodic cleanup (every 100 new entries or when max is reached)
  if (processedMessages.size % 100 === 0 || processedMessages.size > MAX_ENTRIES) {
    cleanupOldEntries();
  }
  
  return false;
}

/**
 * Generate a unique message ID from webhook data
 * Uses the actual message ID from WhatsApp if available
 * @param {object} messageData - The message data from webhook
 * @returns {string} - Unique message identifier
 */
function generateMessageId(messageData) {
  if (!messageData) return null;
  
  const from = messageData.from || "";
  const timestamp = messageData.time || messageData.timestamp || "";
  const msgId = messageData.id || messageData.msgId || "";
  
  // If we have an actual message ID, use it (most reliable)
  if (msgId) {
    return `${from}_${msgId}`;
  }
  
  // Fallback: use timestamp only (without body to allow same commands like "1", "0")
  // This allows same user to send "1" multiple times for different products
  return `${from}_${timestamp}`;
}


/**
 * Clean up entries older than MESSAGE_TTL
 */
function cleanupOldEntries() {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [id, timestamp] of processedMessages) {
    if (now - timestamp > MESSAGE_TTL) {
      processedMessages.delete(id);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 messageTracker: Cleaned ${cleanedCount} old entries. Remaining: ${processedMessages.size}`);
  }
}

/**
 * Get current cache statistics
 * @returns {object} - Statistics about the message cache
 */
function getStats() {
  return {
    size: processedMessages.size,
    maxSize: MAX_ENTRIES,
    ttlSeconds: MESSAGE_TTL / 1000
  };
}

/**
 * Clear all cached message IDs (for testing)
 */
function clearCache() {
  processedMessages.clear();
  console.log("🗑️ messageTracker: Cache cleared");
}

module.exports = {
  hasProcessed,
  generateMessageId,
  getStats,
  clearCache
};
