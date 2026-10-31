const mongoose = require("mongoose");
const { Schema } = mongoose;

const itemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product" },
    variant: { type: Schema.Types.ObjectId }, // needed to restore stock on cancel
    title: String,
    image: String,
    color: { type: String, default: "" },
    size: { type: String, default: "" },
    unitPrice: Number,
    quantity: Number,
    lineTotal: Number,
  },
  { _id: false }
);

const subOrderSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: "ShopOrder", required: true },
    buyer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    seller: { type: Schema.Types.ObjectId, ref: "User", required: true },
    store: { _id: Schema.Types.Mixed, name: String, logo: { type: String, default: "" } },
    items: [itemSchema],
    subtotal: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled"],
      default: "placed",
    },
    timeline: [
      {
        status: String,
        at: { type: Date, default: Date.now },
        note: { type: String, default: "" },
        by: { type: Schema.Types.ObjectId, ref: "User" },
        _id: false,
      },
    ],
    cancelReason: { type: String, default: "" },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null }, // who (id)
    cancelledByRole: { type: String, enum: ["buyer", "seller", "admin", "system"] }, // who (role)
    sellerFault: { type: Boolean, default: false }, // counts against the seller's cancel rate
    // Buyer's request to cancel an order the seller already confirmed
    cancelRequest: {
      status: { type: String, enum: ["pending", "approved", "refused", "auto_approved"] },
      reasonCode: String,
      reason: String,
      requestedAt: Date,
      respondedAt: Date,
      respondNote: String,
    },
    deliveredAt: Date,
    receivedAt: Date,
  },
  { timestamps: true }
);

subOrderSchema.index({ order: 1 });
subOrderSchema.index({ buyer: 1, createdAt: -1 });
subOrderSchema.index({ seller: 1, status: 1, createdAt: -1 });
subOrderSchema.index({ status: 1, createdAt: 1 }); // auto-cancel job
subOrderSchema.index({ "cancelRequest.status": 1, "cancelRequest.requestedAt": 1 }); // auto-approve job

module.exports = mongoose.models.SubOrder || mongoose.model("SubOrder", subOrderSchema);