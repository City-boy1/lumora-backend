const mongoose = require("mongoose");
const { Schema } = mongoose;

const auditLogSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorName: { type: String, default: "" }, // snapshot, so renames never rewrite history
    action: { type: String, required: true, maxlength: 60 },
    targetType: { type: String, default: "", maxlength: 30 },
    targetId: { type: String, default: "", maxlength: 40 },
    targetLabel: { type: String, default: "", maxlength: 160 }, // e.g. store name, order number
    reason: { type: String, default: "", maxlength: 500 },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);