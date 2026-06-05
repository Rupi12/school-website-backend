const express = require('express');
const router = express.Router();
const News = require('../models/News');
const auth = require('../middleware/auth');
const { cloudinary, upload } = require('../config/cloudinary');

router.get('/', async (req, res) => {
    try {
        const news = await News.find().sort({ isPinned: -1, createdAt: -1 });
        res.json({ success: true, count: news.length, news });
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

router.post('/', auth, upload.single('image'), async (req, res) => {
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
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.delete('/:id', auth, async (req, res) => {
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