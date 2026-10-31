const mongoose = require("mongoose");
const User = require("../models/user");
const ShopOrder = require("../models/shopOrder");
const SubOrder = require("../models/subOrder");
const Dispute = require("../models/dispute");
const { notifyStatus } = require("../utils/orderStatusNotify");
const { notifyCancelRequestAnswered } = require("../utils/cancelNotify");
const { cancelSubOrder: cancelNow } = require("../services/cancelService");
const { SELLER_REASONS, resolveReason, shapeCancelRequest } = require("../utils/cancelReasons");
const { HttpError, asyncHandler } = require("../utils/validate");

// the status a sub-order must be in right now to move to the key
const PREVIOUS = { confirmed: "placed", packed: "confirmed", shipped: "packed", delivered: "shipped" };

function cleanNote(v, required) {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (!s && !required) return "";
  if (s.length < 3 || s.length > 300) {
    throw new HttpError(400, "Give a reason of 3 to 300 characters");
  }
  return s;
}

// Newest dispute for each sub-order, keyed by sub-order id
async function disputesFor(subIds) {
  if (!subIds.length) return new Map();
  const rows = await Dispute.find({ subOrder: { $in: subIds } })
    .sort({ createdAt: -1 })
    .select("subOrder status reason message images sellerReply")
    .lean();
  const newest = new Map();
  for (const r of rows) if (!newest.has(String(r.subOrder))) newest.set(String(r.subOrder), r);
  return newest;
}

const shapeDispute = (d) =>
  d
    ? {
        _id: d._id,
        status: d.status,
        reason: d.reason,
        message: d.message,
        images: d.images || [],
        sellerReply: d.sellerReply?.message
          ? { message: d.sellerReply.message, repliedAt: d.sellerReply.repliedAt }
          : null,
      }
    : null;

const row = (s, order, buyer, dispute) => ({
  _id: s._id, // the SUB-ORDER id
  orderNumber: order?.orderNumber || "",
  createdAt: s.createdAt,
  buyer: { name: buyer?.name || order?.address?.fullName || "Buyer" },
  phone: order?.phone || "",
  address: {
    fullName: order?.address?.fullName || "",
    line1: order?.address?.line1 || "",
    city: order?.address?.city || "",
    region: order?.address?.region || "",
    notes: order?.address?.notes || "",
  },
  items: (s.items || []).map((i) => ({
    title: i.title, image: i.image, color: i.color, size: i.size,
    unitPrice: i.unitPrice, quantity: i.quantity, lineTotal: i.lineTotal,
  })),
  subtotal: s.subtotal,
  status: s.status,
  timeline: (s.timeline || []).map((t) => ({ status: t.status, at: t.at, note: t.note })),
  cancelRequest: shapeCancelRequest(s.cancelRequest),
  dispute: shapeDispute(dispute),
});

const ownerFilterFor = (req) => (req.user.role === "admin" ? {} : { seller: req.user.id });

async function respond(sub) {
  const [order, buyer, disputes] = await Promise.all([
    ShopOrder.findById(sub.order).lean(),
    User.findById(sub.buyer).select("name").lean(),
    disputesFor([sub._id]),
  ]);
  return { order, buyer, dispute: disputes.get(String(sub._id)) };
}

