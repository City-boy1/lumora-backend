const multer = require("multer");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const { HttpError } = require("../utils/validate");

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const STORES_DIR = path.join(__dirname, "..", "uploads", "stores");

// The file stays in memory (capped at 2 MB), is checked, and only THEN written to disk.
// Nothing the browser says about the file (name, extension, content type) is trusted.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 8, fieldSize: 4096, parts: 10 },
}).single("logo");

// Real file type from the first bytes. Only PNG, JPEG and WebP are allowed (no SVG: it can carry scripts).
function detectType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

// Express middleware: reads an optional "logo" file and turns upload problems into clear 4xx messages.
const receiveLogo = (req, res, next) =>
  upload(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") return next(new HttpError(413, "Logo must be 2 MB or smaller"));
      if (err.code === "LIMIT_UNEXPECTED_FILE") return next(new HttpError(400, "Unexpected file field"));
      return next(new HttpError(400, "Logo upload failed"));
    }
    return next(err);
  });

// Validates and stores the file. Returns the public path, e.g. "/uploads/stores/<random>.png".
async function saveLogo(file) {
  if (!file?.buffer?.length) throw new HttpError(400, "The logo file is empty");
  const type = detectType(file.buffer);
  if (!type) throw new HttpError(400, "Logo must be a PNG, JPG or WebP image");

  const name = `${crypto.randomBytes(16).toString("hex")}.${type}`; // random, extension from the real type
  await fs.mkdir(STORES_DIR, { recursive: true });
  await fs.writeFile(path.join(STORES_DIR, name), file.buffer, { flag: "wx" });
  return `/uploads/stores/${name}`;
}

// Deletes a stored logo. Refuses anything that is not directly inside uploads/stores.
async function removeStoredLogo(url) {
  if (typeof url !== "string" || !url.startsWith("/uploads/stores/")) return;
  const full = path.resolve(path.join(__dirname, ".."), "." + url);
  if (path.dirname(full) !== STORES_DIR) return;
  await fs.unlink(full).catch(() => {});
}

module.exports = { receiveLogo, saveLogo, removeStoredLogo, detectType };