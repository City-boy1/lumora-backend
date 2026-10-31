const mongoose = require("mongoose");
const Store = require("../models/store");
const SubOrder = require("../models/subOrder");
const ShopOrder = require("../models/shopOrder");
const Notification = require("../models/notification");
const { logAudit } = require("../utils/audit");
const { HttpError, asyncHandler, requireObjectId, requireText, actorId } = require("../utils/validate");

const User = () => mongoose.model("User");
const Product = () => mongoose.model("Product");

const OPEN_STATUSES = ["placed", "confirmed", "packed", "shipped"];

// GET /api/admin/sellers/:storeId/orders?status=open
exports.listSellerOpenOrders = asyncHandler(async (req, res) => {
  const storeId = requireObjectId(req.params.storeId, "store id");
  if (req.query.status !== undefined && req.query.status !== "open") {
    throw new HttpError(400, "Invalid status");
  }

  const store = await Store.findById(storeId).select("owner").lean();
  if (!store) throw new HttpError(404, "Store not found");

  const subs = await SubOrder.find({ seller: store.owner, status: { $in: OPEN_STATUSES } })
    .sort({ createdAt: 1 })
    .limit(100)
    .select("order buyer status subtotal createdAt")
    .lean();

  const orderIds = [...new Set(subs.map((s) => String(s.order)))];
  const buyerIds = [...new Set(subs.map((s) => String(s.buyer)))];
  const [orders, buyers] = await Promise.all([
    ShopOrder.find({ _id: { $in: orderIds } }).select("orderNumber").lean(),
    User().find({ _id: { $in: buyerIds } }).select("name").lean(),
  ]);
  const numberById = new Map(orders.map((o) => [String(o._id), o.orderNumber]));
  const nameById = new Map(buyers.map((u) => [String(u._id), u.name]));

  res.json({
    orders: subs.map((s) => ({
      _id: s._id,
      orderNumber: numberById.get(String(s.order)) || "",
      status: s.status,
      createdAt: s.createdAt,
      subtotal: s.subtotal,
      buyer: { name: nameById.get(String(s.buyer)) || "Buyer" },
    })),
  });
});

// PATCH /api/admin/sub-orders/:id/cancel   body { reason }
exports.adminCancelSubOrder = asyncHandler(async (req, res) => {
  const id = requireObjectId(req.params.id, "order id");
  const reason = requireText(req.body?.reason, { min: 3, max: 300, label: "Reason" });

  // Atomic: only a sub-order that is not delivered or cancelled can be cancelled,
  // and only once. This is also what guarantees stock is restored exactly once.
  const sub = await SubOrder.findOneAndUpdate(
    { _id: id, status: { $in: OPEN_STATUSES } },
    {
            $set: { status: "cancelled", cancelReason: reason, cancelledByRole: "admin", cancelledBy: actorId(req) },
      $push: { timeline: { status: "cancelled", at: new Date(), note: reason, by: actorId(req) } },
    },
    { returnDocument: "after" }
  ).lean();

  if (!sub) {
    const exists = await SubOrder.exists({ _id: id });
    throw new HttpError(exists ? 409 : 404, exists ? "This order can no longer be cancelled" : "Order not found");
  }

  // Restore stock for every item (variant-level, using the variant id saved on the item).
  for (const item of sub.items || []) {
    if (!item.product || !item.variant) continue;
    await Product().updateOne(
      { _id: item.product, "variants._id": item.variant },
      { $inc: { "variants.$.stock": item.quantity } }
    );
  }

  // Simulated refund: flag the whole order only when every sub-order is cancelled.
  const stillActive = await SubOrder.countDocuments({ order: sub.order, status: { $ne: "cancelled" } });
  if (stillActive === 0) {
    await ShopOrder.updateOne({ _id: sub.order }, { $set: { "payment.status": "refunded" } });
  }

  // Notify both sides. Account-critical, so no user switches. Never blocks the result.
  try {
    const order = await ShopOrder.findById(sub.order).select("orderNumber").lean();
    const num = order?.orderNumber || "";

    await logAudit(req, { action: "order_cancelled_by_admin", targetType: "subOrder", targetId: sub._id, targetLabel: `Order ${num}`, reason });
    await Notification.insertMany([
      {
        recipient: sub.buyer,
        type: "order_update",
        title: "An order was cancelled",
        message: `Your order ${num} from ${sub.store?.name || "the seller"} was cancelled by our team. Reason: ${reason}`,
        link: `/dashboard/orders?order=${sub.order}`,
        isRead: false,
        relatedOrder: sub.order,
      },
      {
        recipient: sub.seller,
        type: "order_update",
        title: "An order was cancelled",
        message: `Order ${num} was cancelled by our team. Reason: ${reason}`,
        link: `/dashboard/sales?sub=${sub._id}`,
        isRead: false,
        relatedOrder: sub.order,
      },
    ]);
  } catch (err) {
    console.error("admin cancel notification failed:", err.message);
  }

  res.json({ subOrder: { _id: sub._id, status: sub.status, cancelReason: sub.cancelReason } });
});