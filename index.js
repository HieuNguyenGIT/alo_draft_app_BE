const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const dotenv = require("dotenv");
const WebSocket = require("ws");
const http = require("http");
const os = require("os");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const server = http.createServer(app);

// ========== DEBUG MIDDLEWARE ==========
app.use((req, res, next) => {
  console.log(`📍 ${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database connection
const db = require("./config/database");

// Basic route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to the Todo API with Socket.IO + WebSocket" });
});

// Test endpoint to verify Socket.IO is running
app.get("/socket-test", (req, res) => {
  res.json({
    message: "Socket.IO server is running",
    connectedClients: io ? io.engine.clientsCount : 0,
    transport: "websocket",
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/todos", require("./routes/todo.routes"));
app.use("/api/messages", require("./routes/message.routes"));

// ========== SOCKET.IO DEBUG MIDDLEWARE ==========
app.use("/socket.io/", (req, res, next) => {
  console.log("🔍 Socket.IO request intercepted:");
  console.log("   Method:", req.method);
  console.log("   URL:", req.url);
  console.log("   Headers:", Object.keys(req.headers));
  console.log("   User-Agent:", req.headers["user-agent"]);
  console.log("   Origin:", req.headers.origin);
  next();
});

// Log all requests to see if Flutter is even reaching the server
app.use((req, res, next) => {
  if (req.url.includes("socket.io")) {
    console.log(`🌐 Socket.IO related request: ${req.method} ${req.url}`);
    console.log("   Query params:", req.query);
    console.log("   Transport:", req.query.transport);
  }
  next();
});

// ========== SOCKET.IO SETUP (FLUTTER MOBILE COMPATIBLE) ==========
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },

  // 🔥 CRITICAL: Support both transports but prioritize WebSocket
  transports: ["websocket", "polling"], // ✅ WebSocket first for Flutter

  allowEIO3: false,

  // 🔥 MOBILE-OPTIMIZED: Aggressive timeouts for mobile networks
  pingTimeout: 120000, // 2 minutes - longer for mobile
  pingInterval: 25000, // 25 seconds
  upgradeTimeout: 45000, // 45 seconds for mobile upgrade
  maxHttpBufferSize: 1e6,
  connectTimeout: 60000, // 1 minute connection timeout

  // 🔥 FLUTTER COMPATIBILITY: Critical options
  serveClient: false,
  destroyUpgrade: false,
  destroyUpgradeTimeout: 1000,
  allowUpgrades: true,
  perMessageDeflate: false, // Disable compression for mobile

  // 🔥 NEW: Additional WebSocket-specific options
  httpCompression: false, // Disable HTTP compression
  allowRequest: (req, callback) => {
    // Log all connection attempts for debugging
    console.log("🔍 Connection attempt from:", req.headers["user-agent"]);
    console.log("   Origin:", req.headers.origin);
    console.log("   Host:", req.headers.host);
    console.log("   Connection:", req.headers.connection);
    console.log("   Upgrade:", req.headers.upgrade);

    // Allow all connections for now
    callback(null, true);
  },
});

// 🔥 ENHANCED: WebSocket-specific debugging
io.engine.on("connection", (socket) => {
  console.log("🔌 Socket.IO Engine: New client connected:", socket.id);
  console.log("   Transport:", socket.transport.name);
  console.log("   Remote address:", socket.remoteAddress);
  console.log("   Request URL:", socket.request.url);
  console.log("   User-Agent:", socket.request.headers["user-agent"]);
  console.log("   Connection type:", socket.request.headers.connection);
  console.log("   Upgrade header:", socket.request.headers.upgrade);

  // 🔥 CRITICAL: Log transport changes
  socket.on("upgrade", () => {
    console.log(`⬆️ Client ${socket.id} upgraded to:`, socket.transport.name);
  });

  socket.on("upgradeError", (error) => {
    console.log(`❌ Upgrade error for ${socket.id}:`, error);
  });

  socket.on("close", (reason, details) => {
    console.log(`🔌 Engine client rep ${socket.id} disconnected:`, reason);

    console.log(details.message);

    // some additional description, for example the status code of the HTTP response
    console.log(details.description);

    // some additional context, for example the XMLHttpRequest object
    console.log(details.context);
  });

  socket.on("error", (error, detailes) => {
    console.log(`❌ Engine ahaah client ${socket.id} error:`, error);
    console.log(`❌ REASONING  :`, detailes);
  });
});
// Store Socket.IO connections with user info
const socketUsers = new Map();
const userSockets = new Map();

// ========== ENHANCED DEBUGGING ==========
io.engine.on("connection_error", (err) => {
  console.log("❌ Socket.IO Engine Connection Error:");
  console.log("   Request URL:", err.req ? err.req.url : "Unknown");
  console.log("   Request Headers:", err.req ? err.req.headers : "Unknown");
  console.log("   Error Code:", err.code);
  console.log("   Error Message:", err.message);
  console.log("   Error Context:", err.context);
});

// Log engine connections with more detail
io.engine.on("connection", (socket) => {
  console.log("🔌 Socket.IO Engine: New client connected:", socket.id);
  console.log("   Transport:", socket.transport.name);
  console.log("   Remote address:", socket.remoteAddress);
  console.log("   Request URL:", socket.request.url);
  console.log("   User-Agent:", socket.request.headers["user-agent"]);

  // 🔥 NEW: Log when client disconnects from engine
  socket.on("close", (reason) => {
    console.log(`🔌 Engine client ${socket.id} disconnected:`, reason);
  });

  socket.on("error", (error) => {
    console.log(`❌ Engine client ${socket.id} error:`, error);
  });
});

// 🔥 CRITICAL: Enhanced authentication middleware with detailed logging
io.use(async (socket, next) => {
  console.log("🔐 Socket.IO Auth Middleware Called for:", socket.id);
  console.log("   Handshake query:", socket.handshake.query);
  console.log("   Handshake auth:", socket.handshake.auth);
  console.log(
    "   Handshake headers:",
    Object.keys(socket.handshake.headers || {})
  );

  try {
    // 🔥 NEW: Check multiple sources for token
    const token =
      socket.handshake.auth.token ||
      socket.handshake.query.token ||
      socket.handshake.headers.authorization;

    console.log(
      "🔑 Token received:",
      token ? `YES (${token.substring(0, 20)}...)` : "NO"
    );

    if (!token) {
      console.log("❌ Socket.IO: No token provided in auth, query, or headers");
      return next(new Error("Authentication error: No token provided"));
    }

    console.log("🔍 Verifying JWT token...");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("✅ JWT verified for user ID:", decoded.id);

    console.log("🔍 Querying database for user...");
    const [users] = await db.query(
      "SELECT id, name, email FROM users WHERE id = ?",
      [decoded.id]
    );

    if (users.length === 0) {
      console.log("❌ Socket.IO: User not found in database");
      return next(new Error("Authentication error: User not found"));
    }

    socket.userId = users[0].id;
    socket.userInfo = users[0];

    console.log(
      `✅ Socket.IO: User ${users[0].name} (ID: ${users[0].id}) authenticated successfully`
    );
    console.log("🎯 Authentication middleware completed successfully");
    next();
  } catch (error) {
    console.log("❌ Socket.IO authentication error:", error.message);
    console.log("   Error type:", error.name);
    console.log("   Error stack:", error.stack);
    next(new Error(`Authentication error: ${error.message}`));
  }
});

// ========== TEST NAMESPACE (NO AUTH REQUIRED) ==========
const testNamespace = io.of("/test");

testNamespace.on("connection", (socket) => {
  console.log(`🧪 TEST namespace: Client connected (${socket.id})`);
  console.log(`   Transport: ${socket.conn.transport.name}`);

  // Send immediate confirmation
  socket.emit("connected", {
    message: "Test connection successful!",
    socketId: socket.id,
    transport: socket.conn.transport.name,
    namespace: "/test",
    timestamp: new Date().toISOString(),
  });

  // Handle test messages
  socket.on("test", (data) => {
    console.log("🧪 TEST namespace: Test message received:", data);
    socket.emit("testResponse", {
      message: "Test received in test namespace!",
      originalData: data,
      socketId: socket.id,
      transport: socket.conn.transport.name,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("disconnect", (reason) => {
    console.log(`🧪 TEST namespace: Client disconnected (${reason})`);
  });

  socket.on("error", (error) => {
    console.log("🧪 TEST namespace error:", error);
  });
});

console.log("🧪 Test namespace created at /test (no auth required)");

// ========== MAIN NAMESPACE (REQUIRES AUTH) ==========
io.on("connection", (socket) => {
  console.log("🎉 Socket.IO MAIN: Authentication successful!");
  console.log(`   User: ${socket.userInfo.name} (ID: ${socket.userId})`);
  console.log(`   Socket ID: ${socket.id}`);
  console.log(`   Transport: ${socket.conn.transport.name}`);

  socketUsers.set(socket.id, socket.userInfo);
  userSockets.set(socket.userId, socket.id);

  // 🔥 IMPORTANT: Send authentication confirmation immediately
  socket.emit("authenticated", {
    user: socket.userInfo,
    socketId: socket.id,
    transport: socket.conn.transport.name,
    namespace: "/",
    timestamp: new Date().toISOString(),
    message: "Successfully authenticated to main namespace",
  });

  console.log(`✅ Authentication confirmation sent to ${socket.userInfo.name}`);

  // Handle test messages in authenticated mode
  socket.on("test", (data) => {
    console.log("🧪 Socket.IO authenticated test message:", data);
    socket.emit("testResponse", {
      message: "Authenticated test received!",
      originalData: data,
      user: socket.userInfo.name,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("testMessage", (data) => {
    console.log("🧪 Socket.IO testMessage (auth mode):", data);
    socket.emit("testResponse", {
      message: "Authenticated testMessage received!",
      originalData: data,
      user: socket.userInfo.name,
      socketId: socket.id,
      timestamp: new Date().toISOString(),
    });
  });

  // Handle conversation joining
  socket.on("joinConversation", (conversationId) => {
    socket.conversationId = conversationId;
    socket.join(`conversation_${conversationId}`);
    console.log(
      `🏠 User ${socket.userId} joined conversation ${conversationId}`
    );

    socket.emit("joinedConversation", {
      conversationId: conversationId,
      message: "Successfully joined conversation",
      timestamp: new Date().toISOString(),
    });
  });

  // Handle leaving conversation
  socket.on("leaveConversation", () => {
    if (socket.conversationId) {
      socket.leave(`conversation_${socket.conversationId}`);
      console.log(
        `🚪 User ${socket.userId} left conversation ${socket.conversationId}`
      );
      socket.conversationId = null;
    }
  });

  // Handle message sending
  socket.on("sendMessage", async (data) => {
    try {
      const {
        conversationId,
        content,
        messageType = "text",
        temporaryId,
      } = data;

      console.log(
        `📤 Socket.IO: User ${socket.userId} sending message to conversation ${conversationId}`
      );

      socket.to(`conversation_${conversationId}`).emit("newMessage", {
        id: Date.now(),
        conversationId: conversationId,
        senderId: socket.userId,
        senderName: socket.userInfo.name,
        content: content,
        messageType: messageType,
        createdAt: new Date().toISOString(),
        temporaryId: temporaryId,
      });

      socket.emit("messageStatus", {
        temporaryId: temporaryId,
        status: "sent",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.log("❌ Socket.IO message error:", error);
      socket.emit("error", { message: "Failed to send message" });
    }
  });

  // Handle typing indicators
  socket.on("startTyping", (conversationId) => {
    socket.to(`conversation_${conversationId}`).emit("userTyping", {
      userId: socket.userId,
      userName: socket.userInfo.name,
      conversationId: conversationId,
    });
  });

  socket.on("stopTyping", (conversationId) => {
    socket.to(`conversation_${conversationId}`).emit("userStoppedTyping", {
      userId: socket.userId,
      conversationId: conversationId,
    });
  });

  socket.on("disconnect", (reason) => {
    console.log(
      `🔌 Socket.IO MAIN: User ${socket.userInfo.name} disconnected (${reason})`
    );
    socketUsers.delete(socket.id);
    userSockets.delete(socket.userId);
  });

  socket.on("error", (error) => {
    console.log("❌ Socket.IO MAIN error:", error);
  });
});

// ========== WEBSOCKET SETUP (UNCHANGED) ==========
const wss = new WebSocket.Server({
  server,
  path: "/ws",
});

const connectedUsers = new Map();

wss.on("connection", (ws, req) => {
  console.log("🌐 WebSocket: Client attempting to connect");

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "authenticate") {
        const token = data.token;
        if (!token) {
          ws.send(
            JSON.stringify({ type: "error", message: "No token provided" })
          );
          ws.close();
          return;
        }

        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const [users] = await db.query(
            "SELECT id, name, email FROM users WHERE id = ?",
            [decoded.id]
          );

          if (users.length === 0) {
            ws.send(
              JSON.stringify({ type: "error", message: "User not found" })
            );
            ws.close();
            return;
          }

          ws.userId = users[0].id;
          ws.userInfo = users[0];
          connectedUsers.set(users[0].id, ws);

          ws.send(
            JSON.stringify({
              type: "authenticated",
              user: users[0],
            })
          );

          console.log(`🌐 WebSocket: User ${users[0].name} connected`);
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid token" }));
          ws.close();
        }
      } else if (data.type === "join_conversation") {
        if (ws.userId) {
          ws.conversationId = data.conversationId;
          console.log(
            `🌐 WebSocket: User ${ws.userId} joined conversation ${data.conversationId}`
          );
        }
      } else if (data.type === "leave_conversation") {
        if (ws.userId) {
          console.log(
            `🌐 WebSocket: User ${ws.userId} left conversation ${ws.conversationId}`
          );
          ws.conversationId = null;
        }
      } else if (data.type === "typing_start") {
        if (ws.userId && ws.conversationId) {
          wss.clients.forEach((client) => {
            if (
              client.readyState === 1 &&
              client.conversationId === ws.conversationId &&
              client.userId !== ws.userId
            ) {
              client.send(
                JSON.stringify({
                  type: "user_typing",
                  userId: ws.userId,
                  userName: ws.userInfo.name,
                  conversationId: ws.conversationId,
                })
              );
            }
          });
        }
      } else if (data.type === "typing_stop") {
        if (ws.userId && ws.conversationId) {
          wss.clients.forEach((client) => {
            if (
              client.readyState === 1 &&
              client.conversationId === ws.conversationId &&
              client.userId !== ws.userId
            ) {
              client.send(
                JSON.stringify({
                  type: "user_stopped_typing",
                  userId: ws.userId,
                  conversationId: ws.conversationId,
                })
              );
            }
          });
        }
      }
    } catch (error) {
      console.error("🌐 WebSocket message error:", error);
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid message format" })
      );
    }
  });

  ws.on("close", () => {
    if (ws.userId) {
      connectedUsers.delete(ws.userId);
      console.log(`🌐 WebSocket: User ${ws.userId} disconnected`);
    }
  });

  ws.on("error", (error) => {
    console.error("🌐 WebSocket error:", error);
  });
});

// Make both WebSocket and Socket.IO available to routes
app.set("wss", wss);
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
  console.log("🔌 WebSocket server is ready at ws://192.168.100.87:3003/ws");
  console.log(
    "⚡ Socket.IO server is ready at http://192.168.100.87:3003 (WebSocket only)"
  );
  console.log("🧪 Socket.IO test namespace: http://192.168.100.87:3003/test");
  console.log("HOT RELOAD TEST: " + new Date().toISOString());

  const { containerIP, hostGatewayIP, isDocker } = getDockerNetworkInfo();

  console.log("\n" + "=".repeat(80));
  console.log("📱 FOR FLUTTER SOCKET.IO CONNECTION:");
  console.log(
    `   🟦 Main namespace: http://192.168.100.87:${PORT} (requires auth)`
  );
  console.log(
    `   🧪 Test namespace: http://192.168.100.87:${PORT}/test (no auth)`
  );
  console.log(`   🟩 WebSocket: ws://192.168.100.87:${PORT}/ws`);
  console.log("=".repeat(80) + "\n");
});
