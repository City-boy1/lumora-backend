const User = require("../models/user.js");
const Store = require("../models/store");
const Notification = require("../models/notification");
const { HttpError, asyncHandler, requireText, actorId } = require("../utils/validate");

// The seller dates are written with $set. If the User schema does not declare them, Mongoose
// silently drops them, so warn loudly once at start-up instead of failing quietly.
for (const field of ["sellerSince", "sellerTermsAcceptedAt"]) {
  if (!User.schema.path(field)) {
    console.warn(`[sellers/apply] User schema is missing "${field}". Add it (see README Part 5).`);
  }
}

// Optional text: absent, null or "" means ""; anything that is not a string is a 400.
function optionalDescription(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") throw new HttpError(400, "Description must be text");
  return requireText(value, { min: 0, max: 500, label: "Description" });
}

// POST /api/sellers/apply   (signed in)
// body { name, description?, address, acceptedTerms: true }
// Any other key (mainCategory, categories, role, status, owner...) is ignored on purpose.
exports.applyAsSeller = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};

  const name = requireText(body.name, { min: 3, max: 60, label: "Store name" });
  const address = requireText(body.address, { min: 5, max: 200, label: "Location" });
  const description = optionalDescription(body.description);
  if (body.acceptedTerms !== true) throw new HttpError(400, "You must accept the seller terms");

  const userId = actorId(req);

  // The role is read from the database, never from the token.
  const current = await User.findById(userId).select("role").lean();
  if (!current) throw new HttpError(401, "Invalid or expired token");
  if (current.role === "seller") throw new HttpError(409, "You already have a seller account");
  if (current.role !== "buyer") throw new HttpError(403, "Only buyers can open a store");
  if (await Store.exists({ owner: userId })) throw new HttpError(409, "You already have a store");

  // Step 1: compare-and-set. Only ONE request can turn this buyer into a seller, so a double
  // click or two tabs can never create two stores or send two welcome messages.
  const now = new Date();
  const user = await User.findOneAndUpdate(
    { _id: userId, role: "buyer" },
    { $set: { role: "seller", sellerSince: now, sellerTermsAcceptedAt: now } },
    { new: true }
  );
  if (!user) throw new HttpError(409, "Your account was just updated. Please refresh and check your dashboard.");

  // Step 2: create the store. If that fails, put the account back so nobody is left a seller
  // with no store. (A database transaction would need a replica set; this works on a single server.)
  let store;
  try {
    store = await Store.create({ owner: userId, name, description, address, status: "active" });
  } catch (err) {
    try {
      await User.updateOne(
        { _id: userId, role: "seller" },
        { $set: { role: "buyer" }, $unset: { sellerSince: "", sellerTermsAcceptedAt: "" } }
      );
    } catch (rollbackErr) {
      console.error("sellers/apply rollback failed:", rollbackErr.message);
    }
    if (err?.code === 11000) throw new HttpError(409, "You already have a store");
    throw err;
  }

  // Welcome message. Best effort: a failure here must never undo a store that now exists.
  try {
    await Notification.create({
      recipient: userId,
      type: "general",
      title: "Your store is open",
      message: `Your store ${store.name} is open. Add your first product.`,
      link: "/dashboard/inventory",
    });
  } catch (e) {
    console.error("sellers/apply notification failed:", e.message);
  }

  // Whitelisted response: no password, no token hash.
  res.status(200).json({
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      bio: user.bio,
      address: user.address,
      sellerSince: user.sellerSince,
    },
    store: {
      _id: store._id,
      name: store.name,
      description: store.description,
      logo: store.logo,
      address: store.address,
      status: store.status,
    },
  });
});