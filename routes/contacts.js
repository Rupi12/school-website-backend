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

// GET - All messages (Admin only). Paginates only when ?page is supplied, so
// existing unpaginated callers keep working unchanged.
router.get('/', auth, requirePermission('messages.view'), async (req, res) => {
    try {
        const query = {};
        if (req.query.search) {
            query.$or = [
                { name: { $regex: req.query.search, $options: 'i' } },
                { subject: { $regex: req.query.search, $options: 'i' } },
                { message: { $regex: req.query.search, $options: 'i' } },
            ];
        }

        if (!req.query.page) {
            const contacts = await Contact.find(query).sort({ createdAt: -1 });
            return res.json({ success: true, count: contacts.length, contacts });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;

        const total = await Contact.countDocuments(query);
        const unreadCount = await Contact.countDocuments({ isRead: { $ne: true } });
        const contacts = await Contact.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        res.json({ success: true, contacts, total, page, pages: Math.ceil(total / limit), unreadCount });
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