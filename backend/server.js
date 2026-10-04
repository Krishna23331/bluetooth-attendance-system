require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const checkinRouter = require("./routes/checkin");
const sessionsRouter = require("./routes/sessions");
const studentsRouter = require("./routes/students");
const db = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

// Serve modern attendance web dashboard
app.use(express.static(path.join(__dirname, "public")));

// API routes
app.use("/checkin", checkinRouter);
app.use("/sessions", sessionsRouter);
app.use("/students", studentsRouter);

// Lightweight health check endpoint for Render monitoring and cold-start warming
app.get("/health", async (req, res) => {
  let dbStatus = "disconnected";
  try {
    const check = await db.query("SELECT 1 as healthy");
    if (check.rows.length > 0) {
      dbStatus = "connected";
    }
  } catch (err) {
    dbStatus = `error: ${err.message}`;
  }

  const isHealthy = dbStatus === "connected";
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "healthy" : "degraded",
    service: "PACBAS Attendance Backend",
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// Backward-compatible health check endpoint
app.get("/api/health", async (req, res) => {
  res.json({
    service: "PACBAS Attendance Backend",
    status: "running",
    deviceBinding: true,
    timestamp: new Date().toISOString(),
  });
});

// Fallback to web dashboard for unknown GET routes
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/checkin") || req.path.startsWith("/sessions") || req.path.startsWith("/students")) {
    return next();
  }
  res.sendFile(path.join(__dirname, "public", "index.html"), (err) => {
    if (err) next();
  });
});

// Render assigns process.env.PORT dynamically. Local fallback is 3000.
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`====================================================`);
  console.log(`🚀 PACBAS Cloud Attendance Backend live on port ${PORT}`);
  console.log(`   Local URL:    http://localhost:${PORT}`);
  console.log(`   Health Check: http://localhost:${PORT}/health`);
  console.log(`   Environment:  ${process.env.NODE_ENV || "development"}`);
  console.log(`====================================================`);

  // Verify and seed database on boot
  await db.initDb();
});