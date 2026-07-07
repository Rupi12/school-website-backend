const express = require('express');
const router = express.Router();
const News = require('../models/News');
const Student = require('../models/Student');
const auth = require('../middleware/auth');
const { cloudinary, upload } = require('../config/cloudinary');
const requirePermission = require('../middleware/permission');
const { sendPushToTokens } = require('../utils/pushNotifications');

// Paginates only when ?page is supplied, so existing unpaginated callers keep working.
router.get('/', async (req, res) => {
    try {
        const query = {};
        if (req.query.category && req.query.category !== 'All') query.category = req.query.category;
        if (req.query.search) query.title = { $regex: req.query.search, $options: 'i' };

        if (!req.query.page) {
            const news = await News.find(query).sort({ isPinned: -1, createdAt: -1 });
            return res.json({ success: true, count: news.length, news });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;

        const total = await News.countDocuments(query);
        const news = await News.find(query)
            .sort({ isPinned: -1, createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        res.json({ success: true, news, total, page, pages: Math.ceil(total / limit) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/latest', async (req, res) => {
    try {
        const news = await News.find().sort({ isPinned: -1, createdAt: -1 }).limit(3);
        res.json({ success: true, news });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/announcements', async (req, res) => {
    try {
        const announcements = await News.find({ category: 'Announcements' }).sort({ createdAt: -1 }).limit(5);
        res.json({ success: true, announcements });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/', auth, requirePermission('news.add'), upload.single('image'), async (req, res) => {
    try {
        const newsData = {
            title: req.body.title,
            description: req.body.description,
            category: req.body.category,
            eventDate: req.body.eventDate || null,
            isPinned: req.body.isPinned === 'true'
        };
        if (req.file) {
            newsData.imageUrl = req.file.path;
            newsData.cloudinaryId = req.file.filename;
        }
        const news = new News(newsData);
        await news.save();
        res.status(201).json({ success: true, message: 'News added!', news });

        // Notify all students (fire-and-forget; runs after the response).
        try {
            const students = await Student.find({ pushToken: { $ne: '' } }).select('pushToken').lean();
            const tokens = students.map(s => s.pushToken).filter(Boolean);
            const label = news.category === 'Announcements' ? 'New Announcement' : `New ${news.category || 'Notice'}`;
            sendPushToTokens(tokens, `📢 ${label}`, news.title, { url: '/news' });
        } catch (_) { /* push is best-effort */ }
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.put('/:id', auth, requirePermission('news.edit'), async (req, res) => {
    try {
        const news = await News.findByIdAndUpdate(req.params.id, {
            title: req.body.title,
            category: req.body.category,
            description: req.body.description,
            eventDate: req.body.eventDate || null,
            isPinned: req.body.isPinned
        }, { returnDocument: 'after' });
        
        res.json({ success: true, message: 'Updated', news });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.delete('/:id', auth, requirePermission('news.delete'), async (req, res) => {
    try {
        const news = await News.findById(req.params.id);
        if (!news) return res.status(404).json({ success: false, message: 'Not found' });
        if (news.cloudinaryId) await cloudinary.uploader.destroy(news.cloudinaryId);
        await News.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;