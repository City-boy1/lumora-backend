const mongoose = require("mongoose");
const Product = require("../models/product");
const User = require("../models/user");
const ShopOrder = require("../models/shopOrder");
const SubOrder = require("../models/subOrder");
const { asyncHandler } = require("../utils/validate");

const LOW_STOCK_LIMIT = 5;
const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ACTIVE = ["placed", "confirmed", "packed", "shipped"];
const STATUS_ORDER = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled"];

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ---------- date helpers (everything is UTC; Ghana is UTC+0) ---------- */

function todayUTC() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ["2026-10-16", ..., "2026-10-29"], oldest first, always n entries
function lastDays(n) {
  const today = todayUTC().getTime();
  return Array.from({ length: n }, (_, i) =>
    new Date(today - (n - 1 - i) * DAY).toISOString().slice(0, 10)
  );
}

// [{ y, m }] oldest first, m is 1-12
function lastMonths(n) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
  });
}

// Turn aggregate rows into a full series, with zeros for days that had nothing
function fillDays(days, rows, valueKey, outKey) {
  const byDay = new Map(rows.map((r) => [r._id, r[valueKey]]));
  return days.map((date) => ({ date, [outKey]: round(byDay.get(date) || 0) }));
}

const dayGroup = { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } };

function deriveStatus(subs) {
  const live = subs.filter((s) => s.status !== "cancelled");
  if (live.length === 0) return "cancelled";
  const delivered = live.filter((s) => s.status === "delivered").length;
  if (delivered === live.length) return "completed";
  if (delivered > 0) return "partially_delivered";
  return "in_progress";
}

/* ---------- buyer ---------- */

async function buyerSummary(userId) {
  const buyer = oid(userId);
  const months = lastMonths(6);
  const since = new Date(Date.UTC(months[0].y, months[0].m - 1, 1));

  const [activeCount, deliveredCount, recent, active, spend] = await Promise.all([
    SubOrder.countDocuments({ buyer, status: { $in: ACTIVE } }),
    SubOrder.countDocuments({ buyer, status: "delivered" }),
    ShopOrder.find({ buyer }).sort({ createdAt: -1 }).limit(5).select("orderNumber createdAt grandTotal").lean(),
    SubOrder.find({ buyer, status: { $in: ACTIVE } }).sort({ createdAt: -1 }).limit(5).select("order store status").lean(),
    SubOrder.aggregate([
      { $match: { buyer, status: { $ne: "cancelled" }, createdAt: { $gte: since } } },
      { $group: { _id: { y: { $year: "$createdAt" }, m: { $month: "$createdAt" } }, total: { $sum: "$subtotal" } } },
    ]),
  ]);

  const [recentSubs, activeOrders] = await Promise.all([
    SubOrder.find({ order: { $in: recent.map((o) => o._id) } }).select("order status").lean(),
    ShopOrder.find({ _id: { $in: active.map((s) => s.order) } }).select("orderNumber").lean(),
  ]);

  const subsByOrder = new Map();
  for (const s of recentSubs) {
    const k = String(s.order);
    if (!subsByOrder.has(k)) subsByOrder.set(k, []);
    subsByOrder.get(k).push(s);
  }
  const numberBy = new Map(activeOrders.map((o) => [String(o._id), o.orderNumber]));
  const spendBy = new Map(spend.map((r) => [`${r._id.y}-${r._id.m}`, r.total]));

  return {
    stats: { activeOrders: activeCount, delivered: deliveredCount },
    recentOrders: recent.map((o) => ({
      _id: o._id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      grandTotal: o.grandTotal,
      status: deriveStatus(subsByOrder.get(String(o._id)) || []),
    })),
    activeDeliveries: active.map((s) => ({
      orderNumber: numberBy.get(String(s.order)) || "",
      store: s.store?.name || "Seller",
      status: s.status,
    })),
    spendingByMonth: months.map(({ y, m }) => ({
      month: MONTHS[m - 1],
      total: round(spendBy.get(`${y}-${m}`) || 0),
    })),
  };
}

/* ---------- seller ---------- */

