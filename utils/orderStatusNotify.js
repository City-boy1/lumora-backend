const Notification = require("../models/notification");
const UserSettings = require("../models/settings");

async function allowed(userId, key) {
  try {
    const s = await UserSettings.findOne({ user: userId }).select("notifications").lean();
    return s?.notifications?.[key] !== false;
  } catch {
    return true;
  }
}

const WORDS = {
  confirmed: "was confirmed",
  packed: "was packed",
  shipped: "is on its way",
  delivered: "was delivered",
};

// Tell the buyer their part of an order moved on, or was declined.
async function notifyStatus({ order, sub, status, note }) {
  try {
    if (!(await allowed(sub.buyer, "orderUpdates"))) return;
    const store = sub.store?.name || "the seller";
    const declined = status === "cancelled";
    await Notification.create({
      recipient: sub.buyer,
      type: "order_update",
      title: declined ? "Order declined" : "Order update",
      message: declined
        ? `${store} declined your order ${order.orderNumber}. Reason: ${note}`
        : `Your order ${order.orderNumber} from ${store} ${WORDS[status] || "was updated"}.`,
      link: `/dashboard/orders?order=${order._id}`,
      relatedOrder: order._id,
    });
  } catch (err) {
    console.error("notifyStatus:", err); // never undo a status change for a notification
  }
}

module.exports = { notifyStatus };