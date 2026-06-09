const jwt = require('jsonwebtoken');


function studentAuth(req, res, next) {
    try {
        const token = req.header('Authorization')?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ success: false, message: 'No token' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role !== 'student') return res.status(403).json({ success: false, message: 'Not a student' });
        req.student = decoded;
        next();
    } catch (error) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
}

module.exports = studentAuth;