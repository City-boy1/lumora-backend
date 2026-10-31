const User = require("../models/user");
const DeletionRequest = require("../models/deletionRequest");
const Notification = require("../models/notification");
const { countBlockers } = require("../services/accountClosure");
const { HttpError, asyncHandler } = require("../utils/validate");

const shape = async (r) => {
  const b = await countBlockers(r.user);
  return { _id: r._id, status: r.status, reason: r.reason, createdAt: r.createdAt, ...b };
};

// GET /api/users/me/deletion-request  -> { request: {...} | null }
exports.getMine = asyncHandler(async (req, res) => {
  const r = await DeletionRequest.findOne({ user: req.user.id, status: "pending" }).lean();
  res.json({ request: r ? await shape(r) : null });
});

// POST /api/users/me/deletion-request  { reason? }
exports.create = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select("name email role").lean();
  if (!user) throw new HttpError(404, "Account not found");
  if (user.role === "admin") throw new HttpError(403, "Administrator accounts can't be closed here");

  const raw = req.body?.reason;
  const reason = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (reason.length > 300) throw new HttpError(400, "Keep the reason to 300 characters or fewer");

  let request;
  try {
    request = await DeletionRequest.create({
      user: user._id,
      userName: user.name,
      userEmail: user.email,
      userRole: user.role,
      reason,
    });
  } catch (err) {
    if (err?.code === 11000) throw new HttpError(409, "You already have a request waiting for review.");
    throw err;
  }

  try {
    const admins = await User.find({ role: "admin" }).select("_id").lean();
    if (admins.length) {
      await Notification.insertMany(
        admins.map((a) => ({
          recipient: a._id,
          type: "general",
          title: "Account deletion request",
          message: `${user.name} (${user.role}) asked to close their account.`,
          link: "/dashboard/deletions",
          isRead: false,
        })),
        { ordered: false }
      );
    }
  } catch (e) {
    console.error("deletion notification failed:", e.message); // the request itself already exists
  }

  res.status(201).json({ request: await shape(request.toObject()) });
});

// DELETE /api/users/me/deletion-request  (cancel my pending request)
exports.cancel = asyncHandler(async (req, res) => {
  const r = await DeletionRequest.findOneAndUpdate(
    { user: req.user.id, status: "pending" },
    { $set: { status: "cancelled", resolvedAt: new Date() } },
    { returnDocument: "after" }
  );
  if (!r) throw new HttpError(404, "You have no pending request");
  res.json({ ok: true });
});