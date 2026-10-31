const mongoose = require("mongoose");
const crypto = require("crypto");
const Product = require("../models/product");
const Store = require("../models/store");
const User = require("../models/user");
const ShoppingCart = require("../models/cart");
const ShopOrder = require("../models/shopOrder");
const SubOrder = require("../models/subOrder");
const Dispute = require("../models/dispute");
const { notifyDisputeOpened } = require("../utils/disputeNotify");
const { saveDisputePhotos, deleteDisputePhotos } = require("../middleware/uploadDisputePhotos");
const { getHiddenSellerIds } = require("../utils/visibility");
const { startPayment } = require("../services/paymentService");
const { notifyOrderPlaced, notifyCancelled } = require("../utils/orderNotify");
const { notifyLowStock } = require("../utils/stockNotify");
const { HttpError, asyncHandler } = require("../utils/validate");
const { cancelSubOrder: cancelSubOrderNow } = require("../services/cancelService");
const { BUYER_REASONS, resolveReason, shapeCancelRequest } = require("../utils/cancelReasons");
const { notifyCancelRequest } = require("../utils/cancelNotify");

const REGIONS = [
  "Greater Accra", "Ashanti", "Central", "Eastern", "Western", "Western North", "Volta", "Oti",
  "Northern", "Savannah", "North East", "Upper East", "Upper West", "Bono", "Bono East", "Ahafo",
];
const NETWORKS = ["MTN MoMo", "Telecel Cash", "AirtelTigo Money"];
const PHONE_RE = /^(\+233|0)\d{9}$/;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const money = (n) => Math.round(n * 100) / 100;
const quiet = (p) => Promise.resolve(p).catch((e) => console.error(e));

function makeOrderNumber() {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let s = "";
  for (const b of crypto.randomBytes(6)) s += ALPHABET[b % ALPHABET.length];
  return `LUM-${ymd}-${s}`;
}

function text(v, min, max, label, optional = false) {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (!s && optional) return "";
  if (typeof v !== "string" || s.length < min || s.length > max) {
    throw new HttpError(400, `${label} must be ${min} to ${max} characters`);
  }
  return s;
}

function parseInput(body) {
  const b = body && typeof body === "object" ? body : {};

  const key = typeof b.idempotencyKey === "string" ? b.idempotencyKey.trim() : "";
  if (key.length < 8 || key.length > 100) {
    throw new HttpError(400, "Missing order key. Refresh the page and try again.");
  }

  const a = b.address && typeof b.address === "object" ? b.address : {};
  if (!REGIONS.includes(a.region)) throw new HttpError(400, "Choose a valid region");
  const address = {
    fullName: text(a.fullName, 2, 80, "Full name"),
    region: a.region,
    city: text(a.city, 1, 80, "Town or city"),
    line1: text(a.line1, 5, 200, "Address"),
    notes: text(a.notes, 0, 300, "Delivery notes", true),
  };

  const phone = typeof b.phone === "string" ? b.phone.replace(/\s/g, "") : "";
  if (!PHONE_RE.test(phone)) throw new HttpError(400, "Enter a valid Ghana phone number");

  const p = b.payment && typeof b.payment === "object" ? b.payment : {};
  if (p.method !== "mobile_money" && p.method !== "card") {
    throw new HttpError(400, "Choose a payment method");
  }
  const payment = { method: p.method };
  if (p.method === "mobile_money") {
    if (!NETWORKS.includes(p.network)) throw new HttpError(400, "Choose a Mobile Money network");
    const momo = typeof p.momoNumber === "string" ? p.momoNumber.replace(/\s/g, "") : "";
    if (!PHONE_RE.test(momo)) throw new HttpError(400, "Enter a valid Mobile Money number");
    payment.network = p.network;
    payment.momoNumber = momo;
  }

  return { key, address, phone, payment };
}

// Attach each sub-order's newest dispute (if any) so the buyer sees its status
async function attachDisputes(subs) {
  if (!subs.length) return subs;
  const rows = await Dispute.find({ subOrder: { $in: subs.map((s) => s._id) } })
    .sort({ createdAt: -1 })
    .select("subOrder status adminNote")
    .lean();
  const newest = new Map();
  for (const r of rows) if (!newest.has(String(r.subOrder))) newest.set(String(r.subOrder), r);
  for (const s of subs) s.dispute = newest.get(String(s._id)) || null;
  return subs;
}

