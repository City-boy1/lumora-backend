const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const {
  createOrder, getOrder, listMine, cancelSubOrder, confirmReceived, reportProblem,
} = require("../controllers/ordersController");
const { verifyAccessToken } = require("../middleware/authMiddleware");
const { uploadDisputePhotos } = require("../middleware/uploadDisputePhotos");

const byUser = (req) => String(req.user.id);
const limiter = (limit, message) =>
  rateLimit({
    windowMs: 60 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false,
    keyGenerator: byUser, message: { message },
  });

const createLimiter = limiter(20, "Too many orders. Try again later.");
const cancelLimiter = limiter(30, "Too many cancellations. Try again later.");
const feedbackLimiter = limiter(30, "Too many requests. Try again later.");

router.use(verifyAccessToken);

router.get("/", listMine);                    // before "/:id"
router.post("/", createLimiter, createOrder);
router.patch("/:id/cancel", cancelLimiter, cancelSubOrder);
router.patch("/:id/confirm-received", feedbackLimiter, confirmReceived);
router.post("/:id/report", feedbackLimiter, uploadDisputePhotos, reportProblem);
router.get("/:id", getOrder);

module.exports = router;