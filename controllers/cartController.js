const mongoose = require("mongoose");
const ShoppingCart = require("../models/cart");
const Store = require("../models/store");
const { HttpError, asyncHandler, actorId } = require("../utils/validate");
const { getHiddenSellerIds } = require("../utils/visibility");

const MAX_LINES = 100;
const MAX_QTY = 99;
const SUGGESTION_COUNT = 8;
const OBJECT_ID = /^[a-f\d]{24}$/i;

const Product = () => mongoose.model("Product");
const User = () => mongoose.model("User");

/* ---------------------------------------------------------------- input */

const shortText = (v) => (typeof v === "string" ? v.trim().slice(0, 50) : "");

// Turns whatever the client sent into clean cart lines. Bad lines are DROPPED, not fatal: a guest
// cart in an old browser may hold junk, and one bad line must not block sign-in or the cart page.
// Same product + colour + size are merged; at most 100 lines; quantity 1-99; nothing but plain
// strings and numbers is ever copied, so no object can reach a database query.
function parseLines(raw) {
  const map = new Map();
  for (const l of (Array.isArray(raw) ? raw : []).slice(0, MAX_LINES * 3)) {
    if (!l || typeof l !== "object") continue;
    if (typeof l.productId !== "string" || !OBJECT_ID.test(l.productId)) continue;
    const quantity = Number(l.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) continue;

    const color = shortText(l.color);
    const size = shortText(l.size);
    const key = `${l.productId}|${color}|${size}`;
    const price = Number(l.priceAtSelection);
    const priceAtSelection = Number.isFinite(price) && price >= 0 && price <= 10_000_000 ? price : undefined;

    const existing = map.get(key);
    if (existing) existing.quantity = Math.min(existing.quantity + quantity, MAX_QTY);
    else if (map.size < MAX_LINES) map.set(key, { productId: l.productId, color, size, quantity: Math.min(quantity, MAX_QTY), priceAtSelection });
  }
  return [...map.values()];
}

// The frontend's cart context may name the list "lines" or "items", or send a bare array.
function linesFromBody(body) {
  const raw = Array.isArray(body) ? body : body?.lines ?? body?.items;
  if (!Array.isArray(raw)) throw new HttpError(400, "lines must be a list");
  return parseLines(raw);
}

const toClient = (lines) =>
  lines.map((l) => ({
    productId: String(l.productId),
    color: l.color || "",
    size: l.size || "",
    quantity: l.quantity,
    ...(l.priceAtSelection != null ? { priceAtSelection: l.priceAtSelection } : {}),
  }));

const reply = (res, lines) => {
  const clean = toClient(lines);
  res.json({ lines: clean, items: clean }); // both names, so either side of the app can read it
};

const variantOf = (product, line) => (product.variants || []).find((v) => (v.color || "") === line.color && (v.size || "") === line.size);

/* ------------------------------------------------------------ saved cart */

// GET /api/cart   (signed in)
exports.getCart = asyncHandler(async (req, res) => {
  const cart = await ShoppingCart.findOne({ user: actorId(req) }).lean();
  reply(res, cart?.lines || []);
});

async function saveLines(userId, lines) {
  const options = { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true };
  try {
    return await ShoppingCart.findOneAndUpdate({ user: userId }, { $set: { lines } }, options);
  } catch (err) {
    if (err?.code !== 11000) throw err; // two first saves at once: the unique index rejected one, so retry
    return ShoppingCart.findOneAndUpdate({ user: userId }, { $set: { lines } }, options);
  }
}

// PUT /api/cart   body { lines: [...] }   replaces the saved cart
exports.saveCart = asyncHandler(async (req, res) => {
  const lines = linesFromBody(req.body);
  const saved = await saveLines(actorId(req), lines);
  reply(res, saved.lines);
});

// POST /api/cart/merge   body { lines: [...] }   (the guest cart, right after sign-in)
// Same product + colour + size add together, capped at current stock. Lines whose product is gone,
// unapproved, hidden or whose option no longer exists are dropped.
exports.mergeCart = asyncHandler(async (req, res) => {
  const incoming = linesFromBody(req.body);
  const userId = actorId(req);
  const existing = (await ShoppingCart.findOne({ user: userId }).lean())?.lines || [];

  const combined = parseLines([...toClient(existing), ...incoming]);
  if (!combined.length) return reply(res, (await saveLines(userId, [])).lines);

  const hidden = new Set((await getHiddenSellerIds()).map(String));
  const ids = [...new Set(combined.map((l) => l.productId))];
  const products = await Product().find({ _id: { $in: ids }, reviewStatus: "approved" }).select("variants createdBy").lean();
  const byId = new Map(products.filter((p) => !hidden.has(String(p.createdBy))).map((p) => [String(p._id), p]));

  const kept = [];
  for (const line of combined) {
    const product = byId.get(line.productId);
    const variant = product && variantOf(product, line);
    if (!variant) continue;
    const stock = Number(variant.stock) || 0;
    kept.push({ ...line, quantity: stock > 0 ? Math.min(line.quantity, stock) : line.quantity });
  }

  const saved = await saveLines(userId, kept);
  reply(res, saved.lines);
});

/* --------------------------------------------------------------- resolve */

