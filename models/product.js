const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: String,
    variants: [
      {
        color: String,
        size: String,
        stock: { type: Number, required: true, default: 0 },
        price: { type: Number, required: true, min: 0 },
      },
    ],
    imgUrl: { type: String, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reviewStatus: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: { type: String, default: null },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: { type: Date, default: null },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },
    ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

productSchema.index({ reviewStatus: 1, createdAt: -1 });

module.exports = mongoose.model("Product", productSchema);