/* ---------- response shaping ---------- */

const shapeSub = (s) => ({
  _id: s._id,
  store: { _id: s.store?._id, name: s.store?.name, logo: s.store?.logo || "" },
  status: s.status,
  subtotal: s.subtotal,
  items: (s.items || []).map((i) => ({
    product: i.product, title: i.title, image: i.image, color: i.color, size: i.size,
    unitPrice: i.unitPrice, quantity: i.quantity, lineTotal: i.lineTotal,
  })),
  timeline: (s.timeline || []).map((t) => ({ status: t.status, at: t.at, note: t.note })),
  deliveredAt: s.deliveredAt || null,
  receivedAt: s.receivedAt || null,
    cancelRequest: shapeCancelRequest(s.cancelRequest),
  dispute: s.dispute ? { status: s.dispute.status, adminNote: s.dispute.adminNote || "" } : null,
});

function deriveStatus(subs) {
  const live = subs.filter((s) => s.status !== "cancelled");
  if (live.length === 0) return "cancelled";
  const delivered = live.filter((s) => s.status === "delivered").length;
  if (delivered === live.length) return "completed";
  if (delivered > 0) return "partially_delivered";
  return "in_progress";
}

function shapeOrder(o, subs) {
  return {
    _id: o._id,
    orderNumber: o.orderNumber,
    createdAt: o.createdAt,
    address: o.address,
    phone: o.phone,
    itemsTotal: o.itemsTotal,
    deliveryFee: o.deliveryFee,
    grandTotal: o.grandTotal,
    payment: o.payment,
    status: deriveStatus(subs),
    subOrders: subs.map(shapeSub),
  };
}

async function fullOrder(orderLean) {
  const subs = await attachDisputes(await SubOrder.find({ order: orderLean._id }).sort({ createdAt: 1 }).lean());
  return shapeOrder(orderLean, subs);
}

/* ---------- POST /api/orders ---------- */