// POST /api/cart/resolve   (public: guests use it too)   body { lines: [...] }
// Looks every line up fresh. The price is ALWAYS the current server price; any price the client
// sends is ignored except as "priceAtSelection" for the "price changed" notice.
exports.resolveCart = asyncHandler(async (req, res) => {
  const lines = linesFromBody(req.body);
  const hidden = new Set((await getHiddenSellerIds()).map(String));
  const cartIds = [...new Set(lines.map((l) => l.productId))];

  const found = cartIds.length
    ? await Product().find({ _id: { $in: cartIds } }).select("title imgUrl variants category createdBy reviewStatus").lean()
    : [];
  const byId = new Map(found.map((p) => [String(p._id), p]));

  const byOwner = new Map(); // ownerId -> resolved lines
  const unavailable = [];
  const categoryIds = new Set();
  let subtotalCents = 0;

  for (const line of lines) {
    const p = byId.get(line.productId);
    if (!p) continue; // deleted: drops out of the cart

    const base = { productId: line.productId, color: line.color, size: line.size };
    const visible = p.reviewStatus === "approved" && !hidden.has(String(p.createdBy));

    if (!visible) {
      // Edited and back in review, or the seller is suspended or hidden. Reveal nothing about it.
      unavailable.push({ ...base, quantity: line.quantity, title: "Unavailable item", image: "", unitPrice: 0, stock: 0, unavailable: true, reason: "This item is no longer available" });
      continue;
    }

    if (p.category) categoryIds.add(String(p.category));
    const variant = variantOf(p, line);
    const out = { ...base, title: p.title, image: p.imgUrl || "", quantity: line.quantity, unitPrice: variant ? Number(variant.price) || 0 : 0, stock: variant ? Number(variant.stock) || 0 : 0 };
    if (line.priceAtSelection != null) out.priceAtSelection = line.priceAtSelection;

    if (!variant) {
      Object.assign(out, { unavailable: true, reason: "This option is no longer available" });
    } else if (out.stock <= 0) {
      Object.assign(out, { unavailable: true, reason: "Out of stock" });
    } else {
      if (out.quantity > out.stock) {
        out.quantity = out.stock;
        out.adjusted = true;
        out.reason = `Only ${out.stock} left`;
      }
      out.unavailable = false;
      subtotalCents += Math.round(out.unitPrice * 100) * out.quantity;
    }

    const owner = String(p.createdBy);
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(out);
  }

  // Suggestions: same category as what is in the cart first, then the newest; never what is already
  // in the cart, never a hidden seller, never sold out.
  const baseFilter = {
    _id: { $nin: cartIds },
    reviewStatus: "approved",
    createdBy: { $nin: [...hidden] },
    variants: { $elemMatch: { stock: { $gt: 0 } } },
  };
  const pick = "title imgUrl variants ratingAverage ratingCount category createdBy";
  let suggestions = [];
  if (categoryIds.size) {
    suggestions = await Product()
      .find({ ...baseFilter, category: { $in: [...categoryIds] } })
      .select(pick).sort({ createdAt: -1, _id: -1 }).limit(SUGGESTION_COUNT).populate("category", "name slug").lean();
  }
  if (suggestions.length < SUGGESTION_COUNT) {
    const more = await Product()
      .find({ ...baseFilter, _id: { $nin: [...cartIds, ...suggestions.map((s) => s._id)] } })
      .select(pick).sort({ createdAt: -1, _id: -1 }).limit(SUGGESTION_COUNT - suggestions.length).populate("category", "name slug").lean();
    suggestions = suggestions.concat(more);
  }

  // Store and seller names for every owner involved, in two queries.
  const ownerIds = [...new Set([...byOwner.keys(), ...suggestions.map((s) => String(s.createdBy))])];
  const [stores, users] = ownerIds.length
    ? await Promise.all([
        Store.find({ owner: { $in: ownerIds } }).select("name logo owner").lean(),
        User().find({ _id: { $in: ownerIds } }).select("name").lean(),
      ])
    : [[], []];
  const storeByOwner = new Map(stores.map((s) => [String(s.owner), s]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  // The store page also answers to an owner id, so a seller with no Store document still links somewhere.
  const storeInfo = (owner) => {
    const s = storeByOwner.get(owner);
    return { _id: s?._id || owner, name: s?.name || userById.get(owner)?.name || "Seller", logo: s?.logo || "" };
  };

  const groups = [...byOwner.entries()].map(([owner, ls]) => ({
    store: storeInfo(owner),
    seller: { name: userById.get(owner)?.name || "" },
    lines: ls,
  }));
  if (unavailable.length) {
    groups.push({ store: { _id: "unavailable", name: "Unavailable items", logo: "" }, seller: { name: "" }, lines: unavailable });
  }

  res.json({
    groups,
    suggestions: suggestions.map((p) => ({
      _id: p._id,
      title: p.title,
      imgUrl: p.imgUrl,
      variants: (p.variants || []).map((v) => ({ _id: v._id, color: v.color, size: v.size, stock: v.stock, price: v.price })),
      ratingAverage: p.ratingAverage || 0,
      ratingCount: p.ratingCount || 0,
      category: p.category || null,
      store: storeInfo(String(p.createdBy)),
    })),
    subtotal: subtotalCents / 100,
  });
});