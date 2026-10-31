const SubOrder = require("../models/subOrder");
const ShopOrder = require("../models/shopOrder");
const { cancelSubOrder } = require("../services/cancelService");
const { REQUEST_AUTO_APPROVE_HOURS, AUTO_CANCEL_HOURS } = require("../utils/cancelReasons");
const { notifyCancelRequestAnswered, notifyAutoCancelled } = require("../utils/cancelNotify");

const HOUR = 60 * 60 * 1000;
const EVERY_MS = 10 * 60 * 1000;
const BATCH = 100;

let timer = null;
let running = false;

const orderFor = async (sub) =>
  (await ShopOrder.findById(sub.order).select("orderNumber").lean()) || { _id: sub.order, orderNumber: "" };

// Buyer asked to cancel a confirmed order and the seller never answered
async function autoApproveRequests() {
  const cutoff = new Date(Date.now() - REQUEST_AUTO_APPROVE_HOURS * HOUR);
  const due = await SubOrder.find({
    status: "confirmed",
    "cancelRequest.status": "pending",
    "cancelRequest.requestedAt": { $lte: cutoff },
  }).select("_id order cancelRequest").limit(BATCH).lean();

  for (const d of due) {
    const sub = await cancelSubOrder({
      filter: { _id: d._id, status: "confirmed", "cancelRequest.status": "pending" },
      role: "system",
      actorId: null,
      reason: `${d.cancelRequest.reason || "Cancelled at the buyer's request"} (approved automatically: the seller did not answer in ${REQUEST_AUTO_APPROVE_HOURS} hours)`,
      sellerFault: false,
      extraSet: { "cancelRequest.status": "auto_approved", "cancelRequest.respondedAt": new Date() },
    });
    if (sub) await notifyCancelRequestAnswered({ order: await orderFor(sub), sub, outcome: "auto_approved" });
  }
}

// Seller never confirmed a placed order
async function autoCancelStale() {
  const cutoff = new Date(Date.now() - AUTO_CANCEL_HOURS * HOUR);
  const due = await SubOrder.find({ status: "placed", createdAt: { $lte: cutoff } })
    .select("_id").limit(BATCH).lean();

  for (const d of due) {
    const sub = await cancelSubOrder({
      filter: { _id: d._id, status: "placed" },
      role: "system",
      actorId: null,
      reason: `The seller did not confirm this order within ${AUTO_CANCEL_HOURS} hours`,
      sellerFault: true,
    });
    if (sub) await notifyAutoCancelled({ order: await orderFor(sub), sub });
  }
}

// Safe to run on several servers at once: every step is an atomic update,
// so only the run that wins an order cancels it and sends its notifications.
async function runOrderJobs() {
  if (running) return;
  running = true;
  try {
    await autoApproveRequests();
    await autoCancelStale();
  } catch (e) {
    console.error("order jobs failed:", e.message);
  } finally {
    running = false;
  }
}

function start() {
  if (timer || process.env.RUN_JOBS === "false") return;
  setTimeout(runOrderJobs, 30 * 1000); // first run shortly after start
  timer = setInterval(runOrderJobs, EVERY_MS);
  timer.unref?.();
}

module.exports = { start, runOrderJobs };