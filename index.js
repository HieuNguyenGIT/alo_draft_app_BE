const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const dotenv = require("dotenv");
const WebSocket = require("ws");
const http = require("http");
const os = require("os");
const jwt = require("jsonwebtoken");
require("./tests/test.js");

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
app.use("/api/messages", require("./routes/message.routes")); // Add message routes

// Basic route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to the Todo API" });
});

// Set up WebSocket server with authentication
const wss = new WebSocket.Server({ server });

// Store WebSocket connections with user info
const connectedUsers = new Map();

wss.on("connection", (ws, req) => {
  console.log("Client attempting to connect");

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "authenticate") {
        // Authenticate user via token
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

          // Store user info with WebSocket connection
          ws.userId = users[0].id;
          ws.userInfo = users[0];
          connectedUsers.set(users[0].id, ws);

          ws.send(
            JSON.stringify({
              type: "authenticated",
              user: users[0],
            })
          );

          console.log(`User ${users[0].name} connected via WebSocket`);
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", message: "Invalid token" }));
          ws.close();
        }
      } else if (data.type === "join_conversation") {
        // Join a specific conversation room
        if (ws.userId) {
          ws.conversationId = data.conversationId;
          console.log(
            `User ${ws.userId} joined conversation ${data.conversationId}`
          );

          // 🔥 ADD THIS DEBUG LOG
          console.log(
            `🏠 Client ${ws.userId} now tracking conversation: ${ws.conversationId}`
          );
        }
      } else if (data.type === "leave_conversation") {
        // Leave conversation room
        if (ws.userId) {
          console.log(
            `User ${ws.userId} left conversation ${ws.conversationId}`
          );
          ws.conversationId = null;
        }
      } else if (data.type === "typing_start") {
        // Handle typing indicators
        if (ws.userId && ws.conversationId) {
          wss.clients.forEach((client) => {
            if (
              client.readyState === 1 && // WebSocket.OPEN = 1
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
        // Handle stop typing
        if (ws.userId && ws.conversationId) {
          wss.clients.forEach((client) => {
            if (
              client.readyState === 1 && // WebSocket.OPEN = 1
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
      console.log(`User ${ws.userId} disconnected`);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// Make WebSocket server available to routes
app.set("wss", wss);

// Enhanced network detection for Docker (keeping existing code)
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

const getCommonHostIPs = () => {
  return [
    "192.168.1.x",
    "192.168.0.x",
    "192.168.100.x",
    "10.0.0.x",
    "172.16.x.x",
  ];
};

// Start server
const PORT = process.env.PORT || 3003;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("Database connection is a success");
  console.log("WebSocket server is ready for messaging");
  console.log("HOT RELOAD TEST: " + new Date().toISOString());

  const { containerIP, hostGatewayIP, isDocker } = getDockerNetworkInfo();

  console.log("\n" + "=".repeat(70));

  if (isDocker) {
    console.log("🐳 RUNNING IN DOCKER CONTAINER");
    console.log(`Container Internal IP: ${containerIP} (internal only)`);

    console.log("\n📱 FOR FLUTTER ON PHYSICAL DEVICE:");
    console.log(
      "   ❌ Don't use: localhost:3003 (won't work on physical device)"
    );
    console.log(`   ❌ Don't use: ${containerIP}:3003 (internal Docker IP)`);

    if (hostGatewayIP) {
      console.log(
        `   ⚠️  Try: http://${hostGatewayIP}:${PORT}/api (Docker gateway)`
      );
    }

    console.log("\n   ✅ BEST APPROACH - Use your machine's actual IP:");
    console.log("   1. Find your machine's IP:");
    console.log("      • Windows: ipconfig | findstr IPv4");
    console.log("      • Mac: ifconfig | grep inet");
    console.log("      • Linux: ip addr show");
    console.log("\n   2. Look for IPs in these ranges:");
    getCommonHostIPs().forEach((range) => {
      console.log(`      • ${range} (replace x with actual numbers)`);
    });

    console.log("\n   3. Current example that works:");
    console.log("      • http://192.168.100.87:3003/api ✅");
    console.log("      • ws://192.168.100.87:3003 ✅ (WebSocket)");

    console.log("\n🌐 TEAM SETUP:");
    console.log("   Each team member should:");
    console.log("   1. Run 'ipconfig' (Windows) or 'ifconfig' (Mac/Linux)");
    console.log("   2. Find their machine's IP (usually 192.168.x.x)");
    console.log("   3. Use: http://[THEIR_IP]:3003/api");
    console.log("   4. WebSocket: ws://[THEIR_IP]:3003");

    console.log("\n💡 WHY THIS HAPPENS:");
    console.log("   • Flutter on physical device ≠ Docker container network");
    console.log("   • Device needs to reach your computer via network IP");
    console.log("   • localhost/127.0.0.1 = the device itself (not your PC)");
  } else {
    console.log("💻 RUNNING LOCALLY (not in Docker)");
    console.log("Available on:");
    if (containerIP !== "unknown") {
      console.log(`   http://${containerIP}:${PORT}`);
      console.log(`   http://localhost:${PORT}`);
      console.log(`   ws://${containerIP}:${PORT}`);
      console.log(`   ws://localhost:${PORT}`);
    }
  }

  console.log("\n📋 FOR YOUR FLUTTER constants.dart:");
  console.log("   // Each team member uses their own machine IP");
  console.log(
    `   const String baseUrl = 'http://[YOUR_MACHINE_IP]:${PORT}/api';`
  );
  console.log(`   const String wsUrl = 'ws://[YOUR_MACHINE_IP]:${PORT}';`);
  console.log("   // Example: 'http://192.168.100.87:3003/api'");
  console.log("   // Example: 'ws://192.168.100.87:3003'");

  console.log("=".repeat(70) + "\n");
});
