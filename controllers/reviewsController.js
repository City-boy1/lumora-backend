const mongoose = require("mongoose");
const Product = require("../models/product");
const Review = require("../models/review");
const SubOrder = require("../models/subOrder");
const { notifyReview } = require("../utils/reviewNotify");
const { HttpError, asyncHandler } = require("../utils/validate");

const shape = (r) => ({
  _id: r._id,
  rating: r.rating,
  comment: r.comment,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

function productId(req) {
  const id = req.params.id;
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "Product not found");
  return id;
}

function parseBody(body) {
  const b = body && typeof body === "object" ? body : {};

  const rating = Number(b.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new HttpError(400, "Choose a rating from 1 to 5");
  }

  let comment = "";
  if (b.comment !== undefined && b.comment !== null) {
    if (typeof b.comment !== "string") throw new HttpError(400, "Invalid comment");
    comment = b.comment.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    if (comment.length > 1000) throw new HttpError(400, "Comment must be 1000 characters or fewer");
  }
  return { rating, comment };
}

// Has this buyer received this product?
const hasReceived = (buyer, product) =>
  SubOrder.exists({ buyer, status: "delivered", "items.product": product });

// Recompute from the reviews themselves, so it can never drift.
async function recalc(id) {
  const [r] = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(id)) } },
    { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  await Product.updateOne(
    { _id: id },
    { $set: { ratingAverage: r ? Math.round(r.avg * 10) / 10 : 0, ratingCount: r ? r.count : 0 } }
  );
}

/* GET /api/products/:id/reviews/mine  ->  { review, canReview } */
exports.getMyReview = asyncHandler(async (req, res) => {
  const id = productId(req);
  const review = await Review.findOne({ product: id, buyer: req.user.id }).lean();
  const canReview = !review && !!(await hasReceived(req.user.id, id));
  return res.status(200).json({ review: review ? shape(review) : null, canReview });
});

/* POST /api/products/:id/reviews  { rating, comment? } */
exports.createReview = asyncHandler(async (req, res) => {
  const id = productId(req);
  const { rating, comment } = parseBody(req.body);

  const product = await Product.findById(id).select("title createdBy").lean();
  if (!product) throw new HttpError(404, "Product not found");

  if (String(product.createdBy) === String(req.user.id)) {
    throw new HttpError(403, "You can't review your own product");
  }
  if (!(await hasReceived(req.user.id, id))) {
    throw new HttpError(403, "You can review a product after it has been delivered to you.");
  }

  let review;
  try {
    review = await Review.create({ product: id, buyer: req.user.id, rating, comment });
  } catch (err) {
    if (err?.code === 11000) throw new HttpError(409, "You have already reviewed this product.");
    throw err;
  }

  await recalc(id);
  await notifyReview({ product: { _id: id, title: product.title }, rating, sellerId: product.createdBy });

  return res.status(201).json({ review: shape(review.toObject()) });
});

/* PUT /api/products/:id/reviews/mine  { rating, comment? } */
exports.updateMyReview = asyncHandler(async (req, res) => {
  const id = productId(req);
  const { rating, comment } = parseBody(req.body);

  const review = await Review.findOneAndUpdate(
    { product: id, buyer: req.user.id },
    { $set: { rating, comment } },
    { returnDocument: "after", runValidators: true }
  ).lean();
  if (!review) throw new HttpError(404, "You haven't reviewed this product yet.");

  await recalc(id);
  return res.status(200).json({ review: shape(review) });
});

/* DELETE /api/products/:id/reviews/mine */
exports.deleteMyReview = asyncHandler(async (req, res) => {
  const id = productId(req);
  const r = await Review.deleteOne({ product: id, buyer: req.user.id });
  if (r.deletedCount === 0) throw new HttpError(404, "You haven't reviewed this product yet.");

  await recalc(id);
  return res.status(200).json({ ok: true });
});