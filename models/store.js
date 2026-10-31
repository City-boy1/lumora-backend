const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    logo: { type: String, default: "" },
    address: { type: String, trim: true, maxlength: 200, default: "" },

    // Part 3 §6.2. Kept separate from the seller's own settings.seller.showStore switch.
    status: { type: String, enum: ["active", "suspended"], default: "active" },
    suspendedAt: { type: Date },
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    suspensionReason: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

// Admin Sellers list: filter by status, newest first.
storeSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Store", storeSchema);