const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// Only this algorithm is accepted. Pinning it blocks "alg" confusion / "none" tricks.
const JWT_OPTIONS = { algorithms: ['HS256'] };
const OBJECT_ID = /^[a-f\d]{24}$/i;

// "Authorization: Bearer <token>" only; any other scheme is refused.
const readBearer = (req) => {
    const header = req.headers.authorization;
    if (typeof header !== 'string') return null;
    const [scheme, token, extra] = header.split(' ');
    if (scheme !== 'Bearer' || !token || extra !== undefined) return null;
    return token;
};

const verifyAccessToken = (req, res, next) => {
    const token = readBearer(req);

    if (!token) {
        return res.status(401).json({
            message: 'Access token required'
        });
    }

    try {
        const decoded = jwt.verify(
            token,
            process.env.ACCESS_TOKEN_SECRET,
            JWT_OPTIONS
        );

        // The id must be a real ObjectId string, nothing else.
        if (typeof decoded.id !== 'string' || !OBJECT_ID.test(decoded.id)) {
            return res.status(401).json({
                message: 'Invalid or expired token'
            });
        }

        // role here comes from the token and is only a hint; allowedRoles re-checks it.
        req.user = {
            id: decoded.id,
            role: decoded.role
        };

        return next();
    } catch (err) {
        return res.status(401).json({
            message: 'Invalid or expired token'
        });
    }
};

const verifyRefreshToken = (req, res, next) => {
    const token = req.cookies?.refreshToken;

    if (typeof token !== 'string' || !token) {
        return res.status(401).json({
            message: 'No refresh token'
        });
    }

    try {
        const decoded = jwt.verify(
            token,
            process.env.REFRESH_TOKEN_SECRET,
            JWT_OPTIONS
        );

        if (typeof decoded.id !== 'string' || !OBJECT_ID.test(decoded.id)) {
            return res.status(401).json({
                message: 'Invalid or expired token'
            });
        }

        req.user = { id: decoded.id };

        return next();
    } catch (err) {
        return res.status(401).json({
            message: 'Invalid or expired token'
        });
    }
};

// Checks the CURRENT role in the database, not the role frozen inside the token.
// So a demoted or deleted user loses access immediately, and a buyer who just
// opened a store can use seller routes without waiting for a token refresh.
// Cost: one small indexed lookup (_id, role only) on role-protected routes.
const allowedRoles = (...roles) => async (req, res, next) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({
                message: 'Access token required'
            });
        }

        const user = await mongoose.model('User').findById(req.user.id).select('role').lean();

        if (!user) {
            return res.status(401).json({
                message: 'Invalid or expired token'
            });
        }

        if (!roles.includes(user.role)) {
            return res.status(403).json({
                message: 'You are not allowed to access this route'
            });
        }

        req.user.role = user.role; // from here on, the trusted value
        return next();
    } catch (err) {
        console.error('allowedRoles:', err);
        return res.status(500).json({
            message: 'Something went wrong. Please try again.'
        });
    }
};

module.exports = {
    verifyAccessToken,
    verifyRefreshToken,
    allowedRoles
};