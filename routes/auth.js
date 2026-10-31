const {handleSignup,handleLogin} = require('../controllers/authControllers');
const handleRefreshToken = require("../controllers/refreshTokenController");
const handleLogout = require("../controllers/logoutController")
const {verifyRefreshToken, verifyAccessToken} = require('../middleware/authMiddleware')

const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { changePassword, forgotPassword, resetPassword } = require("../controllers/passwordController");
const { verifySignup, resendSignupCode } = require("../controllers/signupController");


const express = require ('express')
const router = express.Router()

const tooMany = (message) => ({ message });
const emailKey = (req) => (typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase().slice(0, 254) : "");

// Guessing passwords for ONE account from ONE address: 5 failed tries per 15 minutes.
// Keyed by address + email, so a stranger cannot lock a real user out by typing their email.
const loginPerAccount = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true, // only failed logins count
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${emailKey(req)}`,
  message: tooMany("Too many failed attempts. Please try again in 15 minutes."),
});

// Trying many different accounts from one address: 30 failed tries per 15 minutes.
const loginPerAddress = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: tooMany("Too many failed attempts. Please try again later."),
});

// Mass account creation: 10 sign-ups per hour per address.
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: tooMany("Too many sign-ups from this network. Please try again later."),
});

// Entering or re-requesting the signup email code: 20 per 15 minutes per address.
// (Each code also allows only 5 wrong tries, enforced in the database.)
const signupCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: tooMany("Too many attempts. Please wait a few minutes."),
});

const passwordLimiter = (limit, message, byUser = false) =>
  rateLimit({
    windowMs: 60 * 60 * 1000,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    ...(byUser ? { keyGenerator: (req) => String(req.user.id) } : {}),
    message: { message },
  });

// Step 1: stores a pending signup and emails a code (no account yet)
router.post('/signup', signupLimiter, handleSignup)
// Step 2: the correct code creates the account
router.post('/signup/verify', signupCodeLimiter, verifySignup)
router.post('/signup/resend', signupCodeLimiter, resendSignupCode)

router.post('/login', loginPerAddress, loginPerAccount, handleLogin)
router.patch("/change-password", verifyAccessToken, passwordLimiter(10, "Too many attempts. Try again later.", true), changePassword);
router.post("/forgot-password", passwordLimiter(5, "Too many requests. Try again in an hour."), forgotPassword);
router.post("/reset-password", passwordLimiter(10, "Too many attempts. Try again later."), resetPassword);
router.post('/logout',handleLogout)
router.post("/refresh",verifyRefreshToken, handleRefreshToken);

module.exports = router