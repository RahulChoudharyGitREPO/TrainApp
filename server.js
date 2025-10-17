import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

console.log("JWT_SECRET loaded:", !!process.env.JWT_SECRET);
console.log("Environment:", process.env.NODE_ENV);
console.log("TWILIO_ACCOUNT_SID:", process.env.TWILIO_ACCOUNT_SID);

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import connectDB from "./lib/db.js";



const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:5173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:5173",
    ],
    credentials: true,
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 5000;

connectDB();

// Make io accessible to routes
app.set('io', io);

const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:5173",
  ],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

import authRoutes from "./routes/auth.js";
import adminRoutes from "./routes/admin.js";
import trainRoutes from "./routes/trains.js";
import bookingRoutes from "./routes/bookings.js";
import profileRoutes from "./routes/profile.js";
import paymentRoutes from "./routes/payment.js";

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/trains", trainRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/payment", paymentRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Train Booking API is running!",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Train Booking System API",
    version: "1.0.0",
    endpoints: {
      health: "/api/health",
      auth: "/api/auth",
      trains: "/api/trains",
      bookings: "/api/bookings",
      admin: "/api/admin",
    },
  });
});

app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err);

  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      message: "Validation Error",
      errors,
    });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({
      success: false,
      message: `${field} already exists`,
    });
  }

  if (err.name === "JsonWebTokenError") {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }

  if (err.name === "TokenExpiredError") {
    return res.status(401).json({ success: false, message: "Token expired" });
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down server gracefully...");
  process.exit(0);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Promise Rejection:", err);
  process.exit(1);
});

// WebSocket connection handling
const trainViewers = new Map(); // trainId -> Set of socket IDs

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join train room to receive real-time updates
  socket.on('join-train', (trainId) => {
    socket.join(`train-${trainId}`);

    // Track viewers
    if (!trainViewers.has(trainId)) {
      trainViewers.set(trainId, new Set());
    }
    trainViewers.get(trainId).add(socket.id);

    // Broadcast viewer count
    const viewerCount = trainViewers.get(trainId).size;
    io.to(`train-${trainId}`).emit('viewer-count', { trainId, count: viewerCount });

    console.log(`Socket ${socket.id} joined train-${trainId}. Viewers: ${viewerCount}`);
  });

  // Leave train room
  socket.on('leave-train', (trainId) => {
    socket.leave(`train-${trainId}`);

    if (trainViewers.has(trainId)) {
      trainViewers.get(trainId).delete(socket.id);
      const viewerCount = trainViewers.get(trainId).size;

      if (viewerCount === 0) {
        trainViewers.delete(trainId);
      } else {
        io.to(`train-${trainId}`).emit('viewer-count', { trainId, count: viewerCount });
      }
    }

    console.log(`Socket ${socket.id} left train-${trainId}`);
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);

    // Remove from all train rooms
    trainViewers.forEach((viewers, trainId) => {
      if (viewers.has(socket.id)) {
        viewers.delete(socket.id);
        const viewerCount = viewers.size;

        if (viewerCount === 0) {
          trainViewers.delete(trainId);
        } else {
          io.to(`train-${trainId}`).emit('viewer-count', { trainId, count: viewerCount });
        }
      }
    });
  });
});

httpServer.listen(PORT, () => {
  console.log("\n🚀 ================================");
  console.log(`🚂 Train Booking API Server`);
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`📚 API Docs: http://localhost:${PORT}/`);
  console.log(`🔌 WebSocket enabled for real-time updates`);
  console.log("🚀 ================================\n");
});

export default app;
