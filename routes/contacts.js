const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/permission');
const { formLimiter } = require('../middleware/rateLimiter');

// POST - Submit contact message (Public)
router.post('/', formLimiter, async (req, res) => {
    try {
        const contact = new Contact(req.body);
        await contact.save();
        res.status(201).json({ 
            success: true, 
            message: 'Message sent successfully!' 
        });
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// GET - All messages (Admin only)
router.get('/', auth, requirePermission('messages.view'), async (req, res) => {
    try {
        const contacts = await Contact.find().sort({ createdAt: -1 });
        res.json({ 
            success: true, 
            count: contacts.length, 
            contacts 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// PUT - Mark as read (Admin only)
router.put('/:id/read', auth, requirePermission('messages.view'), async (req, res) => {
    try {
        const contact = await Contact.findByIdAndUpdate(
            req.params.id,
            { isRead: true },
            { returnDocument: 'after' }
        );
        res.json({ success: true, contact });
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// DELETE - Remove message (Admin only)
router.delete('/:id', auth, requirePermission('messages.delete'), async (req, res) => {
    try {
        await Contact.findByIdAndDelete(req.params.id);
        res.json({ 
            success: true, 
            message: 'Message deleted' 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

module.exports = router;