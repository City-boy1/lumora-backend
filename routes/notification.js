const express = require("express");
const router = express.Router();

const { listMine, markRead, markAllRead } = require("../controllers/notificationController");
const { verifyAccessToken } = require("../middleware/authMiddleware");

router.use(verifyAccessToken);

router.get("/", listMine);
router.patch("/read-all", markAllRead); // keep above any /:id route
router.patch("/:id/read", markRead);

module.exports = router;