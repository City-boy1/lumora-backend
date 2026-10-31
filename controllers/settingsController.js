const UserSettings = require("../models/settings");

const getUserId = (req) => {
  const u = req.user;
  const id = u?.id || u?._id || u?.userId;
  return id ? String(id) : null;
};

const NOTIFICATION_KEYS = ["orderUpdates", "orderNotifications", "storeNotifications"];

const toResponse = (doc) => ({
  orderUpdates: doc.notifications?.orderUpdates ?? true,
  orderNotifications: doc.notifications?.orderNotifications ?? true,
  storeNotifications: doc.notifications?.storeNotifications ?? true,
  showStore: doc.seller?.showStore ?? true,
});

// GET /api/users/me/settings
const getMySettings = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });

    const doc = await UserSettings.findOneAndUpdate(
      { user: userId },
      { $setOnInsert: { user: userId } },
      { upsert: true,  returnDocument: 'after', setDefaultsOnInsert: true }
    );

    return res.status(200).json({ settings: toResponse(doc) });
  } catch (err) {
    console.error("getMySettings:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

// PATCH /api/users/me/settings
const updateMySettings = async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ message: "Authentication required" });

    const body = req.body || {};
    const update = {};

    for (const key of NOTIFICATION_KEYS) {
      if (key in body) {
        if (typeof body[key] !== "boolean") {
          return res.status(400).json({ message: `${key} must be true or false` });
        }
        update[`notifications.${key}`] = body[key];
      }
    }

    // Only sellers have a store.
    if ("showStore" in body && req.user?.role === "seller") {
      if (typeof body.showStore !== "boolean") {
        return res.status(400).json({ message: "showStore must be true or false" });
      }
      update["seller.showStore"] = body.showStore;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: "No valid settings provided" });
    }

    const doc = await UserSettings.findOneAndUpdate(
      { user: userId },
      { $set: update },
      { upsert: true,  returnDocument: 'after', setDefaultsOnInsert: true, runValidators: true }
    );

    return res.status(200).json({
      message: "Settings saved",
      settings: toResponse(doc),
    });
  } catch (err) {
    console.error("updateMySettings:", err);
    return res.status(500).json({ message: "Server Error" });
  }
};

module.exports = { getMySettings, updateMySettings };