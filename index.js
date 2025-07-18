const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const dotenv = require("dotenv");
const WebSocket = require("ws");
const http = require("http");
const os = require("os");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io"); // Add Socket.IO

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
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

// ========== SOCKET.IO SETUP ==========
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for testing
    methods: ["GET", "POST"],
  },
  transports: ["polling", "websocket"], // Allow both transports
  allowEIO3: true, // Support older Socket.IO clients
});

// Store Socket.IO connections with user info
const socketUsers = new Map(); // socketId -> userInfo
const userSockets = new Map(); // userId -> socketId

// Socket.IO authentication middleware
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;

    if (!token) {
      console.log("❌ Socket.IO: No token provided");
      return next(new Error("Authentication error: No token provided"));
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [users] = await db.query(
      "SELECT id, name, email FROM users WHERE id = ?",
      [decoded.id]
    );

    if (users.length === 0) {
      console.log("❌ Socket.IO: User not found");
      return next(new Error("Authentication error: User not found"));
    }

    // Attach user info to socket
    socket.userId = users[0].id;
    socket.userInfo = users[0];

    console.log(`✅ Socket.IO: User ${users[0].name} authenticated`);
    next();
  } catch (error) {
    console.log("❌ Socket.IO authentication error:", error.message);
    next(new Error("Authentication error: Invalid token"));
  }
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log(
    `🔌 Socket.IO: User ${socket.userInfo.name} connected (${socket.id})`
  );

  // Store user connection
  socketUsers.set(socket.id, socket.userInfo);
  userSockets.set(socket.userId, socket.id);

  // Send authentication confirmation
  socket.emit("authenticated", {
    user: socket.userInfo,
    socketId: socket.id,
  });

  // Handle test messages
  socket.on("test", (data) => {
    console.log("🧪 Socket.IO test message:", data);
    socket.emit("testResponse", {
      message: "Test received!",
      originalData: data,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on("testMessage", (data) => {
    console.log("🧪 Socket.IO test message (auth mode):", data);
    socket.emit("testResponse", {
      message: "Authenticated test received!",
      originalData: data,
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

      // Here you would typically save to database and broadcast
      // For now, just broadcast to conversation room
      socket.to(`conversation_${conversationId}`).emit("newMessage", {
        id: Date.now(), // temporary ID
        conversationId: conversationId,
        senderId: socket.userId,
        senderName: socket.userInfo.name,
        content: content,
        messageType: messageType,
        createdAt: new Date().toISOString(),
        temporaryId: temporaryId,
      });

      // Send confirmation to sender
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

  // Handle disconnection
  socket.on("disconnect", (reason) => {
    console.log(
      `🔌 Socket.IO: User ${socket.userInfo.name} disconnected (${reason})`
    );

    // Clean up stored connections
    socketUsers.delete(socket.id);
    userSockets.delete(socket.userId);
  });

  // Handle errors
  socket.on("error", (error) => {
    console.log("❌ Socket.IO error:", error);
  });
});

// ========== EXISTING WEBSOCKET SETUP ==========
const wss = new WebSocket.Server({ server });
const connectedUsers = new Map();

wss.on("connection", (ws, req) => {
  console.log("WebSocket: Client attempting to connect");

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

          console.log(`WebSocket: User ${users[0].name} connected`);
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid token" }));
          ws.close();
        }
      } else if (data.type === "join_conversation") {
        if (ws.userId) {
          ws.conversationId = data.conversationId;
          console.log(
            `WebSocket: User ${ws.userId} joined conversation ${data.conversationId}`
          );
        }
      } else if (data.type === "leave_conversation") {
        if (ws.userId) {
          console.log(
            `WebSocket: User ${ws.userId} left conversation ${ws.conversationId}`
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
      console.error("WebSocket message error:", error);
      ws.send(
        JSON.stringify({ type: "error", message: "Invalid message format" })
      );
    }
  });

  ws.on("close", () => {
    if (ws.userId) {
      connectedUsers.delete(ws.userId);
      console.log(`WebSocket: User ${ws.userId} disconnected`);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
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
  console.log("🔌 WebSocket server is ready for messaging");
  console.log("⚡ Socket.IO server is ready for real-time communication");
  console.log("HOT RELOAD TEST: " + new Date().toISOString());

  const { containerIP, hostGatewayIP, isDocker } = getDockerNetworkInfo();

  console.log("\n" + "=".repeat(70));
  console.log("📱 FOR FLUTTER SOCKET.IO CONNECTION:");
  console.log(`   ✅ Socket.IO URL: http://192.168.100.87:${PORT}`);
  console.log(`   ✅ WebSocket URL: ws://192.168.100.87:${PORT}`);
  console.log("=".repeat(70) + "\n");
});
