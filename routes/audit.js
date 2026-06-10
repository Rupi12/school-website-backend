const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');        // matches your other routes?
const AuditLog = require('../models/AuditLog');

// Superadmin-only audit log viewer with pagination + filters
router.get('/', auth, async (req, res) => {
    if (req.admin.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Superadmin only' });
    }
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 30;
        const filter = {};
        if (req.query.category) filter.category = req.query.category;
        if (req.query.search) {
            filter.$or = [
                { action: { $regex: req.query.search, $options: 'i' } },
                { actorName: { $regex: req.query.search, $options: 'i' } },
                { targetName: { $regex: req.query.search, $options: 'i' } }
            ];
        }
        const total = await AuditLog.countDocuments(filter);
        const logs = await AuditLog.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        res.json({ success: true, logs, total, page, pages: Math.ceil(total / limit) });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to load logs' });
    }
});

module.exports = router;