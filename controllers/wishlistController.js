const mongoose = require("mongoose");
const Product = require("../models/product");
const { getHiddenSellerIds } = require("../utils/visibility");
const { attachStores } = require("../utils/storeInfo");

const MAX_IDS = 100;

exports.resolveWishlist = async (req, res) => {
  try {
    const raw = req.body?.ids;
    if (!Array.isArray(raw)) {
      return res.status(400).json({ message: "ids must be a list" });
    }

    // Strings only, valid ids only, no duplicates, capped
    const ids = [
      ...new Set(
        raw
          .filter((x) => typeof x === "string" && mongoose.isValidObjectId(x))
          .slice(0, MAX_IDS)
      ),
    ];
    if (ids.length === 0) return res.status(200).json({ products: [] });

    const hidden = await getHiddenSellerIds();

    const found = await Product.find({
      _id: { $in: ids },
      reviewStatus: "approved",
      createdBy: { $nin: hidden },
    })
      .select("-reviewedBy -rejectionReason -reviewedAt")
      .populate("category", "name slug")
      .lean();

    // Keep the order the browser sent
    const order = new Map(ids.map((id, i) => [id, i]));
    found.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));

    const withStore = await attachStores(found);
    // The seller id is only needed to build the store; do not send it
    const products = withStore.map(({ createdBy, ...rest }) => rest);

    return res.status(200).json({ products });
  } catch (err) {
    console.error("resolveWishlist:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};