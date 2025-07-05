const express = require("express");
const router = express.Router();
const db = require("../config/database");
const auth = require("../middleware/auth");

// Search users (excluding current user)
router.get("/users/search", auth, async (req, res) => {
  try {
    const { query } = req.query;
    const currentUserId = req.user.id;

    if (!query || query.trim().length < 1) {
      return res.json([]);
    }

    const [users] = await db.query(
      `SELECT id, name, email 
       FROM users 
       WHERE (name LIKE ? OR email LIKE ?) 
       AND id != ? 
       LIMIT 20`,
      [`%${query}%`, `%${query}%`, currentUserId]
    );

    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// FIXED: Get all conversations for current user with proper last message
router.get("/conversations", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const [conversations] = await db.query(
      `SELECT 
        c.id as conversation_id,
        c.updated_at as last_activity,
        u.id as other_user_id,
        u.name as other_user_name,
        u.email as other_user_email,
        latest_msg.content as last_message,
        latest_msg.created_at as last_message_time,
        latest_msg.sender_id as last_message_sender_id,
        (SELECT COUNT(*) FROM messages m2 
         WHERE m2.conversation_id = c.id 
         AND m2.sender_id != ? 
         AND m2.is_read = FALSE) as unread_count
       FROM conversations c
       LEFT JOIN users u ON (
         CASE 
           WHEN c.participant1_id = ? THEN c.participant2_id = u.id
           ELSE c.participant1_id = u.id
         END
       )
       LEFT JOIN (
         SELECT m1.*
         FROM messages m1
         INNER JOIN (
           SELECT conversation_id, MAX(created_at) as max_time
           FROM messages
           GROUP BY conversation_id
         ) m2 ON m1.conversation_id = m2.conversation_id AND m1.created_at = m2.max_time
       ) latest_msg ON c.id = latest_msg.conversation_id
       WHERE c.participant1_id = ? OR c.participant2_id = ?
       ORDER BY COALESCE(latest_msg.created_at, c.updated_at) DESC`,
      [userId, userId, userId, userId]
    );

    console.log(
      `📋 Returning ${conversations.length} conversations for user ${userId}`
    );
    console.log("🔍 Sample conversation:", conversations[0]);

    res.json(conversations);
  } catch (error) {
    console.error("❌ Error fetching conversations:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Start conversation with a user
router.post("/conversations", auth, async (req, res) => {
  try {
    const { otherUserId } = req.body;
    const currentUserId = req.user.id;

    if (currentUserId === otherUserId) {
      return res
        .status(400)
        .json({ message: "Cannot start conversation with yourself" });
    }

    // Check if conversation already exists
    const [existingConversation] = await db.query(
      `SELECT id FROM conversations 
       WHERE (participant1_id = ? AND participant2_id = ?) 
       OR (participant1_id = ? AND participant2_id = ?)`,
      [currentUserId, otherUserId, otherUserId, currentUserId]
    );

    if (existingConversation.length > 0) {
      return res.json({ conversationId: existingConversation[0].id });
    }

    // Create new conversation
    const [result] = await db.query(
      `INSERT INTO conversations (participant1_id, participant2_id) 
       VALUES (?, ?)`,
      [
        Math.min(currentUserId, otherUserId),
        Math.max(currentUserId, otherUserId),
      ]
    );

    // Create participant records
    await db.query(
      `INSERT INTO message_participants (conversation_id, user_id) VALUES (?, ?), (?, ?)`,
      [result.insertId, currentUserId, result.insertId, otherUserId]
    );

    res.json({ conversationId: result.insertId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get messages for a conversation
router.get("/conversations/:id/messages", auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;
    const { page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // Verify user is part of conversation
    const [conversation] = await db.query(
      `SELECT id FROM conversations 
       WHERE id = ? AND (participant1_id = ? OR participant2_id = ?)`,
      [conversationId, userId, userId]
    );

    if (conversation.length === 0) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Get messages
    const [messages] = await db.query(
      `SELECT 
        m.id,
        m.content,
        m.message_type,
        m.sender_id,
        m.is_read,
        m.created_at,
        u.name as sender_name
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at DESC
       LIMIT ? OFFSET ?`,
      [conversationId, parseInt(limit), offset]
    );

    res.json(messages.reverse()); // Reverse to get chronological order
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

// FIXED: Send a message with better logging and conversation update
router.post("/conversations/:id/messages", auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;
    const { content, messageType = "text" } = req.body;

    if (!content || content.trim().length === 0) {
      return res
        .status(400)
        .json({ message: "Message content cannot be empty" });
    }

    // Verify user is part of conversation
    const [conversation] = await db.query(
      `SELECT participant1_id, participant2_id FROM conversations 
       WHERE id = ? AND (participant1_id = ? OR participant2_id = ?)`,
      [conversationId, userId, userId]
    );

    if (conversation.length === 0) {
      return res.status(403).json({ message: "Access denied" });
    }

    console.log(
      `💬 User ${userId} sending message to conversation ${conversationId}: "${content}"`
    );

    // Insert message
    const [result] = await db.query(
      `INSERT INTO messages (conversation_id, sender_id, content, message_type) 
       VALUES (?, ?, ?, ?)`,
      [conversationId, userId, content.trim(), messageType]
    );

    console.log(`✅ Message inserted with ID: ${result.insertId}`);

    // CRITICAL: Update conversation last activity timestamp
    await db.query(
      `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [conversationId]
    );

    console.log(`🔄 Updated conversation ${conversationId} timestamp`);

    // Get the created message with sender info
    const [newMessage] = await db.query(
      `SELECT 
        m.id,
        m.content,
        m.message_type,
        m.sender_id,
        m.is_read,
        m.created_at,
        m.conversation_id,
        u.name as sender_name
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.id = ?`,
      [result.insertId]
    );

    const messageData = newMessage[0];
    const wss = req.app.get("wss");

    console.log(`📨 Broadcasting message to conversation ${conversationId}`);
    console.log(`💬 Message data:`, messageData);
    console.log(`👥 Total connected clients:`, wss.clients.size);

    let broadcastCount = 0;
    wss.clients.forEach((client) => {
      console.log(
        `🔍 Checking client - readyState: ${client.readyState}, conversationId: ${client.conversationId}, userId: ${client.userId}`
      );

      if (client.readyState === 1) {
        console.log(`✅ Broadcasting to client (userId: ${client.userId})`);
        client.send(
          JSON.stringify({
            type: "new_message",
            data: {
              ...messageData,
              conversation_id: parseInt(conversationId),
            },
          })
        );
        broadcastCount++;
      }
    });

    console.log(`📡 Broadcasted message to ${broadcastCount} clients`);

    res.status(201).json(messageData);
  } catch (error) {
    console.error("❌ Error in message sending:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Mark messages as read
router.put("/conversations/:id/mark-read", auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;

    // Verify user is part of conversation
    const [conversation] = await db.query(
      `SELECT id FROM conversations 
       WHERE id = ? AND (participant1_id = ? OR participant2_id = ?)`,
      [conversationId, userId, userId]
    );

    if (conversation.length === 0) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Mark all messages from other users as read
    await db.query(
      `UPDATE messages SET is_read = TRUE 
       WHERE conversation_id = ? AND sender_id != ? AND is_read = FALSE`,
      [conversationId, userId]
    );

    res.json({ message: "Messages marked as read" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
