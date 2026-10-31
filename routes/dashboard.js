const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const { getSummary } = require("../controllers/dashboardController");
const { verifyAccessToken, allowedRoles } = require("../middleware/authMiddleware");

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.id),
  message: { message: "Too many requests. Try again shortly." },
});

router.use(verifyAccessToken, allowedRoles("buyer", "seller", "admin"));

router.get("/summary", limiter, getSummary);

module.exports = router;