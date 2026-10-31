const User = require("../models/user");
const DeletionRequest = require("../models/deletionRequest");
const Notification = require("../models/notification");
const { countBlockers, closeAccount } = require("../services/accountClosure");
const { sendMail } = require("../utils/mailer");
const { logAudit } = require("../utils/audit");
const { HttpError, asyncHandler, requireObjectId, oneOf, parsePage } = require("../utils/validate");

const PAGE_SIZE = 20;

const cleanNote = (v) =>
  typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";

// GET /api/admin/deletion-requests?status&page
exports.listDeletionRequests = asyncHandler(async (req, res) => {
  const status = oneOf(req.query.status, ["pending", "approved", "declined", "cancelled"], "status");
  const page = parsePage(req.query.page);
  const filter = status ? { status } : {};

  const [rows, total] = await Promise.all([
    DeletionRequest.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    DeletionRequest.countDocuments(filter),
  ]);

  const requests = await Promise.all(
    rows.map(async (r) => {
      const b = r.status === "pending" ? await countBlockers(r.user) : { openOrders: 0, openDisputes: 0 };
      return {
        _id: r._id,
        status: r.status,
        reason: r.reason,
        adminNote: r.adminNote,
        createdAt: r.createdAt,
        resolvedAt: r.resolvedAt || null,
        user: { name: r.userName, email: r.userEmail, role: r.userRole },
        ...b,
      };
    })
  );

  res.json({ requests, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
});

// PATCH /api/admin/deletion-requests/:id  { action: "approve" | "decline", adminNote? }
exports.resolveDeletionRequest = asyncHandler(async (req, res) => {
  const id = requireObjectId(req.params.id, "request id");
  const action = req.body?.action;
  if (action !== "approve" && action !== "decline") throw new HttpError(400, "Choose approve or decline");

  const adminNote = cleanNote(req.body?.adminNote);
  if (adminNote.length > 300) throw new HttpError(400, "Keep the note to 300 characters or fewer");
  if (action === "decline" && adminNote.length < 3) throw new HttpError(400, "Tell the user why, in 3 to 300 characters");

  const request = await DeletionRequest.findById(id).lean();
  if (!request) throw new HttpError(404, "Request not found");
  if (request.status !== "pending") throw new HttpError(409, "This request was already handled or cancelled");

  const claim = (status) =>
    DeletionRequest.findOneAndUpdate(
      { _id: id, status: "pending" },
      { $set: { status, adminNote, resolvedBy: req.user.id, resolvedAt: new Date() } },
      { returnDocument: "after" }
    ).lean();

  /* ---------- decline ---------- */
  if (action === "decline") {
    const done = await claim("declined");
    if (!done) throw new HttpError(409, "This request was already handled or cancelled");

    try {
      await Notification.create({
        recipient: request.user,
        type: "general",
        title: "Your account deletion request was declined",
        message: `Your account stays open. Reason: ${adminNote}`,
        link: "/dashboard/settings",
        isRead: false,
      });
    } catch (e) {
      console.error("deletion decline notification failed:", e.message);
    }
    await logAudit(req, {
      action: "deletion_declined",
      targetType: "user",
      targetId: request.user,
      targetLabel: request.userName,
      reason: adminNote,
    });
    return res.json({ request: { _id: id, status: "declined" } });
  }

  /* ---------- approve ---------- */
  const user = await User.findById(request.user).select("name email avatar role deletedAt").lean();
  if (!user || user.deletedAt) throw new HttpError(409, "This account is already closed");
  if (user.role === "admin") throw new HttpError(409, "Administrator accounts can't be closed here");

  const b = await countBlockers(request.user);
  if (b.openOrders || b.openDisputes) {
    throw new HttpError(
      409,
      `Can't close this account yet: ${b.openOrders} open order(s) and ${b.openDisputes} open problem report(s) must be finished first.`
    );
  }

  const done = await claim("approved");
  if (!done) throw new HttpError(409, "This request was already handled or cancelled");

  // Tell them while we still know their email address. Never blocks.
  await sendMail({
    to: user.email,
    subject: "Your Lumora account was closed",
    text: `Hi ${user.name},\n\nAs you asked, your Lumora account has been closed and your personal details removed. Order records are kept for accounting. Thank you for using Lumora.`,
    html: `<p>Hi ${user.name.replace(/[<>&"']/g, "")},</p><p>As you asked, your Lumora account has been closed and your personal details removed. Order records are kept for accounting.</p><p>Thank you for using Lumora.</p>`,
  });

  try {
    await closeAccount(user);
  } catch (e) {
    console.error("closeAccount failed:", e.message);
    // Put the request back so an admin can try again.
    await DeletionRequest.updateOne(
      { _id: id, status: "approved" },
      { $set: { status: "pending", resolvedBy: null, resolvedAt: null, adminNote: "" } }
    );
    throw new HttpError(500, "We couldn't close the account. Nothing was changed, please try again.");
  }

  await logAudit(req, {
    action: "deletion_approved",
    targetType: "user",
    targetId: request.user,
    targetLabel: request.userName,
    reason: adminNote,
  });
  return res.json({ request: { _id: id, status: "approved" } });
});