exports.createOrder = asyncHandler(async (req, res) => {
  const buyerId = req.user.id;
  const input = parseInput(req.body);

  // Same key from the same buyer = same order (double click, retry)
  const existing = await ShopOrder.findOne({ buyer: buyerId, idempotencyKey: input.key }).lean();
  if (existing) return res.status(200).json({ order: await fullOrder(existing) });

  // 1. The cart comes from the database, never from the request
  const cart = await ShoppingCart.findOne({ user: buyerId }).lean();
  const lines = cart?.lines || [];
  if (lines.length === 0) throw new HttpError(400, "Your cart is empty");

  // 2. Current product data and prices
  const hidden = await getHiddenSellerIds();
  const ids = [...new Set(lines.map((l) => String(l.productId)))];
  const products = await Product.find({
    _id: { $in: ids },
    reviewStatus: "approved",
    createdBy: { $nin: hidden },
  }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const merged = new Map();
  const problems = new Set();

  for (const l of lines) {
    const p = byId.get(String(l.productId));
    if (!p) { problems.add("An item in your cart is no longer available."); continue; }

    // 3. Block sellers buying their own products
    if (String(p.createdBy) === String(buyerId)) {
      throw new HttpError(400, `You can't buy your own product (${p.title}). Remove it from your cart.`);
    }

    const v = (p.variants || []).find(
      (x) => (x.color || "") === (l.color || "") && (x.size || "") === (l.size || "")
    );
    if (!v) { problems.add(`${p.title} is no longer available in that option.`); continue; }

    const key = `${p._id}|${v._id}`;
    const entry = merged.get(key) || { p, v, quantity: 0 };
    entry.quantity += Math.max(1, Math.floor(Number(l.quantity)) || 1);
    merged.set(key, entry);
  }

  for (const { p, v, quantity } of merged.values()) {
    if (quantity > v.stock) {
      problems.add(v.stock > 0 ? `${p.title} only has ${v.stock} left.` : `${p.title} is sold out.`);
    }
  }
  if (problems.size) {
    throw new HttpError(409, `${[...problems].join(" ")} Please review your cart.`);
  }

  // 4. Group by seller, with snapshots
  const sellerIds = [...new Set([...merged.values()].map((m) => String(m.p.createdBy)))];
  const [stores, users] = await Promise.all([
    Store.find({ owner: { $in: sellerIds } }).select("owner name logo").lean(),
    User.find({ _id: { $in: sellerIds } }).select("name").lean(),
  ]);
  const storeBy = new Map(stores.map((s) => [String(s.owner), s]));
  const nameBy = new Map(users.map((u) => [String(u._id), u.name]));

  const groups = new Map();
  for (const { p, v, quantity } of merged.values()) {
    const sid = String(p.createdBy);
    if (!groups.has(sid)) {
      const st = storeBy.get(sid);
      groups.set(sid, {
        id: new mongoose.Types.ObjectId(),
        sellerId: sid,
        store: {
          _id: st?._id || sid,
          name: st?.name || nameBy.get(sid) || "Seller",
          logo: st?.logo || "",
        },
        items: [],
      });
    }
    groups.get(sid).items.push({
      product: p._id,
      variant: v._id,
      title: p.title,
      image: p.imgUrl || "",
      color: v.color || "",
      size: v.size || "",
      unitPrice: v.price,
      quantity,
      lineTotal: money(v.price * quantity),
    });
  }

  const groupList = [...groups.values()];
  const itemsTotal = money(groupList.reduce((s, g) => s + g.items.reduce((t, i) => t + i.lineTotal, 0), 0));
  const deliveryFee = 0; // no delivery pricing yet; checkout says "confirmed on order"
  const grandTotal = money(itemsTotal + deliveryFee);

  // 5. Reserve stock atomically, line by line
  const reserved = [];
  const release = async () => {
    for (const r of reserved) {
      await quiet(
        Product.updateOne(
          { _id: r.product, "variants._id": r.variant },
          { $inc: { "variants.$.stock": r.quantity } }
        )
      );
    }
  };

  const orderId = new mongoose.Types.ObjectId();
  let orderCreated = false;

  try {
    for (const g of groupList) {
      for (const it of g.items) {
        const r = await Product.updateOne(
          { _id: it.product, variants: { $elemMatch: { _id: it.variant, stock: { $gte: it.quantity } } } },
          { $inc: { "variants.$.stock": -it.quantity } }
        );
        if (r.matchedCount === 0) {
          throw new HttpError(409, `${it.title} just sold out or has less stock than you asked for. Please review your cart.`);
        }
        reserved.push({ product: it.product, variant: it.variant, quantity: it.quantity });
      }
    }

    // 7. Payment goes through one service (simulated for now)
    const payment = await startPayment({
      orderId,
      amount: grandTotal,
      method: input.payment.method,
      network: input.payment.network,
      momoNumber: input.payment.momoNumber,
    });

    // 6. Create the order and one sub-order per seller
    const now = new Date();
    const subDocs = groupList.map((g) => ({
      _id: g.id,
      order: orderId,
      buyer: buyerId,
      seller: g.sellerId,
      store: g.store,
      items: g.items,
      subtotal: money(g.items.reduce((t, i) => t + i.lineTotal, 0)),
      status: "placed",
      timeline: [{ status: "placed", at: now, note: "", by: buyerId }],
    }));

    let order = null;
    for (let attempt = 0; attempt < 4 && !order; attempt++) {
      try {
        order = await ShopOrder.create({
          _id: orderId,
          orderNumber: makeOrderNumber(),
          buyer: buyerId,
          idempotencyKey: input.key,
          address: input.address,
          phone: input.phone,
          subOrders: subDocs.map((s) => s._id),
          itemsTotal,
          deliveryFee,
          grandTotal,
          payment,
        });
      } catch (err) {
        if (err?.code === 11000 && err.keyPattern?.orderNumber) continue; // number clash: try again
        throw err;
      }
    }
    if (!order) throw new HttpError(500, "We couldn't create your order. Please try again.");
    orderCreated = true;

    const inserted = await SubOrder.insertMany(subDocs);
    const subs = inserted.map((d) => d.toObject());
    const orderObj = order.toObject();

    // 8. Clear the saved cart (best effort: the order already exists)
    await quiet(ShoppingCart.updateOne({ user: buyerId }, { $set: { lines: [] } }));

    // 9. Notifications (best effort)
    await notifyOrderPlaced({ order: orderObj, subOrders: subs, buyerId });

        await notifyLowStock(reserved);

    return res.status(201).json({ order: shapeOrder(orderObj, subs) });
  } catch (err) {
    await release();
    if (orderCreated) {
      await quiet(ShopOrder.deleteOne({ _id: orderId }));
      await quiet(SubOrder.deleteMany({ order: orderId }));
    }
    // Two requests with the same key at once: the loser returns the winner's order
    if (err?.code === 11000 && err.keyPattern?.idempotencyKey) {
      const won = await ShopOrder.findOne({ buyer: buyerId, idempotencyKey: input.key }).lean();
      if (won) return res.status(200).json({ order: await fullOrder(won) });
    }
    throw err;
  }
});

/* ---------- GET /api/orders/:id (owner only) ---------- */

exports.getOrder = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new HttpError(404, "Order not found");
  const order = await ShopOrder.findOne({ _id: req.params.id, buyer: req.user.id }).lean();
  if (!order) throw new HttpError(404, "Order not found"); // same answer for someone else's order
  return res.status(200).json({ order: await fullOrder(order) });
});

