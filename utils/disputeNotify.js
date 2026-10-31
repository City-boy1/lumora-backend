const Notification = require("../models/notification");
const UserSettings = require("../models/settings");
const User = require("../models/user");

async function allowed(userId, key) {
  try {
    const s = await UserSettings.findOne({ user: userId }).select("notifications").lean();
    return s?.notifications?.[key] !== false;
  } catch {
    return true;
  }
}

async function notifyDisputeOpened({ order, sellerId, subOrderId }) {  try {
    if (!(await allowed(sellerId, "orderNotifications"))) return;
    await Notification.create({
      recipient: sellerId,
      type: "order_update",
      title: "A buyer reported a problem",
      message: `A buyer reported a problem with order ${order.orderNumber}.`,
      link: `/dashboard/sales?sub=${subOrderId}`,
      relatedOrder: order._id,
    });
  } catch (err) {
    console.error("notifyDisputeOpened:", err); // never undo a report for a notification
  }
}

// Tell every admin that the seller answered, so they can decide
async function notifyDisputeReplied({ dispute }) {
  try {
    const admins = await User.find({ role: "admin" }).select("_id").lean();
    if (admins.length === 0) return;
    await Notification.insertMany(
      admins.map((a) => ({
        recipient: a._id,
        type: "general",
        title: "Seller replied to a dispute",
        message: `${dispute.store?.name || "A seller"} replied about order ${dispute.orderNumber}.`,
        link: "/dashboard/disputes",
        relatedOrder: dispute.order,
      })),
      { ordered: false }
    );
  } catch (err) {
    console.error("notifyDisputeReplied:", err); // never undo a reply for a notification
  }
}

module.exports = { notifyDisputeOpened, notifyDisputeReplied };