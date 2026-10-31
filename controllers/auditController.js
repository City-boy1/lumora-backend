const AuditLog = require("../models/auditLog");
const { AUDIT_AREAS } = require("../utils/audit");
const { asyncHandler, oneOf, parsePage } = require("../utils/validate");

const PAGE_SIZE = 30;

// GET /api/admin/audit?area&page   (read only: there is no way to edit or delete entries)
exports.listAudit = asyncHandler(async (req, res) => {
  const area = oneOf(req.query.area, Object.keys(AUDIT_AREAS), "area");
  const page = parsePage(req.query.page);
  const filter = area ? { action: { $in: AUDIT_AREAS[area] } } : {};

  const [rows, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);

  res.json({
    entries: rows.map((r) => ({
      _id: r._id,
      createdAt: r.createdAt,
      actor: { name: r.actorName || "Admin" },
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      targetLabel: r.targetLabel,
      reason: r.reason,
      meta: r.meta || {},
    })),
    total,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
});