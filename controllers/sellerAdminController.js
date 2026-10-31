const mongoose = require("mongoose");
const Store = require("../models/store");
const Notification = require("../models/notification");
const SubOrder = require("../models/subOrder");
const Dispute = require("../models/dispute");
const { logAudit } = require("../utils/audit");
const { HttpError, asyncHandler, requireObjectId, requireText, optionalQueryText, oneOf, parsePage, escapeRegex, actorId } = require("../utils/validate");

const PAGE_SIZE = 20; // fixed on purpose: the client can never ask for more

const OPEN_STATUSES = ["placed", "confirmed", "packed", "shipped"];
const OVERDUE_HOURS = 48;

// Registered model names are used so this file does not depend on your file names.
const User = () => mongoose.model("User");
const Product = () => mongoose.model("Product");

/* ------------------------------------------------------------------ list */

// GET /api/admin/sellers?status&search&page
exports.listSellers = asyncHandler(async (req, res) => {
  const status = oneOf(req.query.status, ["active", "suspended"], "status");
  const search = optionalQueryText(req.query.search, { max: 60, label: "search" });
  const page = parsePage(req.query.page);

  const match = status ? { status } : {};
  const rx = search ? new RegExp(escapeRegex(search), "i") : null;

  const [result] = await Store.aggregate([
    { $match: match },
    { $lookup: { from: User().collection.name, localField: "owner", foreignField: "_id", as: "ownerDoc" } },
    { $unwind: "$ownerDoc" },
    ...(rx ? [{ $match: { $or: [{ name: rx }, { "ownerDoc.name": rx }, { "ownerDoc.email": rx }] } }] : []),
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $facet: {
        rows: [
          { $skip: (page - 1) * PAGE_SIZE },
          { $limit: PAGE_SIZE },
          // Whitelist: password hashes, tokens and everything else on the user never leave the database.
          {
            $project: {
              name: 1,
              logo: 1,
              status: 1,
              owner: 1,
              "ownerDoc.name": 1,
              "ownerDoc.email": 1,
              "ownerDoc.sellerSince": 1,
            },
          },
        ],
        total: [{ $count: "n" }],
      },
    },
  ]);

  const rows = result.rows;
  const total = result.total[0]?.n || 0;

  // Product stats for just this page's owners, in one query.
  const ownerIds = rows.map((r) => r.owner);
  const stats = ownerIds.length
    ? await Product().aggregate([
        { $match: { createdBy: { $in: ownerIds }, reviewStatus: "approved" } },
        {
          $group: {
            _id: "$createdBy",
            approvedProducts: { $sum: 1 },
            weighted: { $sum: { $multiply: [{ $ifNull: ["$ratingAverage", 0] }, { $ifNull: ["$ratingCount", 0] }] } },
            ratingCount: { $sum: { $ifNull: ["$ratingCount", 0] } },
          },
        },
      ])
    : [];
  const byOwner = new Map(stats.map((s) => [String(s._id), s]));

  // Order and dispute metrics for just this page's sellers.
  const now = Date.now();
  const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const overdueCutoff = new Date(now - OVERDUE_HOURS * 60 * 60 * 1000);

  const [orderStats, disputeStats] = ownerIds.length
    ? await Promise.all([
        SubOrder.aggregate([
          { $match: { seller: { $in: ownerIds } } },
          {
            $group: {
              _id: "$seller",
              orders30d: { $sum: { $cond: [{ $gte: ["$createdAt", since30] }, 1, 0] } },
              cancelled30d: {
                $sum: {
                  $cond: [
                    { $and: [{ $gte: ["$createdAt", since30] }, { $eq: ["$status", "cancelled"] }, { $eq: ["$sellerFault", true] }] },
                    1,
                    0,
                  ],
                },
              },
              openOrders: { $sum: { $cond: [{ $in: ["$status", OPEN_STATUSES] }, 1, 0] } },
              overdueOrders: {
                $sum: {
                  $cond: [{ $and: [{ $eq: ["$status", "placed"] }, { $lt: ["$createdAt", overdueCutoff] }] }, 1, 0],
                },
              },
            },
          },
        ]),
        Dispute.aggregate([
          { $match: { seller: { $in: ownerIds }, status: "open" } },
          { $group: { _id: "$seller", n: { $sum: 1 } } },
        ]),
      ])
    : [[], []];
  const ordersByOwner = new Map(orderStats.map((o) => [String(o._id), o]));
  const disputesByOwner = new Map(disputeStats.map((d) => [String(d._id), d.n]));

  const sellers = rows.map((r) => {
    const s = byOwner.get(String(r.owner));
    const o = ordersByOwner.get(String(r.owner));
    const ratingCount = s?.ratingCount || 0;
    return {
      _id: r._id,
      store: { _id: r._id, name: r.name, logo: r.logo || "", status: r.status },
      owner: { name: r.ownerDoc?.name || "", email: r.ownerDoc?.email || "" },
      sellerSince: r.ownerDoc?.sellerSince || null,
      approvedProducts: s?.approvedProducts || 0,
      ratingAverage: ratingCount ? Math.round((s.weighted / ratingCount) * 10) / 10 : 0,
      ratingCount,
      orders30d: o?.orders30d || 0,
      openOrders: o?.openOrders || 0,
      cancelRate: o?.orders30d ? Math.round((o.cancelled30d / o.orders30d) * 100) / 100 : 0,
      overdueOrders: o?.overdueOrders || 0,
      openDisputes: disputesByOwner.get(String(r.owner)) || 0,
    };
  });

  res.json({ sellers, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

/* --------------------------------------------------------------- suspend */

// PATCH /api/admin/sellers/:storeId/suspend   body { reason }
exports.suspendSeller = asyncHandler(async (req, res) => {
  const storeId = requireObjectId(req.params.storeId, "store id");
  const reason = requireText(req.body?.reason, { min: 3, max: 300, label: "Reason" });

  // One atomic step: only an ACTIVE store can be suspended, so two admins
  // clicking at once, or a double click, can never suspend twice or notify twice.
  const store = await Store.findOneAndUpdate(
    { _id: storeId, status: "active" },
    { $set: { status: "suspended", suspendedAt: new Date(), suspendedBy: actorId(req), suspensionReason: reason } },
    { returnDocument: "after" }
  );

  if (!store) {
    const exists = await Store.exists({ _id: storeId });
    throw new HttpError(exists ? 409 : 404, exists ? "This store is already suspended" : "Store not found");
  }

    await logAudit(req, { action: "seller_suspended", targetType: "store", targetId: store._id, targetLabel: store.name, reason });

  // Suspension notices are account-critical: always delivered, never filtered by canNotify.
  try {
    await Notification.create({
      recipient: store.owner,
      type: "store_suspended",
      title: "Your store was suspended",
      message: `Your store "${store.name}" was suspended. Reason: ${reason}`,
      link: "/dashboard",
    });
  } catch (e) {
    console.error("Suspend notification failed:", e.message); // the suspension itself already succeeded
  }

  res.json({ store: { _id: store._id, name: store.name, status: store.status } });
});

/* ------------------------------------------------------------- reinstate */

// PATCH /api/admin/sellers/:storeId/reinstate
exports.reinstateSeller = asyncHandler(async (req, res) => {
  const storeId = requireObjectId(req.params.storeId, "store id");

  const store = await Store.findOneAndUpdate(
    { _id: storeId, status: "suspended" },
    { $set: { status: "active" }, $unset: { suspendedAt: "", suspendedBy: "", suspensionReason: "" } },
    { returnDocument: "after" }
  );

  if (!store) {
    const exists = await Store.exists({ _id: storeId });
    throw new HttpError(exists ? 409 : 404, exists ? "This store is not suspended" : "Store not found");
  }

    await logAudit(req, { action: "seller_reinstated", targetType: "store", targetId: store._id, targetLabel: store.name });

  try {
    await Notification.create({
      recipient: store.owner,
      type: "store_reinstated",
      title: "Your store was reinstated",
      message: `Your store "${store.name}" is active again and visible to buyers.`,
      link: "/dashboard/store",
    });
  } catch (e) {
    console.error("Reinstate notification failed:", e.message);
  }

  res.json({ store: { _id: store._id, name: store.name, status: store.status } });
});