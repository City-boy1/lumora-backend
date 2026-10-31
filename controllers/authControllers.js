const User = require('../models/user.js')
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { hashPassword, verifyPassword, needsRehash, getDummyHash } = require('../utils/password');
const { startSignup } = require('./signupController');
require('dotenv').config();

const isProd = process.env.NODE_ENV === "production";

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const PASSWORD_MAX = 128;

// Returns a clean lowercase email, or "" when the value is not a valid email string.
const cleanEmail = (value) => {
    if (typeof value !== "string") return "";
    const email = value.trim().toLowerCase();
    return email.length <= 254 && EMAIL_RE.test(email) ? email : "";
};

// Signing up no longer creates an account straight away: it stores a pending signup and
// emails a code. The account is created when the code is verified (see signupController.js).
const handleSignup = startSignup;


const handleLogin = async (req, res) => {
    const email = cleanEmail(req.body?.email);
    const password = req.body?.password;

    if (typeof req.body?.email !== "string" || typeof password !== "string" || !req.body.email.trim() || !password) {
        return res.status(400).json({ message: "All fields required" });
    }

    // Anything that cannot be a valid email or password gets the same answer as a wrong one.
    if (!email || password.length > PASSWORD_MAX) {
        return res.status(401).json({ message: "Invalid email or password" });
    }

    try {
        const foundUser = await User.findOne({ email }).select("+password");

        // Always do one full password check, even for unknown emails, so timing reveals nothing.
        const match = await verifyPassword(password, foundUser?.password || await getDummyHash());

        if (!foundUser || !match) {
            return res.status(401).json({ message: "Invalid email or password" });
        }

        // Quietly upgrade old bcrypt hashes to Argon2id now that we hold the plain password.
        if (needsRehash(foundUser.password)) {
            try {
                await User.updateOne({ _id: foundUser._id }, { $set: { password: await hashPassword(password) } });
            } catch (e) {
                console.error("Password upgrade failed:", e.message); // login still succeeds
            }
        }

        // jti makes every refresh token unique, even two issued in the same second.
        const refreshToken = jwt.sign(
            { id: foundUser._id.toString(), jti: crypto.randomUUID() },
            process.env.REFRESH_TOKEN_SECRET,
            { expiresIn: "1d", algorithm: "HS256" }
        );

        const refreshTokenHash = crypto
            .createHash("sha256")
            .update(refreshToken)
            .digest("hex");

        await User.updateOne({ _id: foundUser._id }, { $set: { refreshTokenHash } });

        res.cookie("refreshToken", refreshToken, {
            httpOnly: true,
            secure: isProd, // HTTPS only in production; plain http still works on localhost
            sameSite: "lax",
            path: "/api/auth",
            maxAge: 24 * 60 * 60 * 1000
        });

        const accessToken = jwt.sign(
            { id: foundUser._id.toString(),role: foundUser.role },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: "2m", algorithm: "HS256" }
        );

        return res.status(200).json({ accessToken ,user:{
            _id: foundUser._id,
            name: foundUser.name,
            email:foundUser.email,
            role: foundUser.role,
            avatar: foundUser.avatar,
        }});

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server error" });
    }
};

module.exports = { handleSignup, handleLogin };