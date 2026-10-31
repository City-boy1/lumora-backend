const mongoose = require("mongoose");
const Notification = require("../models/notification");

const FALLBACK_LINK = {
  new_order: "/dashboard/sales",
  order_update: "/dashboard/orders",
  product_approved: "/dashboard/inventory",
  product_rejected: "/dashboard/inventory",
  store_suspended: "/dashboard/store",
  store_reinstated: "/dashboard/store",
};

const shape = (n) => ({
  _id: n._id,
  type: n.type,
  title: n.title,
  message: n.message,
  link: n.link || FALLBACK_LINK[n.type] || "/dashboard/notifications",
  read: !!n.isRead,
  createdAt: n.createdAt,
});

exports.listMine = async (req, res) => {
  try {
    const rows = await Notification.find({ recipient: req.user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return res.status(200).json({ notifications: rows.map(shape) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.markRead = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }
    const result = await Notification.updateOne(
      { _id: req.params.id, recipient: req.user.id },
      { $set: { isRead: true } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

exports.markAllRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient: req.user.id, isRead: false },
      { $set: { isRead: true } }
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};