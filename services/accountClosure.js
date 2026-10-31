const crypto = require("crypto");
const User = require("../models/user");
const Store = require("../models/store");
const SubOrder = require("../models/subOrder");
const Dispute = require("../models/dispute");
const Notification = require("../models/notification");
const ShoppingCart = require("../models/cart");
const UserSettings = require("../models/settings");
const { hashPassword } = require("../utils/password");
const { deleteAvatarFile } = require("../middleware/uploadAvatar");

const OPEN_STATUSES = ["placed", "confirmed", "packed", "shipped"];

// What stops an account from being closed right now.
async function countBlockers(userId) {
  const [openOrders, openDisputes] = await Promise.all([
    SubOrder.countDocuments({ $or: [{ buyer: userId }, { seller: userId }], status: { $in: OPEN_STATUSES } }),
    Dispute.countDocuments({ $or: [{ buyer: userId }, { seller: userId }], status: "open" }),
  ]);
  return { openOrders, openDisputes };
}

// Anonymises the account. Orders, disputes and reviews stay (records, refunds), but no longer
// point to a real person. `user` must be a lean document loaded BEFORE this runs (for the avatar path).
async function closeAccount(user) {
  const id = user._id;

  await User.updateOne(
    { _id: id },
    {
      $set: {
        name: "Deleted user",
        email: `deleted-${id}@deleted.invalid`,
        password: await hashPassword(crypto.randomBytes(32).toString("hex")), // nobody knows it: no login
        avatar: "",
        phone: "",
        bio: "",
        address: { addressLine: "", apartment: "", city: "", region: "" },
        deliveryInstructions: "",
        deletedAt: new Date(),
        refreshTokenHash: null,        // signed out everywhere
        refreshTokenPrevHash: null,
        refreshTokenPrevUntil: null,
        passwordResetHash: null,
        passwordResetExpires: null,
      },
    }
  );

  // Cleanup that must not undo the closure if one piece fails.
  await Promise.allSettled([
    ShoppingCart.deleteOne({ user: id }),
    Notification.deleteMany({ recipient: id }),
    UserSettings.deleteOne({ user: id }),
    // A seller's store disappears from buyers: suspended stores are hidden everywhere.
    Store.updateOne(
      { owner: id, status: "active" },
      { $set: { status: "suspended", suspendedAt: new Date(), suspensionReason: "Account closed" } }
    ),
    deleteAvatarFile(user.avatar),
  ]);
}

module.exports = { countBlockers, closeAccount, OPEN_STATUSES };