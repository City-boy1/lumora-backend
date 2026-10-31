const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

const { getMyProfile, updateMyProfile } = require("../controllers/userController");
const { verifyAccessToken } = require("../middleware/authMiddleware");
const { uploadAvatar } = require("../middleware/uploadAvatar");

const saveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.id),
  message: { message: "Too many profile updates. Try again later." },
});

router.use(verifyAccessToken);

router.get("/me", getMyProfile);
router.patch("/me", saveLimiter, uploadAvatar, updateMyProfile);

module.exports = router;