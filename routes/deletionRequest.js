const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { verifyAccessToken } = require("../middleware/authMiddleware");
const { getMine, create, cancel } = require("../controllers/deletionController");

const router = express.Router();

const limiter = (limit, message) =>
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user.id),
    message: { message },
  });

router.use(verifyAccessToken);

router.get("/", getMine);
router.post("/", limiter(5, "Too many requests. Try again later."), create);
router.delete("/", limiter(10, "Too many requests. Try again later."), cancel);

module.exports = router;