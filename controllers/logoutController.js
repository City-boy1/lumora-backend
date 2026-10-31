const User = require('../models/user')
const crypto = require('crypto');

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth'
};

const handleLogout = async (req,res) => {
    const token = req.cookies?.refreshToken;

    // Nothing (or not a plain string) to revoke. Still clear the cookie.
    if (typeof token !== "string" || !token) {
        res.clearCookie('refreshToken', cookieOptions);
        return res.sendStatus(204);
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // The browser's cookie is removed first, so the user is signed out on this device
    // even if the database is unreachable.
    res.clearCookie('refreshToken', cookieOptions);

    try {
        // Revoke if the cookie is the current token OR the one just rotated out (grace window).
        await User.updateOne(
            { $or: [{ refreshTokenHash: tokenHash }, { refreshTokenPrevHash: tokenHash }] },
            { $set: { refreshTokenHash: null, refreshTokenPrevHash: null, refreshTokenPrevUntil: null } }
        );
    } catch (err) {
        console.error('logout:', err);
        return res.status(500).json({ message: 'Server Error' });
    }

    return res.sendStatus(204);
};
module.exports = handleLogout