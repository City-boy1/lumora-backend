const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Product = require("../models/product");
const Category = require("../models/category");
const UserSettings = require("../models/settings")
const { notifyProductSubmitted } = require("../utils/productNotify");
const Store = require("../models/store");
const { attachStores } = require("../utils/storeInfo");

// Sellers whose products buyers must NOT see: either the seller turned their store off
// (settings.seller.showStore) OR an admin suspended the store (Store.status). The two
// flags stay separate; hidden if either one applies.
const getHiddenSellerIds = async () => {
  const [switchedOff, suspended] = await Promise.all([
    UserSettings.find({ "seller.showStore": false }).select("user").lean(),
    Store.find({ status: "suspended" }).select("owner").lean(),
  ]);
  return [...switchedOff.map((d) => d.user), ...suspended.map((s) => s.owner)];
};

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);
const PROJECT_ROOT = path.join(__dirname, "..");

const getUserId = (req) => {
  const u = req.user;
  const id = u?.id || u?._id || u?.userId;
  return id ? String(id) : null;
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const UPLOADS_DIR = path.join(PROJECT_ROOT, "uploads") + path.sep;

const removeImageFile = (imgUrl) => {
  if (!imgUrl || typeof imgUrl !== "string" || !imgUrl.startsWith("/uploads/")) return;
  // Resolve first and refuse anything that escapes /uploads (e.g. "/uploads/../server.js").
  const full = path.resolve(PROJECT_ROOT, "." + imgUrl);
  if (!full.startsWith(UPLOADS_DIR)) return;
  fs.unlink(full, () => {});
};

// Respond with an error and delete any image multer just saved.
const fail = (req, res, status, message) => {
  if (req.file) removeImageFile(`/uploads/products/${req.file.filename}`);
  return res.status(status).json({ message });
};

const parseVariants = (raw) => {
  let parsed = raw;

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: "Product variants contain invalid JSON" };
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { error: "Add at least one product variant" };
  }

  const variants = [];

  for (const v of parsed) {
    const color = typeof v?.color === "string" ? v.color.trim() : "";
    const size = typeof v?.size === "string" ? v.size.trim() : "";
    const price = Number(v?.price);
    const stock = Number(v?.stock);

    if (!color || !size) {
      return { error: "Every variant needs a color and size" };
    }
    if (v.price === "" || v.price == null || !Number.isFinite(price) || price < 0) {
      return { error: "Every variant needs a valid price" };
    }
    if (v.stock === "" || v.stock == null || !Number.isInteger(stock) || stock < 0) {
      return { error: "Every variant needs a whole-number stock quantity" };
    }

    variants.push({ color, size, price, stock });
  }

  return { variants };
};

// Loads a product and makes sure the caller owns it (or is an admin).
const loadManagedProduct = async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    fail(req, res, 400, "Invalid product ID");
    return null;
  }

  const product = await Product.findById(id);

  if (!product) {
    fail(req, res, 404, "Product not found");
    return null;
  }

  const isOwner = String(product.createdBy) === getUserId(req);
  if (!isOwner && req.user?.role !== "admin") {
    fail(req, res, 403, "You can only manage your own products");
    return null;
  }

  return product;
};

/* ---------- Public (guests, buyers) ---------- */

// GET /api/products?search=&category=<id or slug>&sort=newest|oldest
const SORT_OPTIONS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  rating: { ratingAverage: -1, ratingCount: -1, createdAt: -1, _id: -1 },
  price_asc: { minPrice: 1, _id: 1 },
  price_desc: { minPrice: -1, _id: -1 },
};
 
