const express = require('express');
const router = express.Router();
const HomepageSettings = require('../models/HomepageSettings');
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/permission');

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
        };
        const settings = await HomepageSettings.findOneAndUpdate({}, update, { new: true, upsert: true });
        res.json({ success: true, message: 'Updated', settings });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

module.exports = router;
