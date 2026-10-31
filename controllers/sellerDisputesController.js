const mongoose = require("mongoose");
const Dispute = require("../models/dispute");
const { notifyDisputeReplied } = require("../utils/disputeNotify");
const { HttpError, asyncHandler } = require("../utils/validate");

function cleanMessage(v) {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (s.length < 10 || s.length > 500) {
    throw new HttpError(400, "Your reply must be 10 to 500 characters");
  }
  return s;
}

/* POST /api/seller/disputes/:id/reply  { message } */
exports.replyToDispute = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) throw new HttpError(404, "Report not found");
  const message = cleanMessage(req.body?.message);

  // One atomic step: it must be this seller's, still open, and not answered yet.
  // No suspension check on purpose: matters already in progress carry on.
  const dispute = await Dispute.findOneAndUpdate(
    { _id: id, seller: req.user.id, status: "open", "sellerReply.message": null },
    { $set: { sellerReply: { message, repliedAt: new Date() } } },
    { returnDocument: "after" }
  ).lean();

  if (!dispute) {
    const current = await Dispute.findOne({ _id: id, seller: req.user.id })
      .select("status sellerReply")
      .lean();
    if (!current) throw new HttpError(404, "Report not found"); // also covers someone else's
    if (current.status !== "open") throw new HttpError(409, "This report has already been resolved.");
    throw new HttpError(409, "You already replied to this report.");
  }

  await notifyDisputeReplied({ dispute });

  return res.status(200).json({
    dispute: {
      _id: dispute._id,
      status: dispute.status,
      reason: dispute.reason,
      message: dispute.message,
      sellerReply: { message: dispute.sellerReply.message, repliedAt: dispute.sellerReply.repliedAt },
    },
  });
});