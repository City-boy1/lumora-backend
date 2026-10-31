const mongoose = require("mongoose");
const { Schema } = mongoose;

const reviewSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    buyer: { type: Schema.Types.ObjectId, ref: "User", required: true },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: { validator: Number.isInteger, message: "Rating must be a whole number" },
    },
    comment: { type: String, trim: true, maxlength: 1000, default: "" },
  },
  { timestamps: true }
);

reviewSchema.index({ product: 1, buyer: 1 }, { unique: true });
reviewSchema.index({ product: 1, createdAt: -1 });

module.exports = mongoose.models.Review || mongoose.model("Review", reviewSchema);