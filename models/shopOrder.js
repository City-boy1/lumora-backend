const mongoose = require("mongoose");
const { Schema } = mongoose;

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    buyer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    idempotencyKey: { type: String, required: true },
    address: {
      fullName: String,
      region: String,
      city: String,
      line1: String,
      notes: { type: String, default: "" },
    },
    phone: String,
    subOrders: [{ type: Schema.Types.ObjectId, ref: "SubOrder" }],
    itemsTotal: { type: Number, required: true, min: 0 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, required: true, min: 0 },
    payment: {
      provider: String,
      method: String,
      network: { type: String, default: "" },
      momoLast4: { type: String, default: "" },
      status: String,
      reference: String,
      paidAt: Date,
      amount: Number,
      currency: { type: String, default: "GHS" },
    },
  },
  { timestamps: true }
);

orderSchema.index({ buyer: 1, idempotencyKey: 1 }, { unique: true });
orderSchema.index({ buyer: 1, createdAt: -1 });

module.exports = mongoose.models.ShopOrder || mongoose.model("ShopOrder", orderSchema);