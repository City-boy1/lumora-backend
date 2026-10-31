const express = require("express");
const router = express.Router();
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const { verifyAccessToken } = require("../middleware/authMiddleware");
const { applyAsSeller } = require("../controllers/sellerApplyController");

// 10 attempts per hour per signed-in user (keyed by user, so shared networks are not punished).
const applyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { message: "Too many attempts. Please try again later." },
});

// Signed-in users only. No allowedRoles here on purpose: the controller reads the role from the
// database and answers a seller with 409 and an admin with 403, as the contract requires.
router.post("/apply", verifyAccessToken, applyLimiter, applyAsSeller);

module.exports = router;