// "" or "abc" or undefined -> null, "12.5" -> 12.5
const toNumber = (value) => {
  if (value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
 
const getProducts = async (req, res) => {
  try {
    const { search, category, sort, minRating, minPrice, maxPrice, inStock, page, limit } =
      req.query;
 
    // ---- Paging numbers (only used when the client sends "page") ----
    const paginated = page !== undefined;
    const pageNum = Math.min(Math.max(parseInt(page, 10) || 1, 1), 1000);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 12, 1), 48);
 
    const send = (products, total = products.length) =>
      res.status(200).json(
        paginated
          ? { products, total, page: pageNum, pages: Math.ceil(total / limitNum) }
          : products
      );
 
    // ---- 1. Filters on stored fields ----
    const match = {
      reviewStatus: "approved",
      createdBy: { $nin: await getHiddenSellerIds() },
    };
 
    if (search && String(search).trim()) {
      match.title = { $regex: escapeRegex(String(search).trim().slice(0, 100)), $options: "i" };
    }
 
    if (category) {
      if (isValidObjectId(category)) {
        // aggregate() does not convert strings to ObjectIds for us, so we do it.
        match.category = new mongoose.Types.ObjectId(category);
      } else {
        const found = await Category.findOne({ slug: String(category) });
        if (!found) return send([]);
        match.category = found._id;
      }
    }
 
    const ratingMin = toNumber(minRating);
    if (ratingMin && ratingMin > 0) {
      match.ratingAverage = { $gte: Math.min(ratingMin, 5) };
    }
 
    if (inStock === "true") {
      match["variants.stock"] = { $gt: 0 };
    }
 
    // ---- 2. Pipeline: filter, work out the "from" price, filter by it, sort ----
    const pipeline = [
      { $match: match },
      { $addFields: { minPrice: { $min: "$variants.price" } } },
    ];
 
    const priceRange = {};
    const priceMin = toNumber(minPrice);
    const priceMax = toNumber(maxPrice);
    if (priceMin !== null) priceRange.$gte = priceMin;
    if (priceMax !== null) priceRange.$lte = priceMax;
    if (Object.keys(priceRange).length) pipeline.push({ $match: { minPrice: priceRange } });
 
    // Own keys only: ?sort=constructor or ?sort=__proto__ must not reach the database.
    const sortKey = typeof sort === "string" && Object.prototype.hasOwnProperty.call(SORT_OPTIONS, sort) ? sort : "newest";
    pipeline.push({ $sort: SORT_OPTIONS[sortKey] });
 
    const populateCategory = (items) =>
      Product.populate(items, { path: "category", select: "name slug" });
 
    // ---- 3a. Old behaviour: everything, no paging ----
    if (!paginated) {
      const items = await Product.aggregate(pipeline);
      await populateCategory(items);
      return send(await attachStores(items));
    }
 
    // ---- 3b. One page of results, plus the total count, in a single query ----
    const [result] = await Product.aggregate([
      ...pipeline,
      {
        $facet: {
          items: [{ $skip: (pageNum - 1) * limitNum }, { $limit: limitNum }],
          total: [{ $count: "count" }],
        },
      },
    ]);
 
    const items = result.items;
    const total = result.total[0]?.count || 0;
    await populateCategory(items);
 
    return send(await attachStores(items), total);
  } catch (err) {
    console.error("getProducts:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

// GET /api/products/:id  (approved only)
const getProduct = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const product = await Product.findOne({
      _id: id,
      reviewStatus: "approved",
      createdBy: { $nin: await getHiddenSellerIds() },
    }).populate("category", "name slug");

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    return res.status(200).json(product);
  } catch (err) {
    console.error("getProduct:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

/* ---------- Seller ---------- */

// GET /api/products/mine  (every status, so the owner can see pending/rejected)
const getMyProducts = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });

    const products = await Product.find({ createdBy: userId })
      .populate("category", "name slug")
      .sort({ createdAt: -1 });

    return res.status(200).json(products);
  } catch (err) {
    console.error("getMyProducts:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

// POST /api/products  (multipart: title, description, category, variants, image)
const createProduct = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return fail(req, res, 401, "Authentication required");

    if (!req.file) return fail(req, res, 400, "A product image is required");

    const { title, description, category } = req.body;

    if (
      typeof title !== "string" || !title.trim() ||
      typeof description !== "string" || !description.trim()
    ) {
      return fail(req, res, 400, "Title and description are required");
    }

    if (!category || !isValidObjectId(category)) {
      return fail(req, res, 400, "Choose a valid category");
    }

    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return fail(req, res, 400, "The selected category does not exist");
    }

    const { variants, error } = parseVariants(req.body.variants);
    if (error) return fail(req, res, 400, error);

    const product = await Product.create({
      title: title.trim(),
      description: description.trim(),
      imgUrl: `/uploads/products/${req.file.filename}`,
      category: categoryExists._id,
      variants,
      createdBy: userId,
      reviewStatus: "pending",
    });

    await product.populate("category", "name slug");

        await notifyProductSubmitted({ product });

    return res.status(201).json({
      message: "Product submitted successfully and is awaiting approval",
      product,
    });
  } catch (err) {
    console.error("createProduct:", err);
    if (err.name === "ValidationError") return fail(req, res, 400, err.message);
    return fail(req, res, 500, "Server Error");
  }
};

// PUT /api/products/:id  (any change sends the product back to review)
const updateProduct = async (req, res) => {
  try {
    const product = await loadManagedProduct(req, res);
    if (!product) return;

    const { title, description, category } = req.body;

    if (title !== undefined && (typeof title !== "string" || !title.trim())) {
      return fail(req, res, 400, "Title cannot be empty");
    }

    if (description !== undefined && (typeof description !== "string" || !description.trim())) {
      return fail(req, res, 400, "Description cannot be empty");
    }

    let categoryId;
    if (category !== undefined) {
      if (!isValidObjectId(category)) return fail(req, res, 400, "Invalid category");
      const categoryExists = await Category.findById(category);
      if (!categoryExists) {
        return fail(req, res, 400, "The selected category does not exist");
      }
      categoryId = categoryExists._id;
    }

    let variants;
    if (req.body.variants !== undefined) {
      const parsed = parseVariants(req.body.variants);
      if (parsed.error) return fail(req, res, 400, parsed.error);
      variants = parsed.variants;
    }

    // Older products may have been saved without an image.
    if (!product.imgUrl && !req.file) {
      return fail(req, res, 400, "Upload a product image");
    }

    const oldImage = product.imgUrl;

    if (title !== undefined) product.title = title.trim();
    if (description !== undefined) product.description = description.trim();
    if (categoryId) product.category = categoryId;
    if (variants) product.variants = variants;
    if (req.file) product.imgUrl = `/uploads/products/${req.file.filename}`;

    const wasPending = product.reviewStatus === "pending"; 

    product.reviewStatus = "pending";
    product.rejectionReason = null;
    product.reviewedBy = null;
    product.reviewedAt = null;

    await product.save();
    if (req.file && oldImage) removeImageFile(oldImage);

    await product.populate("category", "name slug");

        if (!wasPending && req.user?.role !== "admin") await notifyProductSubmitted({ product, edited: true });

    return res.status(200).json({
      message: "Product updated and submitted for approval",
      product,
    });
  } catch (err) {
    console.error("updateProduct:", err);
    if (err.name === "ValidationError") return fail(req, res, 400, err.message);
    return fail(req, res, 500, "Server Error");
  }
};

// DELETE /api/products/:id
const deleteProduct = async (req, res) => {
  try {
    const product = await loadManagedProduct(req, res);
    if (!product) return;

    const image = product.imgUrl;
    await product.deleteOne();
    removeImageFile(image);

    return res.status(200).json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error("deleteProduct:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

module.exports = {
  getProducts,
  getProduct,
  getMyProducts,
  createProduct,
  updateProduct,
  deleteProduct,
};