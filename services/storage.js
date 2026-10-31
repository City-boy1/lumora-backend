const fs = require("fs/promises");
const path = require("path");

const driver = (process.env.STORAGE_DRIVER || "local").toLowerCase();
const isProd = process.env.NODE_ENV === "production";
const UPLOAD_ROOT = path.join(__dirname, "..", "uploads");
const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

let s3 = null;
function client() {
  if (s3) return s3;
  const { S3Client } = require("@aws-sdk/client-s3"); // loaded only when R2 is used
  s3 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return s3;
}

// Call once at startup.
function checkStorageEnv() {
  if (driver === "local") {
    if (isProd) console.warn("Warning: STORAGE_DRIVER=local in production. Uploads will be lost on redeploy.");
    return;
  }
  if (driver !== "r2") {
    console.error('STORAGE_DRIVER must be "local" or "r2"');
    process.exit(1);
  }
  const need = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error("Cannot start. Missing for R2: " + missing.join(", "));
    process.exit(1);
  }
  if (!isProd && !process.env.R2_BUCKET.endsWith("-dev")) {
    console.error("Refusing to use a non-dev R2 bucket outside production (bucket name must end in -dev).");
    process.exit(1);
  }
}

// Saves a file and returns the path to store in the database: /uploads/<folder>/<name>.<type>
async function saveFile({ folder, name, buffer, type }) {
  if (!/^[a-z]+$/.test(folder) || !/^[a-f0-9]{16,64}$/.test(name) || !MIME[type]) {
    throw new Error("Invalid file details");
  }
  const rel = `uploads/${folder}/${name}.${type}`;

  if (driver === "r2") {
    const { PutObjectCommand } = require("@aws-sdk/client-s3");
    await client().send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: rel,
      Body: buffer,
      ContentType: MIME[type],
      CacheControl: "public, max-age=31536000, immutable", // names are random, so safe to cache
    }));
  } else {
    const full = path.join(UPLOAD_ROOT, folder, `${name}.${type}`);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);
  }
  return `/${rel}`;
}

// Deletes a stored file by its database path. Never throws.
async function deleteFile(urlPath) {
  try {
    if (typeof urlPath !== "string") return;
    if (!/^\/uploads\/[a-z]+\/[a-f0-9]{16,64}\.(png|jpg|webp)$/.test(urlPath)) return;
    const rel = urlPath.slice(1);

    if (driver === "r2") {
      const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
      await client().send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET, Key: rel }));
    } else {
      await fs.unlink(path.join(__dirname, "..", rel));
    }
  } catch (e) {
    /* already gone or not deletable: ignore */
  }
}

module.exports = { saveFile, deleteFile, checkStorageEnv, STORAGE_DRIVER: driver };