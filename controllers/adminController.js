const mongoose = require("mongoose");
const Product = require("../models/product");
const Category = require("../models/category");
const { logAudit } = require("../utils/audit");
const { notifyProductDecision } = require("../utils/productNotify");

const VALID_STATUSES = ["pending", "approved", "rejected"];
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const getUserId = (req) => {
  const u = req.user;
  const id = u?.id || u?._id || u?.userId;
  return id ? String(id) : null;
};

const slugify = (s) =>
  s
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const cleanName = (raw) => (typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "");

/* ---------- Product review ---------- */

// GET /api/admin/products?status=pending|approved|rejected|all
const getProductsForReview = async (req, res) => {
  try {
    const status = req.query.status || "pending";

    if (status !== "all" && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid status filter" });
    }

    const filter = status === "all" ? {} : { reviewStatus: status };

    const products = await Product.find(filter)
      .populate("category", "name slug")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    return res.status(200).json(products);
  } catch (err) {
    console.error("getProductsForReview:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

// PATCH /api/admin/products/:id/approve
const approveProduct = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    // Atomic: only a product that is not approved yet can be approved,
    // so a double click can never notify the seller twice.
    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, reviewStatus: { $ne: "approved" } },
      {
        reviewStatus: "approved",
        rejectionReason: null,
        reviewedBy: getUserId(req),
        reviewedAt: new Date(),
      },
      { returnDocument: "after" }
    );

    if (!product) {
      const exists = await Product.exists({ _id: req.params.id });
      return exists
        ? res.status(409).json({ message: "This product is already approved" })
        : res.status(404).json({ message: "Product not found" });
    }

    await logAudit(req, {
      action: "product_approved",
      targetType: "product",
      targetId: product._id,
      targetLabel: product.title,
    });
    await notifyProductDecision({ product, approved: true });

    return res.status(200).json({ message: "Product approved", product });
  } catch (err) {
    console.error("approveProduct:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

// PATCH /api/admin/products/:id/reject   body: { reason }
const rejectProduct = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) {
      return res.status(400).json({ message: "Give a reason so the seller can fix the product" });
    }
    if (reason.length > 300) {
      return res.status(400).json({ message: "Keep the reason to 300 characters or fewer" });
    }

    const product = await Product.findOneAndUpdate(
      { _id: req.params.id, reviewStatus: { $ne: "rejected" } },
      {
        reviewStatus: "rejected",
        rejectionReason: reason,
        reviewedBy: getUserId(req),
        reviewedAt: new Date(),
      },
      { returnDocument: "after" }
    );

    if (!product) {
      const exists = await Product.exists({ _id: req.params.id });
      return exists
        ? res.status(409).json({ message: "This product is already rejected" })
        : res.status(404).json({ message: "Product not found" });
    }

    await logAudit(req, {
      action: "product_rejected",
      targetType: "product",
      targetId: product._id,
      targetLabel: product.title,
      reason,
    });
    await notifyProductDecision({ product, approved: false, reason });

    return res.status(200).json({ message: "Product rejected", product });
  } catch (err) {
    console.error("rejectProduct:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

/* ---------- Categories ---------- */

// GET /api/admin/categories  (with how many products use each)
const getCategoriesAdmin = async (req, res) => {
  try {
    const [categories, counts] = await Promise.all([
      Category.find().sort({ name: 1 }).lean(),
      Product.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]),
    ]);

    const countMap = new Map(counts.map((c) => [String(c._id), c.count]));

    return res.status(200).json(
      categories.map((c) => ({ ...c, productCount: countMap.get(String(c._id)) || 0 }))
    );
  } catch (err) {
    console.error("getCategoriesAdmin:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

// POST /api/admin/categories   body: { name }
const createCategory = async (req, res) => {
  try {
    const name = cleanName(req.body?.name);

    if (name.length < 2 || name.length > 40) {
      return res.status(400).json({ message: "Category name must be 2 to 40 characters" });
    }

    const slug = slugify(name);
    if (!slug) {
      return res.status(400).json({ message: "Category name must contain letters or numbers" });
    }

    const category = await Category.create({ name, slug });
    await logAudit(req, {
      action: "category_created",
      targetType: "category",
      targetId: category._id,
      targetLabel: category.name,
    });
    return res.status(201).json({ message: "Category created", category });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "A category with that name already exists" });
    }
    console.error("createCategory:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

// PUT /api/admin/categories/:id   body: { name }
const updateCategory = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    const name = cleanName(req.body?.name);
    if (name.length < 2 || name.length > 40) {
      return res.status(400).json({ message: "Category name must be 2 to 40 characters" });
    }

    const slug = slugify(name);
    if (!slug) {
      return res.status(400).json({ message: "Category name must contain letters or numbers" });
    }

    const before = await Category.findById(req.params.id).select("name").lean();
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { name, slug },
      { returnDocument: "after", runValidators: true }
    );

    if (!category) return res.status(404).json({ message: "Category not found" });

    await logAudit(req, {
      action: "category_updated",
      targetType: "category",
      targetId: category._id,
      targetLabel: category.name,
      meta: { from: before?.name || "" },
    });
    return res.status(200).json({ message: "Category updated", category });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ message: "A category with that name already exists" });
    }
    console.error("updateCategory:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

// DELETE /api/admin/categories/:id  (blocked while products use it)
const deleteCategory = async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid category ID" });
    }

    const inUse = await Product.countDocuments({ category: req.params.id });
    if (inUse > 0) {
      return res.status(409).json({
        message: `${inUse} product${inUse === 1 ? " uses" : "s use"} this category. Move or delete ${
          inUse === 1 ? "it" : "them"
        } first.`,
      });
    }

    const category = await Category.findByIdAndDelete(req.params.id);
    if (!category) return res.status(404).json({ message: "Category not found" });

    await logAudit(req, {
      action: "category_deleted",
      targetType: "category",
      targetId: category._id,
      targetLabel: category.name,
    });
    return res.status(200).json({ message: "Category deleted" });
  } catch (err) {
    console.error("deleteCategory:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

module.exports = {
  getProductsForReview,
  approveProduct,
  rejectProduct,
  getCategoriesAdmin,
  createCategory,
  updateCategory,
  deleteCategory,
};