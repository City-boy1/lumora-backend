const express = require("express");
const router = express.Router();

const { verifyAccessToken } = require("../middleware/authMiddleware");
const { getMySettings, updateMySettings } = require("../controllers/settingsController");

router.use(verifyAccessToken);
router.get("/", getMySettings);
router.patch("/", updateMySettings);

module.exports = router;