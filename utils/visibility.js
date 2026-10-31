const UserSettings = require("../models/settings");
const Store = require("../models/store");

// ONE place that decides which sellers buyers must NOT see: sellers who switched their store off
// (settings.seller.showStore) OR whose store an admin suspended. Every public endpoint (product
// list and detail, cart resolve, wishlist resolve, store page, order creation) must use this, so the
// rule can never drift between endpoints.
async function getHiddenSellerIds() {
  const [switchedOff, suspended] = await Promise.all([
    UserSettings.find({ "seller.showStore": false }).select("user").lean(),
    Store.find({ status: "suspended" }).select("owner").lean(),
  ]);
  return [...switchedOff.map((d) => d.user), ...suspended.map((s) => s.owner)];
}

module.exports = { getHiddenSellerIds };