const rateLimit = require('express-rate-limit');

// Login: 5 attempts per 15 min per IP
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 7,
    message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Forms: 5 submissions per hour per IP
const formLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Too many submissions. Try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = { loginLimiter, formLimiter };