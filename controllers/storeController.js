const mongoose = require("mongoose");
const Store = require("../models/store");
const UserSettings = require("../models/settings");
const { HttpError, asyncHandler, requireText, actorId } = require("../utils/validate");
const { saveLogo, removeStoredLogo } = require("../middleware/uploadLogo");

function optionalDescription(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new HttpError(400, "Description must be text");
  return requireText(value, { min: 0, max: 500, label: "Description" });
}

// Whitelist. suspendedBy and other internals never leave the server; the reason is shown only
// while suspended, because the seller's banner needs it.
const publicStore = (s) => ({
  _id: s._id,
  name: s.name,
  description: s.description || "",
  logo: s.logo || "",
  address: s.address || "",
  status: s.status,
  ...(s.status === "suspended" ? { suspensionReason: s.suspensionReason || "" } : {}),
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

// GET /api/stores/mine   (seller)
exports.getMyStore = asyncHandler(async (req, res) => {
  const store = await Store.findOne({ owner: actorId(req) }).lean();
  if (!store) throw new HttpError(404, "You haven't set up your store yet");
  res.json({ store: publicStore(store) });
});

// PUT /api/stores/mine   (seller; multipart or JSON: name, description, address, logo?)
// Creates the store if an older seller account has none. Never touches status or suspension fields.
exports.updateMyStore = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};

  // Check the text first, so a bad form never leaves a file on disk.
  const name = requireText(body.name, { min: 3, max: 60, label: "Store name" });
  const address = requireText(body.address, { min: 5, max: 200, label: "Location" });
  const description = optionalDescription(body.description);

  const owner = actorId(req);
  const previous = await Store.findOne({ owner }).select("logo").lean();

  const logoUrl = req.file ? await saveLogo(req.file) : null;

  const update = { $set: { name, description, address, ...(logoUrl ? { logo: logoUrl } : {}) } };
  const options = { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true };

  let store;
  try {
    try {
      store = await Store.findOneAndUpdate({ owner }, update, options);
    } catch (err) {
      // Two first-time saves at the same moment: the unique index rejects one. The store exists now, so retry once.
      if (err?.code !== 11000) throw err;
      store = await Store.findOneAndUpdate({ owner }, update, options);
    }
  } catch (err) {
    if (logoUrl) await removeStoredLogo(logoUrl); // do not leave an orphan file behind
    throw err;
  }

  if (logoUrl && previous?.logo && previous.logo !== logoUrl) await removeStoredLogo(previous.logo);

  res.json({ store: publicStore(store.toObject()) });
});


// ---------------------------------------------------------------- public store page

const PUBLIC_PRODUCT_LIMIT = 48; // fixed cap: a store page can never return an unbounded list
const OBJECT_ID = /^[a-f\d]{24}$/i;

// GET /api/stores/:id   (anyone)
// :id is the store's _id. An owner's user id is accepted too, so links built from the seller
// id still work. A suspended store, or one the seller switched off, answers exactly like a
// store that does not exist, so nothing leaks about why.
exports.getPublicStore = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (typeof id !== "string" || !OBJECT_ID.test(id)) throw new HttpError(404, "Store not found");

  const store =
    (await Store.findById(id).lean()) || (await Store.findOne({ owner: id }).lean());
  if (!store || store.status === "suspended") throw new HttpError(404, "Store not found");

  const switchedOff = await UserSettings.exists({ user: store.owner, "seller.showStore": false });
  if (switchedOff) throw new HttpError(404, "Store not found");

  const Product = mongoose.model("Product");
  const approved = { createdBy: store.owner, reviewStatus: "approved" };

  const [products, ratingRows] = await Promise.all([
    Product.find(approved)
      .select("title imgUrl images variants ratingAverage ratingCount category createdAt")
      .sort({ createdAt: -1, _id: -1 })
      .limit(PUBLIC_PRODUCT_LIMIT)
      .populate("category", "name slug")
      .lean(),
    // Store rating = average of the products' ratings, weighted by how many reviews each has.
    Product.aggregate([
      { $match: approved },
      {
        $group: {
          _id: null,
          weighted: { $sum: { $multiply: [{ $ifNull: ["$ratingAverage", 0] }, { $ifNull: ["$ratingCount", 0] }] } },
          ratingCount: { $sum: { $ifNull: ["$ratingCount", 0] } },
        },
      },
    ]),
  ]);

  const ratingCount = ratingRows[0]?.ratingCount || 0;
  const ratingAverage = ratingCount ? Math.round((ratingRows[0].weighted / ratingCount) * 10) / 10 : 0;

  res.json({
    store: {
      _id: store._id,
      name: store.name,
      logo: store.logo || "",
      address: store.address || "",
      description: store.description || "",
    },
    // Whitelisted fields only (no createdBy, review fields or other internals), with the store name
    // attached because the product card shows it.
    products: products.map((p) => ({
      _id: p._id,
      title: p.title,
      imgUrl: p.imgUrl,
      ...(p.images ? { images: p.images } : {}),
      variants: (p.variants || []).map((v) => ({ _id: v._id, color: v.color, size: v.size, stock: v.stock, price: v.price })),
      ratingAverage: p.ratingAverage || 0,
      ratingCount: p.ratingCount || 0,
      category: p.category || null,
      createdAt: p.createdAt,
      store: { _id: store._id, name: store.name },
    })),
    ratingAverage,
    ratingCount,
  });
});