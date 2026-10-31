const crypto = require("crypto");
const User = require("../models/user");
const PendingSignup = require("../models/pendingSignup");
const { hashPassword } = require("../utils/password");
const { sendMail, signupCodeEmail } = require("../utils/mailer");
const { HttpError, asyncHandler } = require("../utils/validate");

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const CODE_MINUTES = 15;   // how long one code works
const RESEND_SECONDS = 60; // minimum gap between codes
const MAX_ATTEMPTS = 5;    // wrong tries per code
const PENDING_HOURS = 1;   // how long a waiting signup is kept

const cleanEmail = (value) => {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : "";
};

const makeCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

// Keyed hash: a leaked database alone can't be used to work out codes.
const hashCode = (email, code) =>
  crypto.createHmac("sha256", process.env.ACCESS_TOKEN_SECRET).update(`${email}:${code}`).digest("hex");

const same = (a, b) => {
  const x = Buffer.from(String(a), "hex");
  const y = Buffer.from(String(b), "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/* ---------- POST /api/auth/signup  { name, email, password } ---------- */
// Does NOT create an account. Stores a pending signup and emails a code.
const startSignup = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body || {};

  if (typeof name !== "string" || typeof email !== "string" || typeof password !== "string" ||
      !name.trim() || !email.trim() || !password) {
    throw new HttpError(400, "All fields must be filled");
  }

  const cleanName = name.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (cleanName.length < 2 || cleanName.length > 80) {
    throw new HttpError(400, "Name must be between 2 and 80 characters");
  }
  const cleanMail = cleanEmail(email);
  if (!cleanMail) throw new HttpError(400, "Enter a valid email address");
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new HttpError(400, `Password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`);
  }

  const exists = await User.findOne({ email: cleanMail }).select("_id").lean();
  if (exists) {
    throw new HttpError(409, "An account with this email already exists. Please log in instead.");
  }

  const now = Date.now();
  const existing = await PendingSignup.findOne({ email: cleanMail }).select("lastSentAt").lean();
  const canSend = !existing || now - new Date(existing.lastSentAt).getTime() >= RESEND_SECONDS * 1000;

  // The details are updated every time (the person may have fixed a typo).
  // A new code is sent only if the last one is older than a minute.
  const set = {
    name: cleanName,
    passwordHash: await hashPassword(password),
    expiresAt: new Date(now + PENDING_HOURS * 60 * 60 * 1000),
  };
  let code = null;
  if (canSend) {
    code = makeCode();
    Object.assign(set, {
      codeHash: hashCode(cleanMail, code),
      codeExpiresAt: new Date(now + CODE_MINUTES * 60 * 1000),
      attempts: 0,
      lastSentAt: new Date(now),
    });
  }

  try {
    await PendingSignup.updateOne({ email: cleanMail }, { $set: set }, { upsert: true });
  } catch (err) {
    if (err?.code === 11000) throw new HttpError(409, "Please try again in a moment.");
    throw err;
  }

  let emailSent = true;
  if (code) {
    emailSent = await sendMail({
      to: cleanMail,
      ...signupCodeEmail({ name: cleanName, code, minutes: CODE_MINUTES }),
      devNote: `Signup code (development only): ${code}`,
    });
  }

  res.status(200).json({ pending: true, email: cleanMail, emailSent, codeMinutes: CODE_MINUTES });
});

/* ---------- POST /api/auth/signup/verify  { email, code } ---------- */
// The correct code creates the account. The frontend then logs the person in.
const verifySignup = asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const code = typeof req.body?.code === "string" ? req.body.code.replace(/\s/g, "") : "";
  if (!email || !/^\d{6}$/.test(code)) throw new HttpError(400, "Enter the 6-digit code from your email.");

  // Count this try BEFORE checking it, so wrong guesses stay limited even with parallel requests.
  const pending = await PendingSignup.findOneAndUpdate(
    { email, codeExpiresAt: { $gt: new Date() }, attempts: { $lt: MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" }
  ).lean();

  if (!pending) {
    const any = await PendingSignup.findOne({ email }).select("attempts").lean();
    if (any && any.attempts >= MAX_ATTEMPTS) {
      throw new HttpError(429, "Too many wrong codes. Ask for a new code.");
    }
    throw new HttpError(400, "That code has expired. Ask for a new one.");
  }

  if (!same(pending.codeHash, hashCode(email, code))) {
    const left = MAX_ATTEMPTS - pending.attempts;
    throw new HttpError(
      400,
      left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "Too many wrong codes. Ask for a new code."
    );
  }

  try {
    // Only these fields come from the signup. The role always starts as "buyer".
    await User.create({ name: pending.name, email, password: pending.passwordHash });
  } catch (err) {
    if (err?.code === 11000) {
      throw new HttpError(409, "An account with this email already exists. Please log in instead.");
    }
    throw err;
  }

  await PendingSignup.deleteOne({ _id: pending._id });
  res.status(201).json({ verified: true });
});

/* ---------- POST /api/auth/signup/resend  { email } ---------- */
// Same answer whether or not a signup is waiting. One new code per minute.
const resendSignupCode = asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  res.status(200).json({ ok: true });
  if (!email) return;

  try {
    const code = makeCode();
    const now = Date.now();
    const pending = await PendingSignup.findOneAndUpdate(
      { email, lastSentAt: { $lt: new Date(now - RESEND_SECONDS * 1000) } },
      {
        $set: {
          codeHash: hashCode(email, code),
          codeExpiresAt: new Date(now + CODE_MINUTES * 60 * 1000),
          attempts: 0,
          lastSentAt: new Date(now),
          expiresAt: new Date(now + PENDING_HOURS * 60 * 60 * 1000),
        },
      },
      { returnDocument: "after" }
    ).select("name");
    if (!pending) return;

    await sendMail({
      to: email,
      ...signupCodeEmail({ name: pending.name, code, minutes: CODE_MINUTES }),
      devNote: `Signup code (development only): ${code}`,
    });
  } catch (e) {
    console.error("resendSignupCode:", e.message);
  }
});

module.exports = { startSignup, verifySignup, resendSignupCode };