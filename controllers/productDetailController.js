const mongoose = require("mongoose");
const Product = require("../models/product");
const Store = require("../models/store");
const User = require("../models/user");
const Review = require("../models/review");
const { getHiddenSellerIds } = require("../utils/visibility");
const { attachStores } = require("../utils/storeInfo");

const HIDE_FIELDS = "-reviewedBy -rejectionReason -reviewedAt";

// "Ama Owusu" -> "Ama O."
const shortName = (name) => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Buyer";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
};

async function sellerRating(sellerId) {
  const [r] = await Product.aggregate([
    {
      $match: {
        createdBy: new mongoose.Types.ObjectId(String(sellerId)),
        reviewStatus: "approved",
        ratingCount: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: null,
        weighted: { $sum: { $multiply: ["$ratingAverage", "$ratingCount"] } },
        count: { $sum: "$ratingCount" },
      },
    },
  ]);
  if (!r || !r.count) return { ratingAverage: 0, ratingCount: 0 };
  return { ratingAverage: Math.round((r.weighted / r.count) * 10) / 10, ratingCount: r.count };
}

exports.getProductDetail = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    const hidden = await getHiddenSellerIds();

    const product = await Product.findOne({
      _id: id,
      reviewStatus: "approved",
      createdBy: { $nin: hidden },
    })
      .select(HIDE_FIELDS)
      .populate("category", "name slug")
      .lean();

    if (!product) return res.status(404).json({ message: "Product not found" });

    const [owner, storeDoc, rating] = await Promise.all([
      User.findById(product.createdBy).select("name").lean(),
      Store.findOne({ owner: product.createdBy }).select("name logo address description").lean(),
      sellerRating(product.createdBy),
    ]);

    const store = {
      _id: storeDoc?._id || String(product.createdBy),
      name: storeDoc?.name || owner?.name || "Seller",
      logo: storeDoc?.logo || "",
      address: storeDoc?.address || "",
      description: storeDoc?.description || "",
      ...rating,
    };

    const base = { reviewStatus: "approved", _id: { $ne: product._id }, createdBy: { $nin: hidden } };

    const [moreFromStore, related, reviewRows] = await Promise.all([
      Product.find({ ...base, createdBy: product.createdBy })
        .select(HIDE_FIELDS).populate("category", "name slug")
        .sort({ createdAt: -1 }).limit(8).lean(),
      Product.find({ ...base, category: product.category?._id })
        .select(HIDE_FIELDS).populate("category", "name slug")
        .sort({ createdAt: -1 }).limit(8).lean(),
      Review.find({ product: product._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate("buyer", "name")
        .lean(),
    ]);

    const reviews = reviewRows.map((r) => ({
      _id: r._id,
      rating: r.rating,
      comment: r.comment,
      buyer: { name: shortName(r.buyer?.name) },
      createdAt: r.createdAt,
    }));

    return res.status(200).json({
      product,
      seller: { name: owner?.name || "Seller" },
      store,
      reviews,
      moreFromStore: await attachStores(moreFromStore),
      related: await attachStores(related),
    });
  } catch (err) {
    console.error("getProductDetail:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};