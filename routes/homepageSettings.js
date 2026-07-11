const express = require('express');
const router = express.Router();
const HomepageSettings = require('../models/HomepageSettings');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/permission');
const { upload } = require('../config/cloudinary');

// Public — the mobile app and website homepage both read this on load.
router.get('/', async (req, res) => {
    try {
        let settings = await HomepageSettings.findOne();
        if (!settings) settings = await HomepageSettings.create({});
        res.json({ success: true, settings });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.put('/', auth, requirePermission('homepage.edit'), async (req, res) => {
    try {
        const update = {
            boardResultPercent: req.body.boardResultPercent,
            studentCount: req.body.studentCount,
            facultyCount: req.body.facultyCount,
            yearsOfExcellence: req.body.yearsOfExcellence,
            seatsTotal: req.body.seatsTotal,
            seatsFilled: req.body.seatsFilled,
            resultTrend: req.body.resultTrend,
            toppers: req.body.toppers,
            testimonials: req.body.testimonials,
            facilities: req.body.facilities,
            awards: req.body.awards,
        };
        const settings = await HomepageSettings.findOneAndUpdate({}, update, { returnDocument: 'after', upsert: true });
        res.json({ success: true, message: 'Updated', settings });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Standalone image upload for award/recognition entries — the admin panel uploads
// the file here first, gets back a hosted URL, then includes that URL in the
// award's `image` field on the next PUT /homepage-settings save. Separate from
// the PUT above because awards are array items inside one singleton document,
// not their own collection with a per-item POST like gallery photos.
router.post('/upload-image', auth, requirePermission('homepage.edit'), upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });
        res.json({ success: true, url: req.file.path });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
