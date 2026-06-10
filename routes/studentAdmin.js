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
const requirePermission = require('../middleware/permission');
const { logAction } = require('../utils/auditLogger');   // 🔍 AUDIT

// ---- SPECIFIC ROUTES FIRST (before :id routes) ----

// Get students by class
router.get('/students/class/:class', auth, requirePermission('students.manage'), async (req, res) => {
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
router.get('/classes', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const classes = await Student.distinct('class');
        res.json({ success: true, classes: classes.sort() });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get existing attendance for class + date
router.get('/attendance/check', auth, requirePermission('students.bulk'), async (req, res) => {
    try {
        const { class: cls, date } = req.query;
        const day = new Date(date);
        day.setHours(0,0,0,0);
        const nextDay = new Date(day);
        nextDay.setDate(day.getDate() + 1);
        const students = await Student.find({ class: cls }).select('_id');
        const ids = students.map(s => s._id);
        const records = await Attendance.find({ studentId: { $in: ids }, date: { $gte: day, $lt: nextDay } });
        const map = {};
        records.forEach(r => map[r.studentId] = r.status);
        res.json({ success: true, existing: map });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get student's results/fees/docs
router.get('/student-data/:id', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const results = await Result.find({ studentId: req.params.id }).sort({ createdAt: -1 });
        const fees = await Fee.find({ studentId: req.params.id }).sort({ createdAt: -1 });
        const documents = await StudentDoc.find({ studentId: req.params.id }).sort({ createdAt: -1 });
        res.json({ success: true, results, fees, documents });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Bulk attendance
router.post('/attendance/bulk', auth, requirePermission('students.bulk'), async (req, res) => {
    try {
        const { date, records } = req.body;
        const day = new Date(date);
        day.setHours(0,0,0,0);
        const nextDay = new Date(day);
        nextDay.setDate(day.getDate() + 1);
        let updated = 0, created = 0;
        for (const r of records) {
            const existing = await Attendance.findOne({ studentId: r.studentId, date: { $gte: day, $lt: nextDay } });
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

// Bulk assign DUES to a class (legacy — no academicYear)
router.post('/fees/bulk', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const { class: cls, section, academicYear, category, feeType, amount, dueDate } = req.body;
        if (!cls || !feeType || !amount) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        const query = { class: cls };
        if (section) query.section = section;
        const students = await Student.find(query).select('_id');
        if (students.length === 0) {
            return res.status(400).json({ success: false, message: 'No students in this class' });
        }
        const fees = students.map(s => ({
            studentId: s._id,
            academicYear: academicYear || '',
            category: category || 'Other',
            feeType,
            amount: Number(amount),
            dueDate: dueDate || null,
            status: 'Pending'
        }));
        await Fee.insertMany(fees);

        // 🔍 AUDIT
        await logAction(req, {
            action: `Bulk assigned "${feeType}" ₹${amount} to Class ${cls} (${students.length} students)`,
            category: 'FEE'
        });

        res.status(201).json({ success: true, message: `Dues assigned to ${students.length} students` });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// ---- STUDENTS ----
router.get('/students', auth, requirePermission('students.list'), async (req, res) => {
    const students = await Student.find().select('-password').sort({ createdAt: -1 });
    res.json({ success: true, students });
});

router.post('/students', auth, requirePermission('students.manage'), async (req, res) => {
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

router.put('/students/:id', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const { name, rollNumber, class: cls, section, parentName, phone } = req.body;
        const student = await Student.findByIdAndUpdate(
            req.params.id,
            { name, rollNumber, class: cls, section, parentName, phone },
            { new: true }
        ).select('-password');
        res.json({ success: true, message: 'Student updated', student });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.delete('/students/:id', auth, requirePermission('students.list'), async (req, res) => {
    const stu = await Student.findById(req.params.id).select('name rollNumber');
    await Student.findByIdAndDelete(req.params.id);
    await Result.deleteMany({ studentId: req.params.id });
    await Attendance.deleteMany({ studentId: req.params.id });
    await Fee.deleteMany({ studentId: req.params.id });
    await StudentDoc.deleteMany({ studentId: req.params.id });

    // 🔍 AUDIT
    await logAction(req, {
        action: `Deleted student & all data`,
        category: 'STUDENT',
        targetName: stu ? `${stu.name} (${stu.rollNumber})` : '',
        targetId: req.params.id
    });

    res.json({ success: true, message: 'Student deleted' });
});

// ---- RESULTS ----
router.post('/results', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const { studentId, examName, term, academicYear, examDate, subjects, remark } = req.body;
        if (!studentId || !examName || !academicYear) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        if (!subjects || subjects.length === 0) {
            return res.status(400).json({ success: false, message: 'Add at least one subject' });
        }
        for (const s of subjects) {
            if (s.marksObtained > s.totalMarks) {
                return res.status(400).json({ success: false, message: `${s.subject}: marks exceed total` });
            }
        }
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

router.get('/results/:id', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const result = await Result.findById(req.params.id);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.put('/results/:id', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const { examName, term, academicYear, examDate, subjects, remark } = req.body;
        const result = await Result.findByIdAndUpdate(
            req.params.id,
            { examName, term, academicYear, examDate, subjects, remark },
            { new: true }
        );
        res.json({ success: true, result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.delete('/results/:id', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        await Result.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Result deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ---- ATTENDANCE ----
router.post('/attendance', auth, requirePermission('students.bulk'), async (req, res) => {
    try {
        const { studentId, date, status } = req.body;
        const day = new Date(date);
        day.setHours(0,0,0,0);
        const nextDay = new Date(day);
        nextDay.setDate(day.getDate() + 1);
        const existing = await Attendance.findOne({ studentId, date: { $gte: day, $lt: nextDay } });
        if (existing) {
            existing.status = status;
            await existing.save();
            return res.json({ success: true, message: 'Attendance updated' });
        }
        await new Attendance({ studentId, date: day, status }).save();
        res.status(201).json({ success: true, message: 'Attendance marked' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// ---- TIMETABLE ----
router.post('/timetable', auth, requirePermission('students.timetable'), async (req, res) => {
    try {
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

// Add single fee (due)
router.post('/fees', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const { studentId, academicYear, category, feeType, amount, dueDate } = req.body;
        if (!studentId || !academicYear || !feeType || !amount) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        const fee = new Fee({ studentId, academicYear, category, feeType, amount, dueDate });
        await fee.save();
        res.status(201).json({ success: true, message: 'Fee due added' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Edit fee details
router.patch('/fees/:id', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const { academicYear, feeType, amount, category, dueDate } = req.body;
        const fee = await Fee.findByIdAndUpdate(req.params.id,
            { academicYear, feeType, amount, category, dueDate }, { new: true });
        if (fee) {
            const totalPaid = fee.payments.reduce((s, p) => s + p.amount, 0);
            fee.status = totalPaid >= fee.amount ? 'Paid' : (totalPaid > 0 ? 'Partial' : 'Pending');
            await fee.save();

            // 🔍 AUDIT
            await logAction(req, {
                action: `Edited fee "${feeType}" → ₹${amount}`,
                category: 'FEE',
                targetId: fee.studentId.toString()
            });
        }
        res.json({ success: true, fee });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Record payment (installment)
router.post('/fees/:id/pay', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const { amount, mode, receiptNo, remarks, date, collectedBy } = req.body;
        const fee = await Fee.findById(req.params.id);
        if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });

        fee.payments.push({
            amount: Number(amount), mode, receiptNo,
            collectedBy: collectedBy || req.admin.username,
            remarks: remarks || '',
            date: date ? new Date(date) : new Date()
        });

        const totalPaid = fee.payments.reduce((s, p) => s + p.amount, 0);
        fee.status = totalPaid >= fee.amount ? 'Paid' : 'Partial';
        await fee.save();

        // 🔍 AUDIT
        const stu = await Student.findById(fee.studentId).select('name rollNumber');
        await logAction(req, {
            action: `Recorded payment ₹${amount} (${mode}, Receipt #${receiptNo})`,
            category: 'FEE',
            targetName: stu ? `${stu.name} (${stu.rollNumber})` : '',
            targetId: fee.studentId.toString()
        });

        res.json({ success: true, fee });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Delete a specific payment
router.delete('/fees/:feeId/pay/:paymentId', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const fee = await Fee.findById(req.params.feeId);
        if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });
        fee.payments = fee.payments.filter(p => p._id.toString() !== req.params.paymentId);
        const totalPaid = fee.payments.reduce((s, p) => s + p.amount, 0);
        fee.status = totalPaid >= fee.amount ? 'Paid' : (totalPaid > 0 ? 'Partial' : 'Pending');
        await fee.save();

        // 🔍 AUDIT
        const stu = await Student.findById(fee.studentId).select('name rollNumber');
        await logAction(req, {
            action: `Deleted a payment (Fee: ${fee.feeType})`,
            category: 'FEE',
            targetName: stu ? `${stu.name} (${stu.rollNumber})` : '',
            targetId: fee.studentId.toString()
        });

        res.json({ success: true, message: 'Payment deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete entire fee
router.delete('/fees/:id', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const fee = await Fee.findById(req.params.id);
        await Fee.findByIdAndDelete(req.params.id);

        // 🔍 AUDIT
        if (fee) {
            await logAction(req, {
                action: `Deleted fee "${fee.feeType}" (₹${fee.amount})`,
                category: 'FEE',
                targetId: fee.studentId.toString()
            });
        }

        res.json({ success: true, message: 'Fee deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Bulk assign dues to SELECTED students
router.post('/fees/bulk-selected', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const { studentIds, academicYear, category, feeType, amount, dueDate } = req.body;
        if (!studentIds || studentIds.length === 0 || !feeType || !amount || !academicYear) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        const fees = studentIds.map(id => ({
            studentId: id,
            academicYear,
            category: category || 'Other',
            feeType,
            amount: Number(amount),
            dueDate: dueDate || null,
            status: 'Pending'
        }));
        await Fee.insertMany(fees);

        // 🔍 AUDIT
        await logAction(req, {
            action: `Bulk assigned "${feeType}" ₹${amount} to ${studentIds.length} students`,
            category: 'FEE'
        });

        res.status(201).json({ success: true, message: `Dues assigned to ${studentIds.length} students` });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// ---- STUDENT DOCUMENTS ----
router.post('/documents', auth, requirePermission('students.manage'), uploadDoc.single('file'), async (req, res) => {
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

router.get('/documents/:id', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const doc = await StudentDoc.findById(req.params.id);
        res.json({ success: true, document: doc });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.put('/documents/:id', auth, requirePermission('students.manage'), uploadDoc.single('file'), async (req, res) => {
    try {
        const doc = await StudentDoc.findById(req.params.id);
        if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
        doc.title = req.body.title || doc.title;
        if (req.file) {
            if (doc.cloudinaryId) {
                await cloudinary.uploader.destroy(doc.cloudinaryId, { resource_type: 'raw' });
            }
            doc.fileUrl = req.file.path;
            doc.cloudinaryId = req.file.filename;
        }
        await doc.save();
        res.json({ success: true, document: doc });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.delete('/documents/:id', auth, requirePermission('students.manage'), async (req, res) => {
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

module.exports = router;