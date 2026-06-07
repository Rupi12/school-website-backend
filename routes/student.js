const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Student = require('../models/Student');
const Result = require('../models/Result');
const Attendance = require('../models/Attendance');
const Timetable = require('../models/Timetable');
const Fee = require('../models/Fee');
const StudentDoc = require('../models/StudentDoc');
const studentAuth = require('../middleware/studentAuth');

// Student Login
router.post('/login', async (req, res) => {
    try {
        const { rollNumber, password } = req.body;
        const student = await Student.findOne({ rollNumber });
        if (!student) return res.status(401).json({ success: false, message: 'Invalid credentials' });
        const match = await student.comparePassword(password);
        if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials' });

        const token = jwt.sign(
            { id: student._id, rollNumber: student.rollNumber, role: 'student' },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.json({
            success: true, token,
            student: { id: student._id, name: student.name, rollNumber: student.rollNumber, class: student.class, section: student.section }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get my profile
router.get('/me', studentAuth, async (req, res) => {
    const student = await Student.findById(req.student.id).select('-password');
    res.json({ success: true, student });
});

// My results
router.get('/results', studentAuth, async (req, res) => {
    const results = await Result.find({ studentId: req.student.id }).sort({ createdAt: -1 });
    res.json({ success: true, results });
});

// My attendance
router.get('/attendance', studentAuth, async (req, res) => {
    const attendance = await Attendance.find({ studentId: req.student.id }).sort({ date: -1 });
    const total = attendance.length;
    const present = attendance.filter(a => a.status === 'Present').length;
    res.json({ success: true, attendance, summary: { total, present, percentage: total ? Math.round((present/total)*100) : 0 } });
});

// My timetable
router.get('/timetable', studentAuth, async (req, res) => {
    const student = await Student.findById(req.student.id);
    const timetable = await Timetable.findOne({ class: student.class, section: student.section });
    res.json({ success: true, timetable });
});

// My fees
router.get('/fees', studentAuth, async (req, res) => {
    const fees = await Fee.find({ studentId: req.student.id }).sort({ dueDate: 1 });
    res.json({ success: true, fees });
});

// My documents
router.get('/documents', studentAuth, async (req, res) => {
    const docs = await StudentDoc.find({ studentId: req.student.id }).sort({ createdAt: -1 });
    res.json({ success: true, documents: docs });
});

module.exports = router;