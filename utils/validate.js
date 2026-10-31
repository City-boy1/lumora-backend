// Input checks shared by the new controllers. Everything here fails closed:
// wrong type, wrong shape or out-of-range input becomes a 400, never a query.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true; // safe to show the client
  }
}

// Express 4 does not catch rejected promises from async handlers; one missing
// try/catch can crash the process. Wrap every async handler in this.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Only a plain 24-hex string counts as an id (rejects objects, arrays, numbers).
const isObjectId = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);

function requireObjectId(v, label = "id") {
  if (!isObjectId(v)) throw new HttpError(400, `Invalid ${label}`);
  return v;
}

// Required text: must be a string (never an object like {"$ne":null}), control
// characters removed, trimmed, length-checked.
function requireText(v, { min, max, label }) {
  if (typeof v !== "string") throw new HttpError(400, `${label} is required`);
  const t = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (t.length < min) throw new HttpError(400, `${label} must be at least ${min} characters`);
  if (t.length > max) throw new HttpError(400, `${label} must be at most ${max} characters`);
  return t;
}

// Optional text from a query string: absent means "", anything but a short string is a 400.
function optionalQueryText(v, { max, label }) {
  if (v === undefined || v === "") return "";
  if (typeof v !== "string") throw new HttpError(400, `Invalid ${label}`);
  const t = v.trim();
  if (t.length > max) throw new HttpError(400, `${label} is too long`);
  return t;
}

function oneOf(v, allowed, label) {
  if (v === undefined || v === "") return "";
  if (typeof v !== "string" || !allowed.includes(v)) throw new HttpError(400, `Invalid ${label}`);
  return v;
}

// Page number: whole number from 1 to maxPage. Anything else is a 400.
function parsePage(v, maxPage = 10000) {
  if (v === undefined || v === "") return 1;
  if (typeof v !== "string" || !/^\d{1,5}$/.test(v)) throw new HttpError(400, "Invalid page");
  const n = Number(v);
  if (n < 1 || n > maxPage) throw new HttpError(400, "Invalid page");
  return n;
}

// Escape user text before it goes into a regular expression (stops regex
// injection and catastrophic patterns).
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Who is acting. Adjust if your verifyAccessToken stores the user differently.
const actorId = (req) => String(req.user?._id || req.user?.id || "");

module.exports = { HttpError, asyncHandler, isObjectId, requireObjectId, requireText, optionalQueryText, oneOf, parsePage, escapeRegex, actorId };