async function sellerSummary(userId) {
  const seller = oid(userId);
  const days = lastDays(14);
  const since14 = new Date(`${days[0]}T00:00:00.000Z`);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const since30 = new Date(Date.now() - 30 * DAY);
  const notCancelled = { $ne: "cancelled" };

  const [
    newOrders, toShip, pendingReview, rejected,
    lowStockAgg, revenueAgg, recentSubs, salesAgg, statusAgg, topAgg,
  ] = await Promise.all([
    SubOrder.countDocuments({ seller, status: "placed" }),
    SubOrder.countDocuments({ seller, status: { $in: ["confirmed", "packed"] } }),
    Product.countDocuments({ createdBy: seller, reviewStatus: "pending" }),
    Product.countDocuments({ createdBy: seller, reviewStatus: "rejected" }),
    Product.aggregate([
      { $match: { createdBy: seller, reviewStatus: "approved" } },
      { $unwind: "$variants" },
      { $match: { "variants.stock": { $lte: LOW_STOCK_LIMIT } } },
      {
        $facet: {
          count: [{ $count: "n" }],
          list: [
            { $sort: { "variants.stock": 1, title: 1 } },
            { $limit: 8 },
            {
              $project: {
                _id: "$variants._id",
                productId: "$_id",
                title: 1,
                color: "$variants.color",
                size: "$variants.size",
                stock: "$variants.stock",
              },
            },
          ],
        },
      },
    ]),
    SubOrder.aggregate([
      { $match: { seller, status: notCancelled, createdAt: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: "$subtotal" } } },
    ]),
    SubOrder.find({ seller }).sort({ createdAt: -1 }).limit(5).select("order buyer subtotal status").lean(),
    SubOrder.aggregate([
      { $match: { seller, status: notCancelled, createdAt: { $gte: since14 } } },
      { $group: { _id: dayGroup, revenue: { $sum: "$subtotal" } } },
    ]),
    SubOrder.aggregate([
      { $match: { seller } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    SubOrder.aggregate([
      { $match: { seller, status: notCancelled, createdAt: { $gte: since30 } } },
      { $unwind: "$items" },
      { $group: { _id: "$items.product", title: { $first: "$items.title" }, units: { $sum: "$items.quantity" } } },
      { $sort: { units: -1, title: 1 } },
      { $limit: 5 },
    ]),
  ]);

  const [orders, buyers] = await Promise.all([
    ShopOrder.find({ _id: { $in: recentSubs.map((s) => s.order) } }).select("orderNumber address.fullName").lean(),
    User.find({ _id: { $in: recentSubs.map((s) => s.buyer) } }).select("name").lean(),
  ]);
  const orderBy = new Map(orders.map((o) => [String(o._id), o]));
  const buyerBy = new Map(buyers.map((u) => [String(u._id), u.name]));
  const statusBy = new Map(statusAgg.map((r) => [r._id, r.count]));

  const low = lowStockAgg[0] || { count: [], list: [] };

  return {
    stats: {
      newOrders,
      toShip,
      lowStock: low.count[0]?.n || 0,
      pendingReview,
      rejected,
      revenueMonth: round(revenueAgg[0]?.total),
    },
    lowStock: low.list,
    recentSales: recentSubs.map((s) => ({
      _id: s._id,
      orderNumber: orderBy.get(String(s.order))?.orderNumber || "",
      buyerName: buyerBy.get(String(s.buyer)) || orderBy.get(String(s.order))?.address?.fullName || "Buyer",
      subtotal: s.subtotal,
      status: s.status,
    })),
    salesByDay: fillDays(days, salesAgg, "revenue", "revenue"),
    ordersByStatus: STATUS_ORDER.map((status) => ({ status, count: statusBy.get(status) || 0 })),
    topProducts: topAgg.map((r) => ({ title: r.title, units: r.units })),
  };
}

/* ---------- admin ---------- */

async function adminSummary() {
  const days = lastDays(14);
  const since14 = new Date(`${days[0]}T00:00:00.000Z`);
  const since7 = new Date(Date.now() - 7 * DAY);

  const [pendingProducts, totalProducts, newUsers7d, totalOrders, pending, ordersAgg, statusAgg] =
    await Promise.all([
      Product.countDocuments({ reviewStatus: "pending" }),
      Product.countDocuments({}),
      User.countDocuments({ createdAt: { $gte: since7 } }),
      ShopOrder.countDocuments({}),
      Product.find({ reviewStatus: "pending" }).sort({ createdAt: 1 }).limit(5).select("title createdBy createdAt").lean(),
      ShopOrder.aggregate([
        { $match: { createdAt: { $gte: since14 } } },
        { $group: { _id: dayGroup, orders: { $sum: 1 } } },
      ]),
      Product.aggregate([{ $group: { _id: "$reviewStatus", count: { $sum: 1 } } }]),
    ]);

  const sellers = await User.find({ _id: { $in: pending.map((p) => p.createdBy) } }).select("name").lean();
  const nameBy = new Map(sellers.map((u) => [String(u._id), u.name]));
  const statusBy = new Map(statusAgg.map((r) => [r._id, r.count]));

  return {
    stats: { pendingProducts, totalProducts, newUsers7d, totalOrders },
    pending: pending.map((p) => ({
      _id: p._id,
      title: p.title,
      seller: nameBy.get(String(p.createdBy)) || "Seller",
      createdAt: p.createdAt,
    })),
    ordersByDay: days.map((date) => ({
      date,
      orders: ordersAgg.find((r) => r._id === date)?.orders || 0,
    })),
    productsByStatus: ["pending", "approved", "rejected"].map((status) => ({
      status,
      count: statusBy.get(status) || 0,
    })),
  };
}

/* ---------- GET /api/dashboard/summary ---------- */

exports.getSummary = asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { role, id } = req.user; // role is the database value (allowedRoles)

  if (role === "admin") return res.status(200).json(await adminSummary());
  if (role === "seller") return res.status(200).json(await sellerSummary(id));
  return res.status(200).json(await buyerSummary(id));
});