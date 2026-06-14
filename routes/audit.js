const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');        // matches your other routes?
const AuditLog = require('../models/AuditLog');
const requirePermission = require('../middleware/permission');

// Audit log viewer with pagination + filters
router.get('/', auth, requirePermission('audit.view'), async (req, res) => {
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