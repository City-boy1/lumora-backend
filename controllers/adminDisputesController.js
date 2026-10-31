const mongoose = require("mongoose");
const Dispute = require("../models/dispute");
const ShopOrder = require("../models/shopOrder");
const User = require("../models/user");
const Notification = require("../models/notification");
const { logAudit } = require("../utils/audit");
const { HttpError, asyncHandler } = require("../utils/validate");

const STATUSES = ["open", "resolved_refund", "resolved_no_action", "closed"];
const RESOLUTIONS = ["resolved_refund", "resolved_no_action", "closed"];
const PAGE_SIZE = 20;

const OUTCOME_TEXT = {
  resolved_refund: "was resolved with a refund",
  resolved_no_action: "was reviewed and no action was taken",
  closed: "was closed",
};

// GET /api/admin/disputes?status&page
exports.listDisputes = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status !== undefined && req.query.status !== "") {
    if (typeof req.query.status !== "string" || !STATUSES.includes(req.query.status)) {
      throw new HttpError(400, "Invalid status");
    }
    filter.status = req.query.status;
  }

  const rawPage = parseInt(req.query.page, 10);
  const page = Math.min(Math.max(Number.isFinite(rawPage) ? rawPage : 1, 1), 1000);

  const [rows, total] = await Promise.all([
    Dispute.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Dispute.countDocuments(filter),
  ]);

  const userIds = [...new Set(rows.flatMap((d) => [d.buyer, d.seller]).filter(Boolean).map(String))];
  const users = await User.find({ _id: { $in: userIds } }).select("name email").lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const disputes = rows.map((d) => {
    const buyer = byId.get(String(d.buyer));
    const seller = byId.get(String(d.seller));
    return {
      _id: d._id,
      orderNumber: d.orderNumber,
      order: d.order,
      subOrder: d.subOrder,
      reason: d.reason,
      message: d.message,
      images: d.images || [],
      status: d.status,
      adminNote: d.adminNote || "",
      sellerReply: d.sellerReply && d.sellerReply.message
        ? { message: d.sellerReply.message, repliedAt: d.sellerReply.repliedAt }
        : null,
      buyer: { name: buyer?.name || "Unknown", email: buyer?.email || "" },
      seller: { name: seller?.name || "Unknown", email: seller?.email || "" },
      store: { _id: d.store?._id, name: d.store?.name || "Unknown store" },
      resolvedAt: d.resolvedAt || null,
      createdAt: d.createdAt,
    };
  });

  res.json({ disputes, total, pages: Math.max(Math.ceil(total / PAGE_SIZE), 1) });
});

// PATCH /api/admin/disputes/:id  { status, adminNote }
exports.resolveDispute = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw new HttpError(400, "Invalid dispute id");

  const status = req.body && req.body.status;
  const note = req.body && req.body.adminNote;
  if (typeof status !== "string" || !RESOLUTIONS.includes(status)) {
    throw new HttpError(400, "Choose an outcome");
  }
  if (typeof note !== "string" || note.trim().length < 3 || note.trim().length > 500) {
    throw new HttpError(400, "Add a note of 3 to 500 characters");
  }

  // Atomic: only an OPEN dispute can be resolved, and only once.
  const dispute = await Dispute.findOneAndUpdate(
    { _id: id, status: "open" },
    {
      $set: {
        status,
        adminNote: note.trim(),
        resolvedBy: req.user.id,
        resolvedAt: new Date(),
      },
    },
    { returnDocument: "after" }
  ).lean();

  if (!dispute) {
    const exists = await Dispute.exists({ _id: id });
    if (!exists) throw new HttpError(404, "Dispute not found");
    throw new HttpError(409, "This dispute has already been resolved");
  }

    await logAudit(req, {
    action: "dispute_resolved",
    targetType: "dispute",
    targetId: dispute._id,
    targetLabel: `Order ${dispute.orderNumber}`,
    reason: dispute.adminNote,
    meta: { outcome: status },
  });

  // Simulated refund (real refunds come with Paystack).
  if (status === "resolved_refund") {
    await ShopOrder.updateOne({ _id: dispute.order }, { $set: { "payment.status": "refunded" } });
  }

  // Notify both sides. Account-critical, so no user switches. Never blocks the result.
  try {
    const text = OUTCOME_TEXT[status];
    await Notification.insertMany([
      {
        recipient: dispute.buyer,
        type: "general",
        title: "Your reported problem was reviewed",
        message: `Your report on order ${dispute.orderNumber} ${text}. Note from our team: ${dispute.adminNote}`,
        link: `/dashboard/orders?order=${dispute.order}`,
        isRead: false,
        relatedOrder: dispute.order,
      },
      {
        recipient: dispute.seller,
        type: "general",
        title: "A dispute on your order was reviewed",
        message: `The dispute on order ${dispute.orderNumber} ${text}. Note from our team: ${dispute.adminNote}`,
        link: `/dashboard/sales?sub=${dispute.subOrder}`,
        isRead: false,
        relatedOrder: dispute.order,
      },
    ]);
  } catch (err) {
    console.error("dispute notification failed:", err.message);
  }

  res.json({ dispute: { _id: dispute._id, status: dispute.status, adminNote: dispute.adminNote, resolvedAt: dispute.resolvedAt } });
});