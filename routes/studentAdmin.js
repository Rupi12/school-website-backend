const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const Student = require('../models/Student');
const Result = require('../models/Result');
const Attendance = require('../models/Attendance');
const Timetable = require('../models/Timetable');
const Fee = require('../models/Fee');
const StudentDoc = require('../models/StudentDoc');
const auth = require('../middleware/auth');
const { uploadDoc } = require('../config/cloudinary');
const { cloudinary } = require('../config/cloudinary');

// ---- STUDENTS ----
router.get('/students', auth, async (req, res) => {
    const students = await Student.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, students });
});

router.post('/students', auth, async (req, res) => {
    try {
        const { name, rollNumber, password, class: cls, section, parentName, phone, email } = req.body;
        const exists = await Student.findOne({ rollNumber });
        if (exists) return res.status(400).json({ success: false, message: 'Roll number exists' });
        const hashed = await bcrypt.hash(password, 10);
        const student = new Student({ name, rollNumber, password: hashed, class: cls, section, parentName, phone, email });
        await student.save();
        res.status(201).json({ success: true, message: 'Student added', student: { id: student._id, name, rollNumber } });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.delete('/students/:id', auth, async (req, res) => {
    await Student.findByIdAndDelete(req.params.id);
    // cleanup related data
    await Result.deleteMany({ studentId: req.params.id });
    await Attendance.deleteMany({ studentId: req.params.id });
    await Fee.deleteMany({ studentId: req.params.id });
    await StudentDoc.deleteMany({ studentId: req.params.id });
    res.json({ success: true, message: 'Student deleted' });
});

// ---- RESULTS ----
router.post('/results', auth, async (req, res) => {
    try {
        const { studentId, examName, term, academicYear, examDate, subjects, remark } = req.body;

        // Validation
        if (!studentId || !examName || !academicYear) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        if (!subjects || subjects.length === 0) {
            return res.status(400).json({ success: false, message: 'Add at least one subject' });
        }
        // Validate marks
        for (const s of subjects) {
            if (s.marksObtained > s.totalMarks) {
                return res.status(400).json({ success: false, message: `${s.subject}: marks exceed total` });
            }
        }

        // Prevent duplicate (same exam + term + year for student)
        const existing = await Result.findOne({ studentId, examName, term, academicYear });
        if (existing) {
            return res.status(400).json({ success: false, message: 'Result for this exam/term/year already exists' });
        }

        const result = new Result({ studentId, examName, term, academicYear, examDate, subjects, remark });
        await result.save();
        res.status(201).json({ success: true, message: 'Result added' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// ---- ATTENDANCE ----
router.post('/attendance', auth, async (req, res) => {
    try {
        const { studentId, date, status } = req.body;
        const day = new Date(date);
        day.setHours(0,0,0,0);
        const nextDay = new Date(day);
        nextDay.setDate(day.getDate() + 1);

        // Check existing
        const existing = await Attendance.findOne({
            studentId,
            date: { $gte: day, $lt: nextDay }
        });
        if (existing) {
            existing.status = status;
            await existing.save();
            return res.json({ success: true, message: 'Attendance updated (already existed)' });
        }
        await new Attendance({ studentId, date: day, status }).save();
        res.status(201).json({ success: true, message: 'Attendance marked' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// ---- TIMETABLE ----
router.post('/timetable', auth, async (req, res) => {
    try {
        // upsert by class+section
        const tt = await Timetable.findOneAndUpdate(
            { class: req.body.class, section: req.body.section || '' },
            req.body,
            { new: true, upsert: true }
        );
        res.json({ success: true, message: 'Timetable saved', timetable: tt });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// ---- FEES ----
router.post('/fees', auth, async (req, res) => {
    try {
        const fee = new Fee(req.body);
        await fee.save();
        res.status(201).json({ success: true, message: 'Fee record added' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.put('/fees/:id', auth, async (req, res) => {
    const fee = await Fee.findByIdAndUpdate(req.params.id, 
        { status: req.body.status, paidDate: req.body.status === 'Paid' ? new Date() : null }, 
        { new: true });
    res.json({ success: true, fee });
});

// ---- STUDENT DOCUMENTS ----
router.post('/documents', auth, uploadDoc.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file' });
        const doc = new StudentDoc({
            studentId: req.body.studentId,
            title: req.body.title,
            fileUrl: req.file.path,
            cloudinaryId: req.file.filename
        });
        await doc.save();
        res.status(201).json({ success: true, message: 'Document uploaded' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Get students by class (with optional section)
router.get('/students/class/:class', auth, async (req, res) => {
    try {
        const query = { class: req.params.class };
        if (req.query.section) query.section = req.query.section;
        const students = await Student.find(query).select('-password').sort({ rollNumber: 1 });
        res.json({ success: true, students });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get unique class list
router.get('/classes', auth, async (req, res) => {
    try {
        const classes = await Student.distinct('class');
        res.json({ success: true, classes: classes.sort() });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/attendance/bulk', auth, async (req, res) => {
    try {
        const { date, records } = req.body;
        const day = new Date(date);
        day.setHours(0,0,0,0);
        const nextDay = new Date(day);
        nextDay.setDate(day.getDate() + 1);

        let updated = 0, created = 0;
        for (const r of records) {
            const existing = await Attendance.findOne({
                studentId: r.studentId,
                date: { $gte: day, $lt: nextDay }
            });
            if (existing) {
                existing.status = r.status;
                await existing.save();
                updated++;
            } else {
                await new Attendance({ studentId: r.studentId, date: day, status: r.status }).save();
                created++;
            }
        }
        res.json({ success: true, message: `Marked: ${created} new, ${updated} updated` });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});


// Get existing attendance for class + date
router.get('/attendance/check', auth, async (req, res) => {
    try {
        const { class: cls, date } = req.query;
        const day = new Date(date);
        day.setHours(0,0,0,0);
        const nextDay = new Date(day);
        nextDay.setDate(day.getDate() + 1);

        const students = await Student.find({ class: cls }).select('_id');
        const ids = students.map(s => s._id);
        const records = await Attendance.find({
            studentId: { $in: ids },
            date: { $gte: day, $lt: nextDay }
        });
        const map = {};
        records.forEach(r => map[r.studentId] = r.status);
        res.json({ success: true, existing: map });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});



// Delete result
router.delete('/results/:id', auth, async (req, res) => {
    try {
        await Result.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Result deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete fee
router.delete('/fees/:id', auth, async (req, res) => {
    try {
        await Fee.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Fee deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete student document
router.delete('/documents/:id', auth, async (req, res) => {
    try {
        const doc = await StudentDoc.findById(req.params.id);
        if (doc && doc.cloudinaryId) {
            await cloudinary.uploader.destroy(doc.cloudinaryId, { resource_type: 'raw' });
        }
        await StudentDoc.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get student's results/fees/docs (for admin to view & delete)
router.get('/student-data/:id', auth, async (req, res) => {
    try {
        const results = await Result.find({ studentId: req.params.id }).sort({ createdAt: -1 });
        const fees = await Fee.find({ studentId: req.params.id }).sort({ createdAt: -1 });
        const documents = await StudentDoc.find({ studentId: req.params.id }).sort({ createdAt: -1 });
        res.json({ success: true, results, fees, documents });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;