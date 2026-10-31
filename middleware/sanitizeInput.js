const { HttpError } = require("../utils/validate");

// Blocks NoSQL operator injection and prototype pollution before any controller runs.
// Rejects (does not rewrite) any key that starts with "$", contains ".", or is __proto__ / constructor / prototype,
// anywhere in req.body, req.query or req.params. Works on Express 4 and 5 (read only).
const BAD_KEY = /^\$|\.|^(__proto__|constructor|prototype)$/;
const MAX_DEPTH = 8;
const MAX_KEYS = 2000;

function scan(value, depth, counter) {
  if (value === null || typeof value !== "object") return true;
  if (depth > MAX_DEPTH) return false;
  for (const key of Object.keys(value)) {
    if (++counter.n > MAX_KEYS || BAD_KEY.test(key)) return false;
    if (!scan(value[key], depth + 1, counter)) return false;
  }
  return true;
}

module.exports = function sanitizeInput(req, res, next) {
  const counter = { n: 0 };
  if (scan(req.body, 0, counter) && scan(req.query, 0, counter) && scan(req.params, 0, counter)) return next();
  return next(new HttpError(400, "Invalid request"));
};