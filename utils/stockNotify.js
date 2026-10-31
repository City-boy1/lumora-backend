const Product = require("../models/product");
const Notification = require("../models/notification");
const UserSettings = require("../models/settings");

const LOW_STOCK_LIMIT = 5;

async function allowed(userId, key) {
  try {
    const s = await UserSettings.findOne({ user: userId }).select("notifications").lean();
    return s?.notifications?.[key] !== false;
  } catch {
    return true;
  }
}

// `reserved` is the list of { product, variant, quantity } an order just took from stock.
// Notifies the seller only when THIS order crossed the line (to 5 or fewer, or to sold out).
async function notifyLowStock(reserved) {
  try {
    if (!reserved?.length) return;
    const ids = [...new Set(reserved.map((r) => String(r.product)))];
    const products = await Product.find({ _id: { $in: ids } }).select("title createdBy variants").lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));

    const docs = [];
    for (const r of reserved) {
      const p = byId.get(String(r.product));
      const v = p?.variants?.find((x) => String(x._id) === String(r.variant));
      if (!p || !v || !p.createdBy) continue;

      const before = v.stock + r.quantity;
      const soldOut = v.stock === 0 && before > 0;
      const crossed = before > LOW_STOCK_LIMIT && v.stock <= LOW_STOCK_LIMIT;
      if (!soldOut && !crossed) continue;
      if (!(await allowed(p.createdBy, "storeNotifications"))) continue;

      const option = [v.color, v.size].filter(Boolean).join(" · ");
      const label = `${p.title}${option ? ` (${option})` : ""}`;
      docs.push({
        recipient: p.createdBy,
        type: "general",
        title: soldOut ? "Sold out" : "Low stock",
        message: soldOut ? `${label} is now sold out.` : `Only ${v.stock} left of ${label}.`,
        link: "/dashboard/inventory",
        relatedProduct: p._id,
      });
    }
    if (docs.length) await Notification.insertMany(docs, { ordered: false });
  } catch (err) {
    console.error("notifyLowStock:", err.message); // never undo an order for a notification
  }
}

module.exports = { notifyLowStock, LOW_STOCK_LIMIT };