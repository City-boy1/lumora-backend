const { HttpError } = require("./validate");

const BUYER_REASONS = {
  changed_mind: "I changed my mind",
  ordered_by_mistake: "I ordered by mistake",
  found_cheaper: "I found it cheaper elsewhere",
  wrong_address: "I entered the wrong address",
  delivery_too_slow: "Delivery is taking too long",
  other: "Other",
};

const SELLER_REASONS = {
  out_of_stock: "Item is out of stock",
  cannot_deliver_area: "I can't deliver to that area",
  price_error: "The price was listed wrongly",
  buyer_unreachable: "I couldn't reach the buyer",
  other: "Other",
};

const REQUEST_AUTO_APPROVE_HOURS = 24; // buyer's request at "confirmed"
const AUTO_CANCEL_HOURS = 48;          // seller never confirmed a "placed" order

// Turns a reason code + optional note into one readable string. Throws 400 on bad input.
function resolveReason(table, code, note) {
  if (typeof code !== "string" || !Object.prototype.hasOwnProperty.call(table, code)) {
    throw new HttpError(400, "Choose a reason");
  }
  const n = typeof note === "string" ? note.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (n.length > 300) throw new HttpError(400, "Note must be 300 characters or fewer");
  if (code === "other" && n.length < 3) throw new HttpError(400, "Please add a short note");
  return { code, text: n ? `${table[code]}: ${n}` : table[code] };
}

function shapeCancelRequest(cr) {
  if (!cr || !cr.status) return null;
  const at = cr.requestedAt ? new Date(cr.requestedAt) : null;
  return {
    status: cr.status,
    reason: cr.reason || "",
    requestedAt: cr.requestedAt || null,
    autoApproveAt: at ? new Date(at.getTime() + REQUEST_AUTO_APPROVE_HOURS * 3600000) : null,
    respondNote: cr.respondNote || "",
  };
}

module.exports = {
  BUYER_REASONS, SELLER_REASONS, REQUEST_AUTO_APPROVE_HOURS, AUTO_CANCEL_HOURS,
  resolveReason, shapeCancelRequest,
};