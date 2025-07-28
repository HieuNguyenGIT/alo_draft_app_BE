// Updated index.js with enhanced Socket.IO configuration

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const dotenv = require("dotenv");
const http = require("http");
const os = require("os");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const server = http.createServer(app);

// Enhanced CORS middleware
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database connection
const db = require("./config/database");

// Routes
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/todos", require("./routes/todo.routes"));
app.use("/api/messages", require("./routes/message.routes"));

// Basic route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to the Todo API with Socket.IO" });
});

// Health check route
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    socketio: "Ready",
    environment: process.env.NODE_ENV || "development",
  });
});

// ========== ENHANCED SOCKET.IO SETUP ==========
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["authorization"],
    credentials: true,
  },
  // 🔥 CRITICAL: Support websocket for mobile
  transports: ["websocket"],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  maxHttpBufferSize: 1e6,
  // 🔥 NEW: Additional mobile compatibility settings
  allowUpgrades: true,
  perMessageDeflate: false,
});

// Store Socket.IO connections with user info
const socketUsers = new Map(); // socketId -> userInfo
const userSockets = new Map(); // userId -> socketId
const conversationRooms = new Map(); // conversationId -> Set of socketIds

// 🔥 ENHANCED: Socket.IO authentication middleware
io.use(async (socket, next) => {
  try {
    console.log("🔐 Socket.IO: Authentication attempt");
    console.log("🔍 Connection info:", {
      id: socket.id,
      transport: socket.conn.transport.name,
      upgraded: socket.conn.upgraded,
      remoteAddress: socket.conn.remoteAddress,
    });

    const token =
      socket.handshake.auth.token ||
      socket.handshake.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      console.log("❌ Socket.IO: No token provided");
      return next(new Error("Authentication error: No token provided"));
    }

    console.log("🔍 Token received:", token.substring(0, 20) + "...");

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("✅ Token decoded:", decoded);

    const [users] = await db.query(
      "SELECT id, name, email FROM users WHERE id = ?",
      [decoded.id]
    );

    if (users.length === 0) {
      console.log("❌ Socket.IO: User not found for ID:", decoded.id);
      return next(new Error("Authentication error: User not found"));
    }

    // Attach user info to socket
    socket.userId = users[0].id;
    socket.userInfo = users[0];

    console.log(
      `✅ Socket.IO: User ${users[0].name} (ID: ${users[0].id}) authenticated`
    );
    next();
  } catch (error) {
    console.log("❌ Socket.IO authentication error:", error.message);
    return next(new Error(`Authentication error: ${error.message}`));
  }
});

