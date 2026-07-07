const express = require('express');
const router = express.Router();
const Gallery = require('../models/Gallery');
const auth = require('../middleware/auth');
const { cloudinary, upload } = require('../config/cloudinary');
const requirePermission = require('../middleware/permission');

// GET - All photos (Public). Paginates only when ?page is supplied, so existing
// unpaginated callers (e.g. the homepage preview swiper) keep working unchanged.
router.get('/', async (req, res) => {
    try {
        const query = {};
        if (req.query.category && req.query.category !== 'All') query.category = req.query.category;

        if (!req.query.page) {
            const photos = await Gallery.find(query).sort({ createdAt: -1 });
            return res.json({ success: true, count: photos.length, photos });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;

        const total = await Gallery.countDocuments(query);
        const photos = await Gallery.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        res.json({ success: true, photos, total, page, pages: Math.ceil(total / limit) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST - Upload photo with file (Admin only)
router.post('/', auth, requirePermission('gallery.add'), upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: 'No image file provided' 
            });
        }

        const photo = new Gallery({
            title: req.body.title,
            category: req.body.category,
            description: req.body.description || '',
            imageUrl: req.file.path,           // Cloudinary URL
            cloudinaryId: req.file.filename     // For deletion later
        });

        await photo.save();
        res.status(201).json({ 
            success: true, 
            message: 'Photo uploaded successfully!',
            photo 
        });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// DELETE - Remove photo (Admin only)
router.delete('/:id', auth, requirePermission('gallery.delete'), async (req, res) => {
    try {
        const photo = await Gallery.findById(req.params.id);
        
        if (!photo) {
            return res.status(404).json({ success: false, message: 'Photo not found' });
        }

        // Delete from Cloudinary
        if (photo.cloudinaryId) {
            await cloudinary.uploader.destroy(photo.cloudinaryId);
        }

        // Delete from database
        await Gallery.findByIdAndDelete(req.params.id);
        
        res.json({ success: true, message: 'Photo deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


router.put('/:id', auth, requirePermission('gallery.edit'), async (req, res) => {
    try {
        const photo = await Gallery.findByIdAndUpdate(req.params.id, {
            title: req.body.title,
            category: req.body.category,
            description: req.body.description
        }, { returnDocument: 'after' });
        res.json({ success: true, message: 'Updated', photo });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});


module.exports = router;