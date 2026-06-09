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



// GET - All applications (Admin only)
router.get('/', auth, requirePermission('applications'), async (req, res) => {
    try {
        const applications = await Application.find().sort({ createdAt: -1 });
        res.json({ 
            success: true, 
            count: applications.length, 
            applications 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});



// GET - Single application (Admin only)
router.get('/:id', auth, requirePermission('applications'), async (req, res) => {
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
router.put('/:id', auth, requirePermission('applications'), async (req, res) => {
    try {
        const application = await Application.findByIdAndUpdate(
            req.params.id,
            { status: req.body.status },
            { new: true }
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
router.delete('/:id', auth, requirePermission('applications'), async (req, res) => {
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