const express = require('express');
const router = express.Router();
const Document = require('../models/Document');
const auth = require('../middleware/auth');
const { cloudinary, uploadDoc } = require('../config/cloudinary');
const requirePermission = require('../middleware/permission');

// GET all (Public)
router.get('/', async (req, res) => {
    try {
        const docs = await Document.find().sort({ createdAt: -1 });
        res.json({ success: true, documents: docs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST upload (Admin)
router.post('/', auth, requirePermission('documents'), uploadDoc.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
        const doc = new Document({
            title: req.body.title,
            category: req.body.category,
            fileUrl: req.file.path,
            cloudinaryId: req.file.filename
        });
        await doc.save();
        res.status(201).json({ success: true, message: 'Uploaded!', doc });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// DELETE (Admin)
router.delete('/:id', auth, requirePermission('documents'),  async (req, res) => {
    try {
        const doc = await Document.findById(req.params.id);
        if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
        if (doc.cloudinaryId) {
            await cloudinary.uploader.destroy(doc.cloudinaryId, { resource_type: 'raw' });
        }
        await Document.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;