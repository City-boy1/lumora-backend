const multer = require("multer");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 3;
const DIR = path.join(__dirname, "..", "uploads", "disputes");
const URL_PREFIX = "/uploads/disputes/";

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: MAX_FILES, fields: 20, fieldSize: 10 * 1024 },
}).array("images", MAX_FILES);

function detectType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

// Parses up to 3 photos into memory and checks the REAL type from the first bytes.
// Nothing is written to disk here. JSON requests (no files) pass straight through.
function uploadDisputePhotos(req, res, next) {
  parser(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ message: "Each photo must be 5 MB or smaller" });
      if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({ message: `You can add up to ${MAX_FILES} photos` });
      }
      return next(err);
    }
    const files = req.files || [];
    req.photoTypes = [];
    for (const f of files) {
      const type = detectType(f.buffer);
      if (!type) return res.status(400).json({ message: "Photos must be PNG, JPG or WebP images" });
      req.photoTypes.push(type);
    }
    next();
  });
}

// Deletes only files inside /uploads/disputes. Never throws.
async function deleteDisputePhotos(paths) {
  for (const p of paths || []) {
    try {
      if (typeof p !== "string" || !p.startsWith(URL_PREFIX)) continue;
      const full = path.resolve(DIR, path.basename(p));
      if (path.dirname(full) !== path.resolve(DIR)) continue;
      await fs.unlink(full);
    } catch (_) { /* already gone */ }
  }
}

// Writes the photos and returns their public paths. If one write fails, the others are removed.
async function saveDisputePhotos(req) {
  const files = req.files || [];
  const saved = [];
  try {
    if (files.length) await fs.mkdir(DIR, { recursive: true });
    for (let i = 0; i < files.length; i++) {
      const name = `${crypto.randomBytes(16).toString("hex")}.${req.photoTypes[i]}`;
      await fs.writeFile(path.join(DIR, name), files[i].buffer);
      saved.push(URL_PREFIX + name);
    }
    return saved;
  } catch (e) {
    await deleteDisputePhotos(saved);
    throw e;
  }
}

module.exports = { uploadDisputePhotos, saveDisputePhotos, deleteDisputePhotos };