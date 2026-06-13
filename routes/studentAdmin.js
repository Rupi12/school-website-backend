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
const { generateReceipt } = require('../utils/receiptGenerator');
const { generateNOC } = require('../utils/nocGenerator');
const studentAuth = require('../middleware/studentAuth');

// ---- SPECIFIC ROUTES FIRST (before :id routes) ----

// Build NOC data only if ALL fees are cleared; returns null if dues pending
async function buildNocData(studentId) {
  const fees = await Fee.find({ studentId });
  if (!fees.length) return null;

  let grandTotal = 0;
  let pending = 0;
  const items = [];

  for (const f of fees) {
    const paid = f.payments.reduce((s, p) => s + (p.amount || 0), 0);
    pending += (f.amount - paid);
    grandTotal += paid;
    items.push({ category: f.category, amount: f.amount, paid });
  }

  if (pending > 0) return null; // not eligible — dues pending

  const student = await Student.findById(studentId).lean();
  if (!student) return null;

  return {
    nocNo: `NOC-${student.rollNumber}-${new Date().getFullYear()}`,
    studentName: student.name,
    rollNumber: student.rollNumber,
    class: student.class,
    section: student.section,
    academicYear: fees[0].academicYear,
    items,
    grandTotal,
  };
}

// Admin: download NOC for a student (only if all dues cleared)
router.get('/noc/:studentId', auth, async (req, res) => {
  if (!superCheck(req, res)) return;
  try {
    const data = await buildNocData(req.params.studentId);
    if (!data) return res.status(400).json({ error: 'Student has pending dues — NOC not available' });

    const pdf = await generateNOC(data);

    await logAction(req, {
      action: `Generated NOC ${data.nocNo}`,
      category: 'FEE',
      targetName: data.studentName,
      targetId: req.params.studentId,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="NOC_${data.rollNumber}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student/parent: download own NOC (IDOR-safe — ID from JWT)
router.get('/my-noc', studentAuth , async (req, res) => {
  try {
   
    const data = await buildNocData(req.student.id);
    if (!data) return res.status(400).json({ error: 'NOC not available — fees pending' });

    const pdf = await generateNOC(data);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="NOC_${data.rollNumber}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Download a receipt PDF for a specific payment (admin)
router.get('/receipt/:receiptNo', auth, requirePermission('students.manage'), async (req, res) => {
  try {
    const fee = await Fee.findOne({ 'payments.receiptNo': req.params.receiptNo });
    if (!fee) return res.status(404).json({ error: 'Receipt not found' });

    const payment = fee.payments.find(p => p.receiptNo === req.params.receiptNo);
    const student = await Student.findById(fee.studentId).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const paidTillDate = fee.payments.reduce((s, p) => s + (p.amount || 0), 0);

    const pdf = await generateReceipt({
      receiptNo: payment.receiptNo,
      studentName: student.name,
      rollNumber: student.rollNumber,
      class: student.class,
      section: student.section,
      category: fee.category,
      academicYear: fee.academicYear,
      amount: payment.amount,
      mode: payment.mode,
      date: payment.date,
      collectedBy: payment.collectedBy,
      totalFee: fee.amount,
      paidTillDate,
      balance: (fee.amount || 0) - paidTillDate,
    });

    await logAction(req, {
      action: `Downloaded receipt ${payment.receiptNo}`,
      category: 'FEE', targetName: student.name, targetId: student._id,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Receipt_${payment.receiptNo}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// PUBLIC verification endpoint (no auth) — used by QR scan
router.get('/verify-receipt/:receiptNo', async (req, res) => {
  try {
    const fee = await Fee.findOne({ 'payments.receiptNo': req.params.receiptNo }).lean();
    if (!fee) return res.json({ valid: false });

    const payment = fee.payments.find(p => p.receiptNo === req.params.receiptNo);
    const student = await Student.findById(fee.studentId).select('name class section').lean();

    res.json({
      valid: true,
      receiptNo: payment.receiptNo,
      studentName: student?.name,
      class: `${student?.class} - ${student?.section || '-'}`,
      category: fee.category,
      academicYear: fee.academicYear,
      amount: payment.amount,
      date: payment.date,
    });
  } catch (err) {
    res.json({ valid: false });
  }
});


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
router.get('/attendance/check', auth, requirePermission('students.manage'), async (req, res) => {
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
router.post('/attendance/bulk', auth, requirePermission('students.manage'), async (req, res) => {
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
            { returnDocument: 'after' }
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
            { returnDocument: 'after' }
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
router.post('/timetable', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const tt = await Timetable.findOneAndUpdate(
            { class: req.body.class, section: req.body.section || '' },
            req.body,
            { returnDocument: 'after', upsert: true }
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
            { academicYear, feeType, amount, category, dueDate }, { returnDocument: 'after' });
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


// ============ FINANCE / DCR (Superadmin only) ============
function superCheck(req, res) {
    if (req.admin.role !== 'superadmin') {
        res.status(403).json({ success: false, message: 'Superadmin only' });
        return false;
    }
    return true;
}

// 1. COLLECTION REPORT — payments within a date range
router.get('/collection-report', auth, async (req, res) => {
    if (!superCheck(req, res)) return;
    try {
        const from = new Date(req.query.from);
        from.setHours(0, 0, 0, 0);
        const to = new Date(req.query.to);
        to.setHours(23, 59, 59, 999);

        const data = await Fee.aggregate([
            { $unwind: '$payments' },
            { $match: { 'payments.date': { $gte: from, $lte: to } } },
            { $lookup: { from: 'students', localField: 'studentId', foreignField: '_id', as: 'stu' } },
            { $unwind: { path: '$stu', preserveNullAndEmptyArrays: true } },
            { $project: {
                amount: '$payments.amount',
                mode: '$payments.mode',
                receiptNo: '$payments.receiptNo',
                collectedBy: '$payments.collectedBy',
                date: '$payments.date',
                category: '$category',
                feeType: '$feeType',
                studentName: '$stu.name',
                rollNumber: '$stu.rollNumber',
                class: '$stu.class'
            } },
            { $sort: { date: -1 } }
        ]);

        const total = data.reduce((s, p) => s + p.amount, 0);
        const byMode = {}, byCategory = {}, byStaff = {};
        data.forEach(p => {
            byMode[p.mode] = (byMode[p.mode] || 0) + p.amount;
            byCategory[p.category] = (byCategory[p.category] || 0) + p.amount;
            byStaff[p.collectedBy] = (byStaff[p.collectedBy] || 0) + p.amount;
        });

        res.json({ success: true, total, count: data.length, byMode, byCategory, byStaff, payments: data });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});




// 2. PENDING SUMMARY — overall + per class
router.get('/pending-summary', auth, async (req, res) => {
    if (!superCheck(req, res)) return;
    try {
        const result = await Fee.aggregate([
            { $addFields: { paid: { $sum: '$payments.amount' } } },
            { $addFields: { pending: { $subtract: ['$amount', '$paid'] } } },
            { $match: { pending: { $gt: 0 } } },
            { $lookup: { from: 'students', localField: 'studentId', foreignField: '_id', as: 'stu' } },
            { $unwind: { path: '$stu', preserveNullAndEmptyArrays: true } },
            { $group: { _id: '$stu.class', classPending: { $sum: '$pending' } } },
            { $sort: { classPending: -1 } }
        ]);
        const totalPending = result.reduce((s, r) => s + r.classPending, 0);
        const byClass = result.map(r => ({ class: r._id || 'Unknown', pending: r.classPending }));

        // YEAR-WISE breakdown
        const yearAgg = await Fee.aggregate([
            { $addFields: { paid: { $sum: '$payments.amount' } } },
            { $addFields: { pending: { $subtract: ['$amount', '$paid'] } } },
            { $match: { pending: { $gt: 0 } } },
            { $group: { _id: '$academicYear', pending: { $sum: '$pending' } } }
        ]);
        // build current + last FY labels
        const now = new Date();
        const y = now.getFullYear();
        // academic year starts ~April in India; if before April, current FY is (y-1)-(y)
        const startYear = now.getMonth() >= 3 ? y : y - 1;
        const currentFY = `${startYear}-${String(startYear + 1).slice(2)}`;
        const lastFY = `${startYear - 1}-${String(startYear).slice(2)}`;

        let current = 0, last = 0, older = 0;
        yearAgg.forEach(r => {
            if (r._id === currentFY) current += r.pending;
            else if (r._id === lastFY) last += r.pending;
            else older += r.pending; // includes "Previous Years" + any older strings
        });

        res.json({
            success: true,
            totalPending,
            byClass,
            byYear: { currentFY, current, lastFY, last, older }
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 3. DEFAULTERS — students with dues, sorted desc, optional class filter
router.get('/defaulters', auth, async (req, res) => {
    if (!superCheck(req, res)) return;
    try {
        const pipeline = [
            { $addFields: { paid: { $sum: '$payments.amount' } } },
            { $addFields: { pending: { $subtract: ['$amount', '$paid'] } } },
            { $match: { pending: { $gt: 0 } } },
            { $group: { _id: '$studentId', totalPending: { $sum: '$pending' } } },
            { $lookup: { from: 'students', localField: '_id', foreignField: '_id', as: 'stu' } },
            { $unwind: '$stu' }
        ];
        if (req.query.class) pipeline.push({ $match: { 'stu.class': req.query.class } });
        pipeline.push(
            { $project: {
                name: '$stu.name', rollNumber: '$stu.rollNumber',
                class: '$stu.class', section: '$stu.section',
                phone: '$stu.phone', parentName: '$stu.parentName',
                totalPending: 1
            } },
            { $sort: { totalPending: -1 } }
        );

        const defaulters = await Fee.aggregate(pipeline);
        res.json({ success: true, defaulters });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// 4. TODAY'S COLLECTION — for dashboard widget
router.get('/today-collection', auth, async (req, res) => {
    if (!superCheck(req, res)) return;
    try {
        const start = new Date(); start.setHours(0, 0, 0, 0);
        const end = new Date(); end.setHours(23, 59, 59, 999);
        const data = await Fee.aggregate([
            { $unwind: '$payments' },
            { $match: { 'payments.date': { $gte: start, $lte: end } } },
            { $group: { _id: null, total: { $sum: '$payments.amount' }, count: { $sum: 1 } } }
        ]);
        res.json({ success: true, total: data[0]?.total || 0, count: data[0]?.count || 0 });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


// Bulk promote selected students to a new class
router.post('/students/bulk-promote', auth, requirePermission('students.manage'), async (req, res) => {
    try {
        const { studentIds, newClass } = req.body;
        if (!studentIds || studentIds.length === 0 || !newClass) {
            return res.status(400).json({ success: false, message: 'Select students and target class' });
        }

        await Student.updateMany(
            { _id: { $in: studentIds } },
            { $set: { class: String(newClass), section: '' } }   // section cleared
        );

        // 🔍 AUDIT
        await logAction(req, {
            action: `Promoted ${studentIds.length} students → Class ${newClass}`,
            category: 'STUDENT'
        });

        res.json({ success: true, message: `${studentIds.length} students promoted to Class ${newClass}` });
    } catch (e) {
        res.status(400).json({ success: false, message: e.message });
    }
});

module.exports = router;