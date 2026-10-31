const Store = require("../models/store");
const User = require("../models/user");

async function attachStores(items) {
  if (!Array.isArray(items) || items.length === 0) return items;

  const ownerIds = [...new Set(items.map((p) => String(p.createdBy)))];

  const stores = await Store.find({ owner: { $in: ownerIds } })
    .select("owner name")
    .lean();
  const byOwner = new Map(stores.map((s) => [String(s.owner), s]));

  const missing = ownerIds.filter((id) => !byOwner.has(id));
  const names = new Map();
  if (missing.length) {
    const users = await User.find({ _id: { $in: missing } }).select("name").lean();
    users.forEach((u) => names.set(String(u._id), u.name));
  }

  return items.map((p) => {
    const key = String(p.createdBy);
    const s = byOwner.get(key);
    return {
      ...p,
      store: s
        ? { _id: s._id, name: s.name }
        : { _id: key, name: names.get(key) || "Seller" },
    };
  });
}

module.exports = { attachStores };