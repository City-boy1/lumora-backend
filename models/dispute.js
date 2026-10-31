const mongoose = require("mongoose");
const { Schema } = mongoose;

const disputeSchema = new Schema(
  {
    subOrder: { type: Schema.Types.ObjectId, ref: "SubOrder", required: true },
    order: { type: Schema.Types.ObjectId, ref: "ShopOrder", required: true },
    orderNumber: { type: String, default: "" },
    buyer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    seller: { type: Schema.Types.ObjectId, ref: "User", required: true },
    store: { _id: Schema.Types.Mixed, name: String },
    reason: {
      type: String,
      enum: ["wrong_item", "damaged", "not_received", "other"],
      required: true,
    },
    message: { type: String, trim: true, maxlength: 500, required: true },
    images: [String],
    status: {
      type: String,
      enum: ["open", "resolved_refund", "resolved_no_action", "closed"],
      default: "open",
    },
    adminNote: { type: String, trim: true, maxlength: 500, default: "" },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: Date,
    sellerReply: {
      message: { type: String, trim: true, maxlength: 500 },
      repliedAt: Date,
    },
  },
  { timestamps: true }
);

// One OPEN dispute per sub-order, enforced by the database
disputeSchema.index({ subOrder: 1 }, { unique: true, partialFilterExpression: { status: "open" } });
disputeSchema.index({ status: 1, createdAt: -1 });
disputeSchema.index({ seller: 1, status: 1 });

module.exports = mongoose.models.Dispute || mongoose.model("Dispute", disputeSchema);