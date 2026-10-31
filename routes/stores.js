const express = require("express");
const router = express.Router();
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const { verifyAccessToken, allowedRoles } = require("../middleware/authMiddleware");
const { receiveLogo } = require("../middleware/uploadLogo");
const { getMyStore, updateMyStore, getPublicStore } = require("../controllers/storeController");

// Saving the store (with a possible upload): 30 per hour per signed-in user.
const saveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip),
  message: { message: "Too many changes. Please try again later." },
});

// "/mine" must stay ABOVE any "/:id" route added later.
router.get("/mine", verifyAccessToken, allowedRoles("seller"), getMyStore);
router.put("/mine", verifyAccessToken, allowedRoles("seller"), saveLimiter, receiveLogo, updateMyStore);

// Public store page. Defined AFTER "/mine" so "mine" is never read as an id.
router.get("/:id", getPublicStore);

module.exports = router;