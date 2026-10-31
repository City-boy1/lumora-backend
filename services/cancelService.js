const Product = require("../models/product");
const ShopOrder = require("../models/shopOrder");
const SubOrder = require("../models/subOrder");

const quiet = (p) => Promise.resolve(p).catch((e) => console.error(e));

// The ONE place a sub-order becomes cancelled.
// `filter` must include the status the order has to be in right now, so only one
// caller can win. Returns the cancelled sub-order, or null if someone else got there first.
async function cancelSubOrder({ filter, role, actorId, reason, sellerFault = false, extraSet = {} }) {
  const set = { status: "cancelled", cancelReason: reason, cancelledByRole: role, sellerFault, ...extraSet };
  if (actorId) set.cancelledBy = actorId;

  const entry = { status: "cancelled", at: new Date(), note: reason };
  if (actorId) entry.by = actorId;

  const sub = await SubOrder.findOneAndUpdate(
    filter,
    { $set: set, $push: { timeline: entry } },
    { returnDocument: "after" }
  ).lean();
  if (!sub) return null;

  // Stock goes back exactly once (only the winner of the update above gets here)
  for (const it of sub.items || []) {
    await quiet(
      Product.updateOne(
        { _id: it.product, "variants._id": it.variant },
        { $inc: { "variants.$.stock": it.quantity } }
      )
    );
  }

  // Simulated refund once every part of the order is cancelled
  const all = await SubOrder.find({ order: sub.order }).select("status").lean();
  if (all.every((s) => s.status === "cancelled")) {
    await quiet(ShopOrder.updateOne({ _id: sub.order }, { $set: { "payment.status": "refunded" } }));
  }
  return sub;
}

module.exports = { cancelSubOrder };