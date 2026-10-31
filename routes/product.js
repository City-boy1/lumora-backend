const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const uploadProductImage = require("../middleware/upload.js");

const {
  getProducts,
  getMyProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} = require("../controllers/productControllers");
const { getProductDetail } = require("../controllers/productDetailController");
const {
  getMyReview,
  createReview,
  updateMyReview,
  deleteMyReview,
} = require("../controllers/reviewsController");

const { verifyAccessToken, allowedRoles } = require("../middleware/authMiddleware");

const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user.id),
  message: { message: "Too many review changes. Try again later." },
});

// Public
router.get("/", getProducts);

// Seller / admin (must come before "/:id")
router.get("/mine", verifyAccessToken, allowedRoles("seller", "admin"), getMyProducts);

// Reviews (signed in)
router.get("/:id/reviews/mine", verifyAccessToken, getMyReview);
router.post("/:id/reviews", verifyAccessToken, reviewLimiter, createReview);
router.put("/:id/reviews/mine", verifyAccessToken, reviewLimiter, updateMyReview);
router.delete("/:id/reviews/mine", verifyAccessToken, reviewLimiter, deleteMyReview);

router.get("/:id", getProductDetail);

router.post("/", verifyAccessToken, allowedRoles("seller", "admin"), uploadProductImage, createProduct);
router.put("/:id", verifyAccessToken, allowedRoles("seller", "admin"), uploadProductImage, updateProduct);
router.delete("/:id", verifyAccessToken, allowedRoles("seller", "admin"), deleteProduct);

module.exports = router;