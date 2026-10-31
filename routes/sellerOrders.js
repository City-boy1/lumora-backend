const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const { listSellerOrders, updateStatus, respondCancelRequest } = require("../controllers/sellerOrdersController");
const { replyToDispute } = require("../controllers/sellerDisputesController");
const { verifyAccessToken, allowedRoles } = require("../middleware/authMiddleware");

const byUser = (req) => String(req.user.id);

const statusLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false,
  keyGenerator: byUser, message: { message: "Too many updates. Try again later." },
});
const replyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  keyGenerator: byUser, message: { message: "Too many replies. Try again later." },
});

router.use(verifyAccessToken, allowedRoles("seller", "admin"));

router.get("/orders", listSellerOrders);
router.patch("/orders/:id/status", statusLimiter, updateStatus);
router.patch("/orders/:id/cancel-request", statusLimiter, respondCancelRequest);
router.post("/disputes/:id/reply", allowedRoles("seller"), replyLimiter, replyToDispute);

module.exports = router;