/* ---------- GET /api/seller/orders ---------- */
exports.listSellerOrders = asyncHandler(async (req, res) => {
  const subs = await SubOrder.find({ seller: req.user.id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  if (subs.length === 0) return res.status(200).json({ orders: [] });

  const [orders, buyers, disputes] = await Promise.all([
    ShopOrder.find({ _id: { $in: [...new Set(subs.map((s) => String(s.order)))] } }).lean(),
    User.find({ _id: { $in: [...new Set(subs.map((s) => String(s.buyer)))] } }).select("name").lean(),
    disputesFor(subs.map((s) => s._id)),
  ]);
  const orderBy = new Map(orders.map((o) => [String(o._id), o]));
  const buyerBy = new Map(buyers.map((u) => [String(u._id), u]));

  return res.status(200).json({
    orders: subs.map((s) =>
      row(s, orderBy.get(String(s.order)), buyerBy.get(String(s.buyer)), disputes.get(String(s._id)))
    ),
  });
});

/* ---------- PATCH /api/seller/orders/:id/status  { status, reasonCode?, note? } ---------- */
exports.updateStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "Order not found");

  const status = req.body?.status;
  const isCancel = status === "cancelled";
  if (!isCancel && !Object.prototype.hasOwnProperty.call(PREVIOUS, status)) {
    throw new HttpError(400, "Invalid status");
  }

  // Sellers can only touch their own sub-orders. Admins may act on any.
  const ownerFilter = ownerFilterFor(req);
  const current = await SubOrder.findOne({ _id: id, ...ownerFilter }).select("status cancelRequest").lean();
  if (!current) throw new HttpError(404, "Order not found");

  let sub;
  let note = "";

  if (isCancel) {
    const declineMsg = "This order can no longer be cancelled because it is already packed, shipped or finished.";
    if (!["placed", "confirmed"].includes(current.status)) throw new HttpError(409, declineMsg);

    // New clients send reasonCode (+ note). Old clients send only a note, which counts as "Other".
    const resolved = resolveReason(SELLER_REASONS, req.body?.reasonCode || "other", req.body?.note);
    note = resolved.text;
    const isAdmin = req.user.role === "admin";

    sub = await cancelNow({
      // the status we just read is part of the filter, so only one request can win
      filter: { _id: id, ...ownerFilter, status: current.status },
      role: isAdmin ? "admin" : "seller",
      actorId: req.user.id,
      reason: note,
      // declining a new order is free; backing out after confirming counts against the seller
      sellerFault: !isAdmin && current.status === "confirmed",
    });
    if (!sub) throw new HttpError(409, declineMsg);
  } else {
    note = cleanNote(req.body?.note, false);

    if (current.cancelRequest?.status === "pending") {
      throw new HttpError(409, "The buyer asked to cancel this order. Approve or refuse the request first.");
    }

    const set = { status };
    if (status === "delivered") set.deliveredAt = new Date();

    // Atomic: the current status is part of the filter, so steps can't be skipped or repeated.
    sub = await SubOrder.findOneAndUpdate(
      { _id: id, ...ownerFilter, status: PREVIOUS[status], "cancelRequest.status": { $ne: "pending" } },
      { $set: set, $push: { timeline: { status, at: new Date(), note, by: req.user.id } } },
      { returnDocument: "after" }
    ).lean();

    if (!sub) {
      const now = await SubOrder.findOne({ _id: id, ...ownerFilter }).select("status").lean();
      if (!now) throw new HttpError(404, "Order not found");
      throw new HttpError(409, `This order is already ${now.status}. Refresh to see the latest.`);
    }
  }

  const { order, buyer, dispute } = await respond(sub);
  await notifyStatus({ order, sub, status, note });

  return res.status(200).json({ order: row(sub, order, buyer, dispute) });
});

/* ---------- PATCH /api/seller/orders/:id/cancel-request  { action, note? } ---------- */
exports.respondCancelRequest = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "Order not found");

  const action = req.body?.action;
  if (action !== "approve" && action !== "refuse") throw new HttpError(400, "Choose approve or refuse");

  const ownerFilter = ownerFilterFor(req);
  const current = await SubOrder.findOne({ _id: id, ...ownerFilter }).select("buyer cancelRequest").lean();
  if (!current) throw new HttpError(404, "Order not found");

  const pendingFilter = { _id: id, ...ownerFilter, status: "confirmed", "cancelRequest.status": "pending" };
  const now = new Date();
  let sub;
  let note = "";

  if (action === "approve") {
    sub = await cancelNow({
      filter: pendingFilter,
      role: "buyer", // it was the buyer's decision; not the seller's fault
      actorId: current.buyer,
      reason: current.cancelRequest?.reason || "Cancelled at the buyer's request",
      sellerFault: false,
      extraSet: { "cancelRequest.status": "approved", "cancelRequest.respondedAt": now },
    });
  } else {
    note = cleanNote(req.body?.note, true); // the buyer deserves to know why
    sub = await SubOrder.findOneAndUpdate(
      pendingFilter,
      { $set: { "cancelRequest.status": "refused", "cancelRequest.respondedAt": now, "cancelRequest.respondNote": note } },
      { returnDocument: "after" }
    ).lean();
  }

  if (!sub) {
    throw new HttpError(409, "This request was already answered, or the order has moved on. Refresh to see the latest.");
  }

  const { order, buyer, dispute } = await respond(sub);
  await notifyCancelRequestAnswered({ order, sub, outcome: action === "approve" ? "approved" : "refused", note });

  return res.status(200).json({ order: row(sub, order, buyer, dispute) });
});