const AuditLog = require("../models/auditLog");
const User = require("../models/user");

// Which actions belong to which filter tab on the admin page.
const AUDIT_AREAS = {
  sellers: ["seller_suspended", "seller_reinstated"],
  disputes: ["dispute_resolved"],
  orders: ["order_cancelled_by_admin"],
  products: ["product_approved", "product_rejected"],
  categories: ["category_created", "category_updated", "category_deleted"],
  accounts: ["deletion_approved", "deletion_declined"],
};

// Records one admin action. Best effort: a failure is logged and never blocks the action itself.
async function logAudit(req, { action, targetType, targetId, targetLabel = "", reason = "", meta = {} }) {
  try {
    const actor = await User.findById(req.user.id).select("name").lean();
    await AuditLog.create({
      actor: req.user.id,
      actorName: actor?.name || "",
      action,
      targetType,
      targetId: String(targetId || ""),
      targetLabel: String(targetLabel || "").slice(0, 160),
      reason: String(reason || "").slice(0, 500),
      meta,
    });
  } catch (e) {
    console.error("audit log failed:", e.message);
  }
}

module.exports = { logAudit, AUDIT_AREAS };