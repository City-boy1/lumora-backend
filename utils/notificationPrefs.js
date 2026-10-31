const UserSettings = require("../models/settings");

const TYPE_TO_KEY = {
  order_update: "orderUpdates",         // to a buyer
  new_order: "orderNotifications",      // to a seller
  product_review: "storeNotifications", // to a seller
};

// Security and admin notifications are never blocked.
async function canNotify(userId, type) {
  const key = TYPE_TO_KEY[type];
  if (!key) return true;

  const settings = await UserSettings.findOne({ user: userId }).select("notifications");
  return settings?.notifications?.[key] ?? true; // no record yet means defaults (on)
}

module.exports = { canNotify };