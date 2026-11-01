const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/user");

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const OBJECT_ID = /^[a-f\d]{24}$/i;

// When a token is rotated, the previous one is still accepted for a few seconds. Without this,
// two refresh calls at the same moment (React dev mode runs effects twice; two tabs) would make
// the second one fail and sign the user out. The grace path only issues a short access token;
// it never rotates and never sets a cookie.
const GRACE_MS = 15 * 1000;

for (const field of ["refreshTokenPrevHash", "refreshTokenPrevUntil"]) {
    if (!User.schema.path(field)) {
        console.warn(`[auth/refresh] User schema is missing "${field}". Add it (see README Part 5); until then two refreshes at once can sign the user out.`);
    }
}

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    path: "/api/auth"
};

const publicUser = (user) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar
});

const issueAccessToken = (user) =>
    jwt.sign(
        { id: user._id.toString(), role: user.role }, // role comes from the database row we just read
        process.env.ACCESS_TOKEN_SECRET,
        { expiresIn: "2m", algorithm: "HS256" }
    );

const handleRefreshToken = async (req, res) => {
    const token = req.cookies?.refreshToken;

    // cookie-parser can turn a cookie into an object; only a plain string is a token.
    if (typeof token !== "string" || !token) {
        return res.status(401).json({ message: "No refresh token" });
    }

    let decoded;

    try {
        decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET, { algorithms: ["HS256"] });
    } catch {
        return res.status(401).json({ message: "Invalid token" });
    }

    if (typeof decoded.id !== "string" || !OBJECT_ID.test(decoded.id)) {
        return res.status(401).json({ message: "Invalid token" });
    }

    try {
        const tokenHash = hashToken(token);

        const user = await User.findById(decoded.id)
            .select("name email role avatar +refreshTokenHash +refreshTokenPrevHash +refreshTokenPrevUntil")
            .lean();

        if (!user) {
            return res.status(401).json({ message: "User not found" });
        }

        const matchesCurrent = !!user.refreshTokenHash && tokenHash === user.refreshTokenHash;
        const matchesPrevious =
            !!user.refreshTokenPrevHash &&
            tokenHash === user.refreshTokenPrevHash &&
            user.refreshTokenPrevUntil &&
            new Date(user.refreshTokenPrevUntil).getTime() > Date.now();

        if (matchesCurrent) {
            // Rotate. The filter repeats the expected old hash, so if another request rotated first
            // this update matches nothing and we fall through to the grace answer below.
            const newRefreshToken = jwt.sign(
                { id: user._id.toString(), jti: crypto.randomUUID() },
                process.env.REFRESH_TOKEN_SECRET,
                { expiresIn: "1d", algorithm: "HS256" }
            );

            const rotated = await User.findOneAndUpdate(
                { _id: user._id, refreshTokenHash: tokenHash },
                {
                    $set: {
                        refreshTokenHash: hashToken(newRefreshToken),
                        refreshTokenPrevHash: tokenHash,
                        refreshTokenPrevUntil: new Date(Date.now() + GRACE_MS)
                    }
                }
            );

            if (rotated) {
                res.cookie("refreshToken", newRefreshToken, { ...cookieOptions, maxAge: 24 * 60 * 60 * 1000 });
                return res.status(200).json({ accessToken: issueAccessToken(user), user: publicUser(user) });
            }
            // Lost the race to a sibling request holding the same token: answer like the grace case.
            return res.status(200).json({ accessToken: issueAccessToken(user), user: publicUser(user) });
        }

        if (matchesPrevious) {
            return res.status(200).json({ accessToken: issueAccessToken(user), user: publicUser(user) });
        }

        // Old or foreign token. We do NOT wipe the stored hash here: with one session per account,
        // a stale token from a device that was signed out by a newer login would otherwise also
        // sign out the device that is currently in use.
        res.clearCookie("refreshToken", cookieOptions);
        return res.status(401).json({ message: "Session expired. Please sign in again." });
    } catch (err) {
        console.error(err);
        return res.status(500).json({
            message: "Server Error"
        });
    }
};

module.exports = handleRefreshToken;