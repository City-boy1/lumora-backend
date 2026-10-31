const argon2 = require("argon2");
const bcrypt = require("bcrypt");

// Argon2id is the current first choice for password hashing (OWASP). Settings below are
// OWASP's recommended minimum profile: 19 MiB memory, 2 passes, 1 lane. Memory per login is
// kept modest on purpose, so a burst of logins cannot exhaust a small server.
const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

const hashPassword = (plain) => argon2.hash(plain, ARGON_OPTIONS);

// Accounts created before this change still have bcrypt hashes ("$2a$", "$2b$").
// They keep working and are upgraded to Argon2id the next time the user logs in.
const isLegacy = (hash) => typeof hash === "string" && hash.startsWith("$2");

async function verifyPassword(plain, hash) {
  try {
    if (typeof plain !== "string" || typeof hash !== "string") return false;
    return isLegacy(hash) ? await bcrypt.compare(plain, hash) : await argon2.verify(hash, plain);
  } catch {
    return false; // malformed hash: treat as a failed login, never crash
  }
}

const needsRehash = (hash) => isLegacy(hash) || argon2.needsRehash(hash, ARGON_OPTIONS);

// A real Argon2id hash of a random value, made once. Logins for unknown emails are verified
// against it so they take as long as real ones (stops "does this email exist?" timing probes).
let dummyPromise;
const getDummyHash = () => (dummyPromise ??= hashPassword(require("crypto").randomBytes(24).toString("hex")));

module.exports = { hashPassword, verifyPassword, needsRehash, getDummyHash };