const multer = require("multer");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");

const MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_DIR = path.join(__dirname, "..", "uploads", "avatars");
const URL_PREFIX = "/uploads/avatars/";

const parser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 20, fieldSize: 10 * 1024 },
}).single("avatar");

function detectType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

function uploadAvatar(req, res, next) {
  parser(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ message: "Photo must be 5 MB or smaller" });
      if (err.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ message: "Unexpected file field" });
      return next(err);
    }
    if (req.file) {
      const type = detectType(req.file.buffer);
      if (!type) return res.status(400).json({ message: "Photo must be a PNG, JPG or WebP image" });
      req.avatarType = type;
    }
    next();
  });
}

// Writes the uploaded file and returns its public path, e.g. /uploads/avatars/ab12....png
async function saveAvatarFile(req) {
  await fs.mkdir(AVATAR_DIR, { recursive: true });
  const name = `${crypto.randomBytes(16).toString("hex")}.${req.avatarType}`;
  await fs.writeFile(path.join(AVATAR_DIR, name), req.file.buffer);
  return URL_PREFIX + name;
}

// Deletes only files inside /uploads/avatars. Never throws.
async function deleteAvatarFile(urlPath) {
  try {
    if (typeof urlPath !== "string" || !urlPath.startsWith(URL_PREFIX)) return;
    const full = path.resolve(AVATAR_DIR, path.basename(urlPath));
    if (path.dirname(full) !== path.resolve(AVATAR_DIR)) return;
    await fs.unlink(full);
  } catch (_) { /* already gone */ }
}

module.exports = { uploadAvatar, saveAvatarFile, deleteAvatarFile };