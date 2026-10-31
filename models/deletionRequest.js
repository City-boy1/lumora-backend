const mongoose = require("mongoose");
const { Schema } = mongoose;

const deletionRequestSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Snapshots: the user record is anonymised on approval, the admin history must still make sense.
    userName: { type: String, default: "" },
    userEmail: { type: String, default: "" },
    userRole: { type: String, default: "" },
    reason: { type: String, trim: true, maxlength: 300, default: "" },
    status: { type: String, enum: ["pending", "approved", "declined", "cancelled"], default: "pending" },
    adminNote: { type: String, trim: true, maxlength: 300, default: "" },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: Date,
  },
  { timestamps: true }
);

// One PENDING request per user, enforced by the database.
deletionRequestSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { status: "pending" } });
deletionRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.models.DeletionRequest || mongoose.model("DeletionRequest", deletionRequestSchema);