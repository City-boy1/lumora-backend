const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const { resolveWishlist } = require("../controllers/wishlistController");

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests. Try again shortly." },
});

router.post("/resolve", limiter, resolveWishlist);

module.exports = router;