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

async function notifyOrderPlaced({ order, subOrders, buyerId }) {
  try {
    const docs = [];

    if (await allowed(buyerId, "orderUpdates")) {
      docs.push({
        recipient: buyerId,
        type: "order_update",
        title: "Order placed",
        message: `Your order ${order.orderNumber} was placed.`,
        link: `/orders/${order._id}/confirmation`,
        relatedOrder: order._id,
      });
    }

    for (const s of subOrders) {
      if (await allowed(s.seller, "orderNotifications")) {
        const count = s.items.reduce((n, i) => n + i.quantity, 0);
        docs.push({
          recipient: s.seller,
          type: "new_order",
          title: "New order",
          message: `New order ${order.orderNumber}: ${count} item${count === 1 ? "" : "s"}.`,
          link: `/dashboard/sales?sub=${s._id}`,
          relatedOrder: order._id,
        });
      }
    }

    if (docs.length) await Notification.insertMany(docs, { ordered: false });
  } catch (err) {
    console.error("notifyOrderPlaced:", err); // never undo an order for a notification
  }
}

async function notifyCancelled({ order, sub, buyerId }) {
  try {
    const docs = [];
    if (await allowed(sub.seller, "orderNotifications")) {
      docs.push({
        recipient: sub.seller,
        type: "order_update",
        title: "Order cancelled",
        message: `Order ${order.orderNumber} was cancelled by the buyer.`,
        link: `/dashboard/sales?sub=${sub._id}`,
        relatedOrder: order._id,
      });
    }
    if (await allowed(buyerId, "orderUpdates")) {
      docs.push({
        recipient: buyerId,
        type: "order_update",
        title: "Order cancelled",
        message: `Your order from ${sub.store?.name || "the seller"} (${order.orderNumber}) was cancelled.`,
        link: `/dashboard/orders?order=${order._id}`,
        relatedOrder: order._id,
      });
    }
    if (docs.length) await Notification.insertMany(docs, { ordered: false });
  } catch (err) {
    console.error("notifyCancelled:", err);
  }
}

module.exports = { notifyOrderPlaced, notifyCancelled };