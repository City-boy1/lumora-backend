const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const Notification = require("../models/notification");
const { hashPassword, verifyPassword } = require("../utils/password");
const { sendMail, resetEmail, changedEmail } = require("../utils/mailer");
const { HttpError, asyncHandler } = require("../utils/validate");

const isProd = process.env.NODE_ENV === "production";
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
const RESET_MINUTES = 30;
const RESEND_SECONDS = 60;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
const clientUrl = () => (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "");

function checkNewPassword(v) {
  if (typeof v !== "string" || v.length < PASSWORD_MIN || v.length > PASSWORD_MAX) {
    throw new HttpError(400, `New password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`);
  }
  return v;
}

// In-app notice (always delivered, it is a security alert) plus an email. Never throws.
async function tellPasswordChanged(user) {
  try {
    await Notification.create({
      recipient: user._id,
      type: "general",
      title: "Your password was changed",
      message: "If this wasn't you, reset your password right away and contact support.",
      link: "/dashboard/settings",
      isRead: false,
    });
  } catch (e) {
    console.error("password notification failed:", e.message);
  }
  await sendMail({ to: user.email, ...changedEmail({ name: user.name }) });
}

/* ---------- PATCH /api/auth/change-password  { currentPassword, newPassword } ---------- */
exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== "string" || !currentPassword || currentPassword.length > PASSWORD_MAX) {
    throw new HttpError(400, "Enter your current password");
  }
  checkNewPassword(newPassword);

  const user = await User.findById(req.user.id).select("+password name email");
  if (!user) throw new HttpError(404, "Account not found");

  // 400, not 401, on purpose: the frontend treats a 401 as "token expired" and tries to refresh.
  if (!(await verifyPassword(currentPassword, user.password))) {
    throw new HttpError(400, "Your current password is incorrect");
  }
  if (newPassword === currentPassword) {
    throw new HttpError(400, "Choose a password different from your current one");
  }

  // Keep THIS browser signed in with a fresh refresh token; anything older stops working.
  const refreshToken = jwt.sign(
    { id: String(user._id), jti: crypto.randomUUID() },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: "1d", algorithm: "HS256" }
  );

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        password: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        refreshTokenHash: sha256(refreshToken),
        refreshTokenPrevHash: null,
        refreshTokenPrevUntil: null,
      },
    }
  );

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 24 * 60 * 60 * 1000,
  });

  await tellPasswordChanged(user);
  return res.status(200).json({ message: "Your password has been changed." });
});

/* ---------- POST /api/auth/forgot-password  { email } ---------- */
const GENERIC = {
  message: `If an account exists for that email, we've sent a reset link. It expires in ${RESET_MINUTES} minutes.`,
};

exports.forgotPassword = asyncHandler(async (req, res) => {
  const raw = req.body?.email;
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    throw new HttpError(400, "Enter a valid email address");
  }

  // Same answer whether or not the account exists. The work happens after we reply,
  // so response time doesn't reveal anything either.
  res.status(200).json(GENERIC);

  try {
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();

    // Atomic: one reset link per account per minute, even with parallel requests.
    const user = await User.findOneAndUpdate(
      {
        email,
        $or: [
          { passwordResetRequestedAt: null },
          { passwordResetRequestedAt: { $lt: new Date(now - RESEND_SECONDS * 1000) } },
        ],
      },
      {
        $set: {
          passwordResetHash: sha256(token),
          passwordResetExpires: new Date(now + RESET_MINUTES * 60 * 1000),
          passwordResetRequestedAt: new Date(now),
        },
      },
      { returnDocument: "after" }
    ).select("name email");
    if (!user) return;

    const link = `${clientUrl()}/reset-password?token=${token}`;
    await sendMail({
      to: user.email,
      ...resetEmail({ name: user.name, link, minutes: RESET_MINUTES }),
      devNote: `Reset link (development only): ${link}`,
    });
  } catch (e) {
    console.error("forgotPassword:", e.message);
  }
});

/* ---------- POST /api/auth/reset-password  { token, newPassword } ---------- */
exports.resetPassword = asyncHandler(async (req, res) => {
  const token = req.body?.token;
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    throw new HttpError(400, "This reset link is invalid or has expired.");
  }
  const newPassword = checkNewPassword(req.body?.newPassword);

  // Atomic: the token is checked and burned in one step, so a link works exactly once.
  // Clearing the refresh hashes signs the account out everywhere.
  const user = await User.findOneAndUpdate(
    { passwordResetHash: sha256(token), passwordResetExpires: { $gt: new Date() } },
    {
      $set: {
        password: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        passwordResetHash: null,
        passwordResetExpires: null,
        refreshTokenHash: null,
        refreshTokenPrevHash: null,
        refreshTokenPrevUntil: null,
      },
    },
    { returnDocument: "after" }
  ).select("name email");

  if (!user) throw new HttpError(400, "This reset link is invalid or has expired.");

  await tellPasswordChanged(user);
  return res.status(200).json({ message: "Your password has been reset. You can log in now." });
});