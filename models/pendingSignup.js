const mongoose = require("mongoose");
const { Schema } = mongoose;

// A signup waiting for its email code. No User exists until the code is entered.
const pendingSignupSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true }, // hashed already; never returned by any endpoint
    codeHash: { type: String, required: true },
    codeExpiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, required: true },
    // MongoDB deletes the whole record at this time (checked about once a minute)
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  { timestamps: true }
);

module.exports = mongoose.models.PendingSignup || mongoose.model("PendingSignup", pendingSignupSchema);