const User = require("../models/user");
const { saveAvatarFile, deleteAvatarFile } = require("../middleware/uploadAvatar");

const SAFE = "-password -refreshTokenHash";
const ADDRESS_KEYS = ["addressLine", "apartment", "city", "region"];
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;

const isTrue = (v) => v === true || v === "true";

const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(SAFE);
    if (!user) return res.status(404).json({ message: "User not found" });
    return res.status(200).json({ user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

const updateMyProfile = async (req, res) => {
  let newAvatarPath = null;
  try {
    const body = req.body || {};
    const set = {};

    // name
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 2 || name.length > 60) {
        return res.status(400).json({ message: "Name must be 2 to 60 characters" });
      }
      set.name = name;
    }

    // bio
    if (body.bio !== undefined) {
      if (typeof body.bio !== "string" || body.bio.trim().length > 500) {
        return res.status(400).json({ message: "Bio must be 500 characters or fewer" });
      }
      set.bio = body.bio.trim();
    }

    // phone (empty clears it)
    if (body.phone !== undefined) {
      if (typeof body.phone !== "string") {
        return res.status(400).json({ message: "Invalid phone number" });
      }
      const phone = body.phone.trim();
      if (phone && !PHONE_RE.test(phone)) {
        return res.status(400).json({ message: "Enter a valid phone number" });
      }
      set.phone = phone;
    }

    // delivery instructions
    if (body.deliveryInstructions !== undefined) {
      if (typeof body.deliveryInstructions !== "string" || body.deliveryInstructions.trim().length > 300) {
        return res.status(400).json({ message: "Delivery instructions must be 300 characters or fewer" });
      }
      set.deliveryInstructions = body.deliveryInstructions.trim();
    }

    // address: sent as a JSON string (multipart) or an object (JSON)
    if (body.address !== undefined) {
      let addr = body.address;
      if (typeof addr === "string") {
        try { addr = JSON.parse(addr); } catch { addr = null; }
      }
      if (!addr || typeof addr !== "object" || Array.isArray(addr)) {
        return res.status(400).json({ message: "Invalid address" });
      }
      for (const key of ADDRESS_KEYS) {
        if (addr[key] === undefined) continue;
        if (typeof addr[key] !== "string" || addr[key].trim().length > 100) {
          return res.status(400).json({ message: `Address field "${key}" is invalid or too long` });
        }
        set[`address.${key}`] = addr[key].trim();
      }
    }

    const removeAvatar = isTrue(body.removeAvatar);

    if (!Object.keys(set).length && !req.file && !removeAvatar) {
      return res.status(400).json({ message: "No valid profile fields provided" });
    }

    // Text is valid. Now handle the photo.
    const existing = await User.findById(req.user.id).select("avatar");
    if (!existing) return res.status(404).json({ message: "User not found" });

    if (req.file) {
      newAvatarPath = await saveAvatarFile(req);
      set.avatar = newAvatarPath;
    } else if (removeAvatar) {
      set.avatar = "";
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: set },
      { returnDocument: "after", runValidators: true }
    ).select(SAFE);

    if (!user) {
      if (newAvatarPath) await deleteAvatarFile(newAvatarPath);
      return res.status(404).json({ message: "User not found" });
    }

    // Saved. Remove the old photo file if it was replaced or removed.
    if ((req.file || removeAvatar) && existing.avatar && existing.avatar !== user.avatar) {
      await deleteAvatarFile(existing.avatar);
    }

    return res.status(200).json({ message: "Profile updated successfully", user });
  } catch (err) {
    if (newAvatarPath) await deleteAvatarFile(newAvatarPath);
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

module.exports = { getMyProfile, updateMyProfile };