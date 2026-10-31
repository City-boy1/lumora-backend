const Notification = require("../models/notification");
const UserSettings = require("../models/settings");
const User = require("../models/user");
const Store = require("../models/store");

async function allowed(userId, key) {
  try {
    const s = await UserSettings.findOne({ user: userId }).select("notifications").lean();
    return s?.notifications?.[key] !== false;
  } catch {
    return true;
  }
}

const short = (s, n = 80) => (String(s || "").length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ""));

// Tells the seller their product was approved or rejected. Never blocks the admin action.
async function notifyProductDecision({ product, approved, reason = "" }) {
  try {
    const sellerId = product.createdBy;
    if (!sellerId) return;

    if (approved) {
      if (!(await allowed(sellerId, "storeNotifications"))) return;
      await Notification.create({
        recipient: sellerId,
        type: "product_approved",
        title: "Product approved",
        message: `Your product "${short(product.title)}" was approved and is now visible to buyers.`,
        link: "/dashboard/inventory",
        relatedProduct: product._id,
      });
    } else {
      // Always delivered: the seller needs the reason to fix the product.
      await Notification.create({
        recipient: sellerId,
        type: "product_rejected",
        title: "Product rejected",
        message: `Your product "${short(product.title)}" was not approved. Reason: ${reason}`,
        link: "/dashboard/inventory",
        relatedProduct: product._id,
      });
    }
  } catch (err) {
    console.error("notifyProductDecision:", err.message);
  }
}

// Tells every admin a product is waiting for review. Never throws.
async function notifyProductSubmitted({ product, edited = false }) {
  try {
    const [admins, store, owner] = await Promise.all([
      User.find({ role: "admin" }).select("_id").lean(),
      Store.findOne({ owner: product.createdBy }).select("name").lean(),
      User.findById(product.createdBy).select("name").lean(),
    ]);
    if (!admins.length) return;

    const who = store?.name || owner?.name || "A seller";
    await Notification.insertMany(
      admins.map((a) => ({
        recipient: a._id,
        type: "general",
        title: edited ? "Product edited, review again" : "New product to review",
        message: `${short(who, 40)} ${edited ? "edited" : "submitted"} "${short(product.title)}".`,
        link: "/dashboard/products",
        relatedProduct: product._id,
      })),
      { ordered: false }
    );
  } catch (err) {
    console.error("notifyProductSubmitted:", err.message);
  }
}

module.exports = { notifyProductDecision, notifyProductSubmitted };