const mongoose = require("mongoose");

const userSettingsSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    notifications: {
      orderUpdates: { type: Boolean, default: true },        // buyer: my orders
      orderNotifications: { type: Boolean, default: true },  // seller: new orders
      storeNotifications: { type: Boolean, default: true },  // seller: product review results
    },
    seller: {
      showStore: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("UserSettings", userSettingsSchema);