const express = require("express");
const router = express.Router();
const { rateLimit } = require("express-rate-limit");

const { verifyAccessToken, allowedRoles } = require("../middleware/authMiddleware");
const {
  getProductsForReview,
  approveProduct,
  rejectProduct,
  getCategoriesAdmin,
  createCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/adminController");
const { listSellers, suspendSeller, reinstateSeller } = require("../controllers/sellerAdminController");
const { listDisputes, resolveDispute } = require("../controllers/adminDisputesController");
const { listAudit } = require("../controllers/auditController");
const { listSellerOpenOrders, adminCancelSubOrder } = require("../controllers/adminOrdersController");
const { listDeletionRequests, resolveDeletionRequest } = require("../controllers/adminDeletionsController");

// Everything under /api/admin is admin-only.
router.use(verifyAccessToken, allowedRoles("admin"));

// Brake on sensitive writes (suspend / reinstate): 30 per 5 minutes per IP.
const sellerWriteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many actions. Please wait a few minutes." },
});

// Brake on resolving disputes: 60 per 5 minutes per IP.
const disputeWriteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many actions. Please wait a few minutes." },
});

const orderCancelLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many actions. Please wait a few minutes." },
});

const deletionWriteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many actions. Please wait a few minutes." },
});

router.get("/products", getProductsForReview);
router.patch("/products/:id/approve", approveProduct);
router.patch("/products/:id/reject", rejectProduct);

router.get("/categories", getCategoriesAdmin);
router.post("/categories", createCategory);
router.put("/categories/:id", updateCategory);
router.delete("/categories/:id", deleteCategory);

router.get("/sellers", listSellers);
router.patch("/sellers/:storeId/suspend", sellerWriteLimiter, suspendSeller);
router.patch("/sellers/:storeId/reinstate", sellerWriteLimiter, reinstateSeller);

router.get("/disputes", listDisputes);
router.patch("/disputes/:id", disputeWriteLimiter, resolveDispute);

router.get("/sellers/:storeId/orders", listSellerOpenOrders);
router.patch("/sub-orders/:id/cancel", orderCancelLimiter, adminCancelSubOrder);

router.get("/audit", listAudit);

router.get("/deletion-requests", listDeletionRequests);
router.patch("/deletion-requests/:id", deletionWriteLimiter, resolveDeletionRequest);

module.exports = router;