/* ---------- GET /api/orders (my orders, newest first) ---------- */

exports.listMine = asyncHandler(async (req, res) => {
  const orders = await ShopOrder.find({ buyer: req.user.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  if (orders.length === 0) return res.status(200).json({ orders: [] });

  const subs = await attachDisputes(
  await SubOrder.find({ order: { $in: orders.map((o) => o._id) } }).sort({ createdAt: 1 }).lean()
 );

  const byOrder = new Map();
  for (const s of subs) {
    const k = String(s.order);
    if (!byOrder.has(k)) byOrder.set(k, []);
    byOrder.get(k).push(s);
  }

  return res.status(200).json({
    orders: orders.map((o) => shapeOrder(o, byOrder.get(String(o._id)) || [])),
  });
});

/* ---------- PATCH /api/orders/:id/cancel  { subOrderId, reasonCode, note? } ----------
   placed    -> cancels right away
   confirmed -> sends a cancellation request to the seller (auto-approved after 24 h)
   later     -> refused                                                                  */
exports.cancelSubOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const subOrderId = req.body?.subOrderId;
  if (!mongoose.isValidObjectId(id) || typeof subOrderId !== "string" || !mongoose.isValidObjectId(subOrderId)) {
    throw new HttpError(400, "Invalid order");
  }
  // Old clients send only free text in `reason`; that counts as "Other".
  const { code, text: reason } = resolveReason(BUYER_REASONS, req.body?.reasonCode || "other", req.body?.note ?? req.body?.reason);

  const order = await ShopOrder.findOne({ _id: id, buyer: req.user.id }).lean();
  if (!order) throw new HttpError(404, "Order not found");

  const current = await SubOrder.findOne({ _id: subOrderId, order: order._id, buyer: req.user.id })
    .select("status cancelRequest")
    .lean();
  if (!current) throw new HttpError(404, "Order not found");

  if (current.status === "placed") {
    const sub = await cancelSubOrderNow({
      filter: { _id: subOrderId, order: order._id, buyer: req.user.id, status: "placed" },
      role: "buyer",
      actorId: req.user.id,
      reason,
    });
    if (!sub) throw new HttpError(409, "The seller just confirmed this order. You can send a cancellation request instead.");

    await notifyCancelled({ order, sub, buyerId: req.user.id });
    const fresh = await ShopOrder.findById(order._id).lean();
    return res.status(200).json({ order: await fullOrder(fresh), requested: false });
  }

  if (current.status === "confirmed") {
    if (current.cancelRequest?.status) {
      throw new HttpError(409, "You already sent a cancellation request for this order.");
    }
    const sub = await SubOrder.findOneAndUpdate(
      { _id: subOrderId, order: order._id, buyer: req.user.id, status: "confirmed", "cancelRequest.status": { $exists: false } },
      { $set: { cancelRequest: { status: "pending", reasonCode: code, reason, requestedAt: new Date() } } },
      { returnDocument: "after" }
    ).lean();
    if (!sub) throw new HttpError(409, "This order just changed. Refresh and try again.");

    await notifyCancelRequest({ order, sub });
    return res.status(200).json({ order: await fullOrder(order), requested: true });
  }

  throw new HttpError(409, "This order can no longer be cancelled because the seller has already packed or shipped it.");
});

