const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const dotenv = require("dotenv");
const WebSocket = require("ws");
const http = require("http");
const os = require("os"); // Add this to get network interfaces
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

// Basic route
app.get("/", (req, res) => {
  res.json({ message: "Welcome to the Todo API" });
});

// Set up WebSocket server
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  console.log("Client connected");

  ws.on("message", (message) => {
    console.log("Received:", message);
    // Handle WebSocket messages here
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

// Function to get local IP addresses
const getLocalIpAddresses = () => {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const interfaceName in interfaces) {
    const interfaceInfo = interfaces[interfaceName];
    for (const info of interfaceInfo) {
      // Skip over non-IPv4 and internal/loopback addresses
      if (info.family === "IPv4" && !info.internal) {
        addresses.push(info.address);
      }
    }
  }

  return addresses;
};

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log("Database connection successful");
  console.log("HOT RELOAD TEST: " + new Date().toISOString());

  // Display IP addresses
  const ipAddresses = getLocalIpAddresses();
  console.log("Available on:");
  ipAddresses.forEach((ip) => {
    console.log(`http://${ip}:${PORT}`);
  });
  console.log("\nFor Flutter app, use this in api_service.dart:");
  if (ipAddresses.length > 0) {
    console.log(
      `static const String baseUrl = 'http://${ipAddresses[0]}:${PORT}/api';`
    );
  }
});