// 🔥 ENHANCED: Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(
    `🔌 Socket.IO: User ${socket.userInfo.name} connected (${socket.id})`
  );
  console.log(`   Transport: ${socket.conn.transport.name}`);
  console.log(`   Upgraded: ${socket.conn.upgraded}`);

  // Store user connection
  socketUsers.set(socket.id, socket.userInfo);
  userSockets.set(socket.userId, socket.id);

  // 🔥 CRITICAL: Send authentication confirmation
  socket.emit("authenticated", {
    user: socket.userInfo,
    socketId: socket.id,
    timestamp: new Date().toISOString(),
    transport: socket.conn.transport.name,
  });

  console.log(`📡 Authentication confirmation sent to ${socket.userInfo.name}`);

  // 🔥 ENHANCED: Handle test messages
  socket.on("test", (data) => {
    console.log("🧪 Socket.IO test message (no auth):", data);
    socket.emit("testResponse", {
      message: "Test received!",
      originalData: data,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("testMessage", (data) => {
    console.log("🧪 Socket.IO test message (authenticated):", data);
    socket.emit("testResponse", {
      message: "Authenticated test received!",
      originalData: data,
      timestamp: new Date().toISOString(),
      user: socket.userInfo.name,
    });
  });

  // 🔥 ENHANCED: Conversation management
  socket.on("joinConversation", async (conversationId) => {
    try {
      // Validate conversation access
      const [conversation] = await db.query(
        `SELECT id FROM conversations 
         WHERE id = ? AND (participant1_id = ? OR participant2_id = ?)`,
        [conversationId, socket.userId, socket.userId]
      );

      if (conversation.length === 0) {
        socket.emit("error", { message: "Access denied to conversation" });
        return;
      }

      // Leave previous conversation if any
      if (socket.conversationId) {
        socket.leave(`conversation_${socket.conversationId}`);
        const oldRoom = conversationRooms.get(socket.conversationId);
        if (oldRoom) {
          oldRoom.delete(socket.id);
          if (oldRoom.size === 0) {
            conversationRooms.delete(socket.conversationId);
          }
        }
        console.log(
          `🚪 User ${socket.userId} left conversation ${socket.conversationId}`
        );
      }

      // Join new conversation
      socket.conversationId = conversationId;
      socket.join(`conversation_${conversationId}`);

      // Track conversation room
      if (!conversationRooms.has(conversationId)) {
        conversationRooms.set(conversationId, new Set());
      }
      conversationRooms.get(conversationId).add(socket.id);

      console.log(
        `🏠 User ${socket.userId} joined conversation ${conversationId}`
      );

      socket.emit("joinedConversation", {
        conversationId: conversationId,
        message: "Successfully joined conversation",
        timestamp: new Date().toISOString(),
        participantCount: conversationRooms.get(conversationId).size,
      });

      // Mark messages as read when joining
      try {
        await db.query(
          `UPDATE messages SET is_read = TRUE 
           WHERE conversation_id = ? AND sender_id != ? AND is_read = FALSE`,
          [conversationId, socket.userId]
        );
      } catch (error) {
        console.log("❌ Error marking messages as read:", error);
      }
    } catch (error) {
      console.log("❌ Error joining conversation:", error);
      socket.emit("error", { message: "Failed to join conversation" });
    }
  });

  // Handle leaving conversation
  socket.on("leaveConversation", () => {
    if (socket.conversationId) {
      socket.leave(`conversation_${socket.conversationId}`);
      const room = conversationRooms.get(socket.conversationId);
      if (room) {
        room.delete(socket.id);
        if (room.size === 0) {
          conversationRooms.delete(socket.conversationId);
        }
      }
      console.log(
        `🚪 User ${socket.userId} left conversation ${socket.conversationId}`
      );
      socket.conversationId = null;
    }
  });

  // 🔥 ENHANCED: Message sending with database integration
  socket.on("sendMessage", async (data) => {
    try {
      const {
        conversationId,
        content,
        messageType = "text",
        temporaryId,
      } = data;

      console.log(
        `📤 Socket.IO: User ${socket.userId} sending message to conversation ${conversationId}: "${content}"`
      );

      // Validate conversation access
      const [conversation] = await db.query(
        `SELECT id FROM conversations 
         WHERE id = ? AND (participant1_id = ? OR participant2_id = ?)`,
        [conversationId, socket.userId, socket.userId]
      );

      if (conversation.length === 0) {
        socket.emit("error", { message: "Access denied to conversation" });
        return;
      }

      // Insert message into database
      const [result] = await db.query(
        `INSERT INTO messages (conversation_id, sender_id, content, message_type) 
         VALUES (?, ?, ?, ?)`,
        [conversationId, socket.userId, content.trim(), messageType]
      );

      // Update conversation timestamp
      await db.query(
        `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [conversationId]
      );

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

      const messageData = {
        ...newMessage[0],
        conversation_id: parseInt(conversationId),
        created_at: newMessage[0].created_at.toISOString(),
        temporaryId: temporaryId,
      };

      // 🔥 CRITICAL: Broadcast to conversation room
      io.to(`conversation_${conversationId}`).emit("newMessage", messageData);
      console.log(`📡 Message broadcasted to conversation_${conversationId}`);

      // Send confirmation to sender
      socket.emit("messageStatus", {
        temporaryId: temporaryId,
        messageId: result.insertId,
        status: "sent",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.log("❌ Socket.IO message error:", error);
      socket.emit("error", {
        message: "Failed to send message",
        error: error.message,
      });
    }
  });

  // 🔥 ENHANCED: Typing indicators with room validation
  socket.on("startTyping", (conversationId) => {
    if (!socket.conversationId || socket.conversationId !== conversationId) {
      return; // Ignore if not in the conversation
    }

    console.log(
      `⌨️ User ${socket.userId} started typing in conversation ${conversationId}`
    );
    socket.to(`conversation_${conversationId}`).emit("userTyping", {
      userId: socket.userId,
      userName: socket.userInfo.name,
      conversationId: conversationId,
    });
  });

  socket.on("stopTyping", (conversationId) => {
    if (!socket.conversationId || socket.conversationId !== conversationId) {
      return; // Ignore if not in the conversation
    }

    console.log(
      `⌨️ User ${socket.userId} stopped typing in conversation ${conversationId}`
    );
    socket.to(`conversation_${conversationId}`).emit("userStoppedTyping", {
      userId: socket.userId,
      conversationId: conversationId,
    });
  });

  // Handle ping/pong for debugging
  socket.on("ping", (data) => {
    console.log(`🏓 Ping from ${socket.userInfo.name}:`, data);
    socket.emit("pong", {
      message: "pong",
      timestamp: new Date().toISOString(),
      originalData: data,
      transport: socket.conn.transport.name,
    });
  });

  // 🔥 ENHANCED: Handle disconnection with cleanup
  socket.on("disconnect", (reason) => {
    console.log(
      `🔌 Socket.IO: User ${socket.userInfo.name} disconnected (${reason})`
    );

    // Clean up conversation room
    if (socket.conversationId) {
      const room = conversationRooms.get(socket.conversationId);
      if (room) {
        room.delete(socket.id);
        if (room.size === 0) {
          conversationRooms.delete(socket.conversationId);
        }
      }
    }

    // Clean up stored connections
    socketUsers.delete(socket.id);
    userSockets.delete(socket.userId);

    console.log(`   Remaining connections: ${socketUsers.size}`);
  });

  // Handle errors
  socket.on("error", (error) => {
    console.log("❌ Socket.IO socket error:", error);
  });

  // Handle connection errors
  socket.on("connect_error", (error) => {
    console.log("❌ Socket.IO connection error:", error);
  });

  // 🔥 NEW: Transport upgrade handling
  socket.conn.on("upgrade", () => {
    console.log(`⬆️ User ${socket.userInfo.name} upgraded to WebSocket`);
  });

  socket.conn.on("upgradeError", (error) => {
    console.log(`❌ Upgrade error for ${socket.userInfo.name}:`, error);
  });
});

// 🔥 NEW: Periodic cleanup and monitoring
setInterval(() => {
  console.log(`📊 Socket.IO Stats:`);
  console.log(`   Connected users: ${socketUsers.size}`);
  console.log(`   Active conversations: ${conversationRooms.size}`);
  console.log(`   Total sockets: ${io.engine.clientsCount}`);
}, 60000); // Every minute

// Make Socket.IO available to routes
app.set("io", io);

// Enhanced network detection for Docker
const getDockerNetworkInfo = () => {
  const interfaces = os.networkInterfaces();
  const containerIP = [];

  for (const interfaceName in interfaces) {
    const interfaceInfo = interfaces[interfaceName];
    for (const info of interfaceInfo) {
      if (info.family === "IPv4" && !info.internal) {
        containerIP.push(info.address);
      }
    }
  }

  const isDocker =
    process.env.DB_HOST === "db" ||
    process.env.NODE_ENV === "development" ||
    containerIP.some((ip) => ip.startsWith("172."));

  const getDockerHostIP = () => {
    if (!isDocker || containerIP.length === 0) return null;
    const ip = containerIP[0];
    const parts = ip.split(".");
    if (parts[0] === "172" && parts[1] === "18") {
      return `${parts[0]}.${parts[1]}.${parts[2]}.1`;
    }
    return null;
  };

  return {
    containerIP: containerIP[0] || "unknown",
    hostGatewayIP: getDockerHostIP(),
    isDocker,
  };
};

// Start server
const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log("📦 Database connection is a success");
  console.log("⚡ Socket.IO server is ready for real-time communication");
  console.log("🔧 Environment:", process.env.NODE_ENV || "development");
  console.log("🔑 JWT Secret:", process.env.JWT_SECRET ? "Set" : "Missing");
  console.log("🔌 Socket.IO Transports: websocket");
  console.log("HOT RELOAD TEST: " + new Date().toISOString());

  const { containerIP, hostGatewayIP, isDocker } = getDockerNetworkInfo();

  console.log("\n" + "=".repeat(70));
  console.log("📱 FOR FLUTTER SOCKET.IO CONNECTION:");
  console.log(`   ✅ Socket.IO URL: http://192.168.100.87:${PORT}`);
  console.log(`   ✅ Health Check: http://192.168.100.87:${PORT}/health`);
  console.log(`   ✅ API Base: http://192.168.100.87:${PORT}/api`);
  console.log("   🔥 Mobile Optimized: websocket transports");
  console.log("=".repeat(70) + "\n");
});
