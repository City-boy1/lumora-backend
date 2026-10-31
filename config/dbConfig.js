const mongoose = require("mongoose");
require("dotenv").config();

const isProd = process.env.NODE_ENV === "production";

const connectDB = async () => {
  const uri = process.env.DATABASE_URL;
  if (!uri) throw new Error("DATABASE_URL is missing");

  const isAtlas = /^mongodb\+srv:|mongodb\.net/i.test(uri);
  const isLocal = /(localhost|127\.0\.0\.1|\[::1\])/i.test(uri);

  // Guard rails so testing on your PC can never touch live data (and the reverse).
  if (!isProd && isAtlas && process.env.ALLOW_REMOTE_DB !== "true") {
    throw new Error(
      "Refusing to connect: this looks like an Atlas database but NODE_ENV is not production. " +
      "Use your local MongoDB, or set ALLOW_REMOTE_DB=true if you really mean it."
    );
  }
  if (isProd && isLocal) {
    throw new Error("Refusing to start in production with a local database URL.");
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`Database connected (${isAtlas ? "Atlas" : "local"}, db: ${mongoose.connection.name})`);
};

module.exports = connectDB;