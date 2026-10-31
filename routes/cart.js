const express = require("express");
const router = express.Router();
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const { verifyAccessToken } = require("../middleware/authMiddleware");
const { getCart, saveCart, mergeCart, resolveCart } = require("../controllers/cartController");

const limit = (max, keyGenerator) =>
  rateLimit({
    windowMs: 60 * 1000,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator,
    message: { message: "Too many cart requests. Please slow down." },
  });

// Public (guests too): 120 per minute per address. The cart page calls it on every change.
const resolveLimiter = limit(120, (req) => ipKeyGenerator(req.ip));
// Signed in: 120 per minute per user.
const writeLimiter = limit(120, (req) => req.user?.id || ipKeyGenerator(req.ip));

router.post("/resolve", resolveLimiter, resolveCart);
router.get("/", verifyAccessToken, getCart);
router.put("/", verifyAccessToken, writeLimiter, saveCart);
router.post("/merge", verifyAccessToken, writeLimiter, mergeCart);

module.exports = router;