const multer = require("multer");
const path = require("path");
const fs = require("fs");

// <project root>/uploads/products  (this file lives in <project root>/middleware)
const uploadDir = path.join(__dirname, "..", "uploads", "products");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed."));
    }
    cb(null, true);
  },
});

// Single "image" field, with errors returned as JSON.
const uploadProductImage = (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "Image size must not exceed 3 MB."
          : `Image upload failed: ${err.message}`;
      return res.status(400).json({ message });
    }

    return res.status(400).json({ message: err.message || "Image upload failed." });
  });
};

module.exports = uploadProductImage;