const mongoose = require("mongoose");

// One saved cart per signed-in user. The model has its own name ("ShoppingCart", collection
// "carts") so it never collides with, or reads documents of, any older cart model.
// Prices and titles are NOT stored: the server looks them up fresh every time (README Part 1 §1).
const lineSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    color: { type: String, default: "", maxlength: 50 },
    size: { type: String, default: "", maxlength: 50 },
    quantity: { type: Number, required: true, min: 1, max: 99 },
    priceAtSelection: { type: Number, min: 0 }, // only used for "price changed from X to Y"
  },
  { _id: false }
);

const cartSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    lines: { type: [lineSchema], default: [], validate: [(v) => v.length <= 100, "Too many cart lines"] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ShoppingCart", cartSchema);