/* ---------- "All good" and "Report a problem" ---------- */

const CONFIRM_WINDOW_DAYS = 7; // must match the frontend (utils/disputeLabels.js)
const REPORT_REASONS = ["wrong_item", "damaged", "not_received", "other"];
const PHOTO_REQUIRED = ["wrong_item", "damaged"]; // these need at least one photo as proof

function deliveredAt(sub) {
  if (sub.deliveredAt) return new Date(sub.deliveredAt);
  const entry = [...(sub.timeline || [])].reverse().find((t) => t.status === "delivered");
  return entry?.at ? new Date(entry.at) : null;
}

const inWindow = (sub) => {
  const at = deliveredAt(sub);
  return !!at && Date.now() - at.getTime() <= CONFIRM_WINDOW_DAYS * 24 * 60 * 60 * 1000;
};

// Loads the buyer's own delivered sub-order or throws a clear error
async function loadOwnSub(req) {
  const { id } = req.params;
  const subOrderId = req.body?.subOrderId;
  if (!mongoose.isValidObjectId(id) || typeof subOrderId !== "string" || !mongoose.isValidObjectId(subOrderId)) {
    throw new HttpError(400, "Invalid order");
  }
  const order = await ShopOrder.findOne({ _id: id, buyer: req.user.id }).lean();
  if (!order) throw new HttpError(404, "Order not found");
  const sub = await SubOrder.findOne({ _id: subOrderId, order: order._id, buyer: req.user.id }).lean();
  if (!sub) throw new HttpError(404, "Order not found");
  if (sub.status !== "delivered") {
    throw new HttpError(409, "You can do this after the seller marks the order as delivered.");
  }
  return { order, sub };
}

/* PATCH /api/orders/:id/confirm-received  { subOrderId } */
exports.confirmReceived = asyncHandler(async (req, res) => {
  const { sub } = await loadOwnSub(req);

  if (sub.receivedAt) return res.status(200).json({ ok: true, receivedAt: sub.receivedAt }); // already done
  if (!inWindow(sub)) {
    throw new HttpError(409, `The ${CONFIRM_WINDOW_DAYS}-day window to confirm this order has passed.`);
  }
  if (await Dispute.exists({ subOrder: sub._id, status: "open" })) {
    throw new HttpError(409, "You already reported a problem with this order.");
  }

  const now = new Date();
  await SubOrder.updateOne(
    { _id: sub._id, buyer: req.user.id, status: "delivered", receivedAt: null },
    { $set: { receivedAt: now } }
  );
  return res.status(200).json({ ok: true, receivedAt: now });
});

/* POST /api/orders/:id/report  (multipart: subOrderId, reason, message, images[0..3]) */
exports.reportProblem = asyncHandler(async (req, res) => {
  const reason = req.body?.reason;
  if (!REPORT_REASONS.includes(reason)) throw new HttpError(400, "Choose what went wrong");
  const message = text(req.body?.message, 10, 500, "Message");
  if (PHOTO_REQUIRED.includes(reason) && (req.files || []).length === 0) {
    throw new HttpError(400, "Please add at least one photo as proof.");
  }

  const { order, sub } = await loadOwnSub(req);

  if (sub.receivedAt) {
    throw new HttpError(409, "You already confirmed that you received this order.");
  }
  if (!inWindow(sub)) {
    throw new HttpError(409, `The ${CONFIRM_WINDOW_DAYS}-day window to report a problem has passed.`);
  }

  // Every check passed: only now are files written to disk.
  const images = await saveDisputePhotos(req);

  let dispute;
  try {
    dispute = await Dispute.create({
      subOrder: sub._id,
      order: order._id,
      orderNumber: order.orderNumber,
      buyer: req.user.id,
      seller: sub.seller,
      store: { _id: sub.store?._id, name: sub.store?.name },
      reason,
      message,
      images,
    });
  } catch (err) {
    await deleteDisputePhotos(images); // no orphan files if the dispute was not saved
    if (err?.code === 11000) throw new HttpError(409, "You already reported a problem with this order.");
    throw err;
  }

  await notifyDisputeOpened({ order, sellerId: sub.seller, subOrderId: sub._id });

  return res.status(201).json({ dispute: { _id: dispute._id, status: dispute.status, reason: dispute.reason } });
});