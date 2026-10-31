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

async function notifyReview({ product, rating, sellerId }) {
  try {
    if (!(await allowed(sellerId, "storeNotifications"))) return;
    await Notification.create({
      recipient: sellerId,
      type: "product_review",
      title: "New review",
      message: `New ${rating}-star review on ${product.title}.`,
      link: `/products/${product._id}#reviews`,
      relatedProduct: product._id,
    });
  } catch (err) {
    console.error("notifyReview:", err); // never undo a review for a notification
  }
}

module.exports = { notifyReview };