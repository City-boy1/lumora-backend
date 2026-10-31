require("dotenv").config();

const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const multer = require("multer");
const path = require("path");
const mongoose = require("mongoose");

const Auth = require("./routes/auth");
const Product = require("./routes/product");
const Category = require("./routes/category");
const Notification = require("./routes/notification");
const Orders = require("./routes/orders");
const SellerOrders = require("./routes/sellerOrders");
const Cart = require("./routes/cart");
const Wishlist = require("./routes/wishlist");
const Settings = require("./routes/settings");
const User = require("./routes/user");
const Dashboard = require("./routes/dashboard");
const Admin = require("./routes/admin");
const Sellers = require("./routes/sellers");
const Stores = require("./routes/stores");
const ConnectDB = require("./config/dbConfig");
const sanitizeInput = require("./middleware/sanitizeInput");

const app = express();
const isProd = process.env.NODE_ENV === "production";

// ---------- Startup checks: refuse to run with a broken setup ----------
function checkEnv() {
  const fatal = [];
  const access = process.env.ACCESS_TOKEN_SECRET || "";
  const refresh = process.env.REFRESH_TOKEN_SECRET || "";

  if (!access) fatal.push("ACCESS_TOKEN_SECRET is missing");
  if (!refresh) fatal.push("REFRESH_TOKEN_SECRET is missing");
  if (access && access === refresh) fatal.push("ACCESS_TOKEN_SECRET and REFRESH_TOKEN_SECRET must be different");

  if (isProd) {
    if (access && access.length < 32) fatal.push("ACCESS_TOKEN_SECRET must be at least 32 characters");
    if (refresh && refresh.length < 32) fatal.push("REFRESH_TOKEN_SECRET must be at least 32 characters");
    if (!process.env.CLIENT_ORIGIN) fatal.push("CLIENT_ORIGIN is required in production (your website address)");
    if (!process.env.CLIENT_URL) fatal.push("CLIENT_URL is required in production (used in password reset links)");
  } else {
    if (access && access.length < 32) console.warn("Warning: ACCESS_TOKEN_SECRET is shorter than 32 characters.");
    if (refresh && refresh.length < 32) console.warn("Warning: REFRESH_TOKEN_SECRET is shorter than 32 characters.");
  }

  if (fatal.length) {
    console.error("Cannot start:\n - " + fatal.join("\n - "));
    process.exit(1);
  }
}

// ---------- Behind a host or proxy ----------
// Set TRUST_PROXY to the number of proxies in front of the app (1 for most hosts,
// 2 if you also use Cloudflare). Without this every user looks like one IP address.
const proxyHops = Number(process.env.TRUST_PROXY ?? (isProd ? 1 : 0));
if (Number.isInteger(proxyHops) && proxyHops > 0) app.set("trust proxy", proxyHops);

// Health check for the host. Placed before everything else so it is never rate limited.
app.get("/healthz", (req, res) => {
  const up = mongoose.connection.readyState === 1;
  res.status(up ? 200 : 503).json({ ok: up });
});

// Secure headers. The frontend (another origin) shows images from /uploads,
// so cross-origin loading of those files must stay allowed.
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

// CORS: CLIENT_ORIGIN can hold one address or several separated by commas.
// Requests with no Origin header (server to server, such as a payment webhook) are allowed through;
// browsers always send one.
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "100kb" })); // explicit cap on JSON bodies
app.use(cookieParser());

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Flood guard for the whole API (per IP). Generous on purpose: many phones share one IP on
// mobile networks. Real DDoS protection belongs at the host or CDN (e.g. Cloudflare).
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 3000,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { message: "Too many requests. Please slow down." },
  })
);

// Login and sign-up have their own tight limits inside routes/auth.js. There is deliberately NO
// blanket limit on /api/auth: every signed-in user calls /api/auth/refresh every few minutes.

// Rejects {"$ne":...}-style keys and prototype pollution in body, query and params.
app.use("/api", sanitizeInput);

app.use("/api/auth", Auth);
app.use("/api/products", Product);
app.use("/api/categories", Category);
app.use("/api/orders", Orders);
app.use("/api/seller", SellerOrders);
app.use("/api/cart", Cart);
app.use("/api/wishlist", Wishlist);
app.use("/api/notification", Notification);
app.use("/api/users/me/settings", Settings);
app.use("/api/users/me/deletion-request", require("./routes/deletionRequest"));
app.use("/api/users", User);
app.use("/api/dashboard", Dashboard);
app.use("/api/admin", Admin);
app.use("/api/sellers", Sellers);
app.use("/api/stores", Stores);

// Unknown API paths get a clean 404 instead of an HTML page.
app.use("/api", (req, res) => res.status(404).json({ message: "Not found" }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "That file is too large." });
    }
    return res.status(400).json({ message: "File upload failed" });
  }

  // Body problems
  if (err?.type === "entity.too.large") return res.status(413).json({ message: "Request is too large" });
  if (err?.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid JSON body" });

  // Errors our own code marked as safe to show (HttpError in utils/validate.js)
  if (err?.expose && err?.status) return res.status(err.status).json({ message: err.message });

  // Database and validation errors: never show raw internals to the client.
  if (err?.name === "CastError") return res.status(400).json({ message: "Invalid request" });
  if (err?.name === "ValidationError") return res.status(400).json({ message: "Some fields are invalid" });
  if (typeof err?.name === "string" && err.name.startsWith("Mongo")) {
    console.error(err);
    return res.status(500).json({ message: "Something went wrong. Please try again." });
  }

  if (err) {
    // Legacy behaviour kept so existing upload filters and controllers keep working.
    // TODO: once every controller is reviewed, make unknown errors a generic 500.
    console.error(err);
    return res.status(400).json({ message: err.message || "Request failed" });
  }

  next();
});

// ---------- Start: connect to the database FIRST, then listen ----------
let server;

async function start() {
  checkEnv();

  await ConnectDB();
  // Make sure we really are connected (works whether or not ConnectDB returns a promise).
  await Promise.race([
    mongoose.connection.asPromise(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Database connection timed out")), 20000)),
  ]);

  const PORT = process.env.PORT || 3000;
  server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    require("./jobs/orderJobs").start(); // only after the database is ready
  });
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});

// ---------- Shutdown and crash handling ----------
function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  if (!server) return process.exit(0);
  server.close(async () => {
    try { await mongoose.connection.close(); } catch (e) { /* ignore */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref(); // do not hang forever
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  // Logged, not fatal: much of the app does best-effort work (notifications, emails).
  console.error("Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1); // state is unknown; let the process manager restart it
});