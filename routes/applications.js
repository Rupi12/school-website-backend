const express = require('express');
const router = express.Router();
const Application = require('../models/Application');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/permission');
const { formLimiter } = require('../middleware/rateLimiter');

// POST - Submit new application (Public)
router.post('/', formLimiter, async (req, res) => {
    try {
        const application = new Application(req.body);
        await application.save();
        res.status(201).json({ 
            success: true, 
            message: 'Application submitted successfully!',
            application 
        });
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});



// GET - All applications (Admin only). Paginates only when ?page is supplied, so
// existing unpaginated callers keep working unchanged.
router.get('/', auth, requirePermission('applications.view'), async (req, res) => {
    try {
        const query = {};
        if (req.query.status && req.query.status !== 'All') query.status = req.query.status;
        if (req.query.search) {
            query.$or = [
                { studentName: { $regex: req.query.search, $options: 'i' } },
                { parentName: { $regex: req.query.search, $options: 'i' } },
            ];
        }

        if (!req.query.page) {
            const applications = await Application.find(query).sort({ createdAt: -1 });
            return res.json({ success: true, count: applications.length, applications });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;

        const total = await Application.countDocuments(query);
        const pendingCount = await Application.countDocuments({ status: 'pending' });
        const applications = await Application.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        res.json({ success: true, applications, total, page, pages: Math.ceil(total / limit), pendingCount });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});



// GET - Single application (Admin only)
router.get('/:id', auth, requirePermission('applications.view'), async (req, res) => {
    try {
        const application = await Application.findById(req.params.id);
        if (!application) {
            return res.status(404).json({ 
                success: false, 
                message: 'Application not found' 
            });
        }
        res.json({ success: true, application });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// PUT - Update status (Admin only)
router.put('/:id', auth, requirePermission('applications.edit'), async (req, res) => {
    try {
        const application = await Application.findByIdAndUpdate(
            req.params.id,
            { status: req.body.status },
            { returnDocument: 'after' }
        );
        res.json({ success: true, application });
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// DELETE - Remove application (Admin only)
router.delete('/:id', auth, requirePermission('applications.delete'), async (req, res) => {
    try {
        await Application.findByIdAndDelete(req.params.id);
        res.json({ 
            success: true, 
            message: 'Application deleted' 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});




module.exports = router;