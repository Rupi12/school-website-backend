const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Student = require('../models/Student');
const Result = require('../models/Result');
const Attendance = require('../models/Attendance');
const Timetable = require('../models/Timetable');
const Fee = require('../models/Fee');
const StudentDoc = require('../models/StudentDoc');
const Admin = require('../models/Admin');
const Payroll = require('../models/Payroll');
const StaffAttendance = require('../models/StaffAttendance');
const auth = require('../middleware/auth');
const { uploadDoc } = require('../config/cloudinary');
const { cloudinary } = require('../config/cloudinary');
const requirePermission = require('../middleware/permission');
const { logAction } = require('../utils/auditLogger');   // 🔍 AUDIT
const { generateReceipt } = require('../utils/receiptGenerator');
const { generateNOC } = require('../utils/nocGenerator');
const { generateSalarySlip } = require('../utils/salarySlipGenerator');
const { generateReportCard } = require('../utils/reportCardGenerator');
const studentAuth = require('../middleware/studentAuth');


// Helper middleware to allow access if user has ANY student-related permission
function anyStudentPerm(req, res, next) {
    if (req.admin.role === 'superadmin') return next();
    const p = req.admin.permissions || [];
    const valid = ['students.view', 'students.add', 'students.edit', 'students.delete', 'students.export', 'results.manage', 'fees.manage', 'attendance.manage', 'timetable.manage', 'studentdocs.manage', 'students.view.details'];
    if (valid.some(v => p.includes(v))) return next();
    return res.status(403).json({ success: false, message: 'Permission denied' });
}

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
    const netAmount = f.amount - (f.discount || 0);
    pending += (netAmount - paid);
    grandTotal += paid;
    items.push({ category: f.category, amount: f.amount, discount: f.discount || 0, netAmount, paid });
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
router.get('/noc/:studentId', auth, requirePermission('fees.manage'), async (req, res) => {
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
router.get('/receipt', auth, requirePermission('fees.manage'), async (req, res) => {
  try {
    const { receiptNo } = req.query;
    const fee = await Fee.findOne({ 'payments.receiptNo': receiptNo });
    if (!fee) return res.status(404).json({ error: 'Receipt not found' });

    const payment = fee.payments.find(p => String(p.receiptNo) === String(receiptNo));
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    const student = await Student.findById(fee.studentId).lean();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Calculate accurately up to THIS specific payment, not future ones
    let paidTillDate = 0;
    for (const p of fee.payments) {
      paidTillDate += (p.amount || 0);
      if (String(p.receiptNo) === String(receiptNo)) break;
    }

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
      discount: fee.discount || 0,
      discountReason: fee.discountReason || '',
      paidTillDate,
      balance: ((fee.amount || 0) - (fee.discount || 0)) - paidTillDate,
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

    const payment = fee.payments.find(p => String(p.receiptNo) === String(req.params.receiptNo));
    const student = await Student.findById(fee.studentId).select('name class section').lean();

    res.json({
      valid: true,
      receiptNo: payment.receiptNo,
      studentName: student?.name,
      class: `${student?.class} - ${student?.section || '-'}`,
      category: fee.category,
      academicYear: fee.academicYear,
      amount: payment.amount,
      discount: fee.discount || 0,
      date: payment.date,
    });
  } catch (err) {
    res.json({ valid: false });
  }
});


/// Get students by class
router.get('/students/class/:class', auth, anyStudentPerm, async (req, res) => {
    try {
        const query = { class: req.params.class };
        if (req.query.section) query.section = req.query.section;
        const students = await Student.find(query).select('-password').collation({ locale: "en_US", numericOrdering: true }).sort({ rollNumber: 1 });
        res.json({ success: true, students });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get unique class list
router.get('/classes', auth, anyStudentPerm, async (req, res) => {
    try {
        const classes = await Student.distinct('class');
        res.json({ success: true, classes: classes.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get existing attendance for class + date
router.get('/attendance/check', auth, requirePermission('attendance.manage'), async (req, res) => {
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
        records.forEach(r => map[r.studentId] = { status: r.status, remarks: r.remarks });
        res.json({ success: true, existing: map });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get student's results/fees/docs
router.get('/student-data/:id([0-9a-fA-F]{24})', auth, anyStudentPerm, async (req, res) => {
    try {
        const student = await Student.findById(req.params.id).select('-password').lean();
        if (!student) return res.status(404).json({ success: false, message: 'Student not found' });

        const results = await Result.find({ studentId: req.params.id }).sort({ createdAt: -1 });
        const fees = await Fee.find({ studentId: req.params.id }).sort({ createdAt: -1 });
        const documents = await StudentDoc.find({ studentId: req.params.id }).sort({ createdAt: -1 });
        res.json({ success: true, student, results, fees, documents });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Bulk attendance
router.post('/attendance/bulk', auth, requirePermission('attendance.manage'), async (req, res) => {
    try {
        const { date, records } = req.body;
        const day = new Date(date);
        day.setHours(0,0,0,0);
        const nextDay = new Date(day);
        nextDay.setDate(day.getDate() + 1);
        let updated = 0, created = 0, skipped = 0;
        
        const isSuperadmin = req.admin.role === 'superadmin';

        for (const r of records) {
            const existing = await Attendance.findOne({ studentId: r.studentId, date: { $gte: day, $lt: nextDay } });
            if (existing) {
                if (!isSuperadmin) {
                    skipped++;
                    continue; // Skip updating if not superadmin
                }
                existing.status = r.status;
                existing.remarks = r.remarks || '';
                await existing.save();
                updated++;
            } else {
                await new Attendance({ studentId: r.studentId, date: day, status: r.status, remarks: r.remarks || '', markedBy: req.admin.username }).save();
                created++;
            }
        }
        
        let msg = `Marked: ${created} new.`;
        if (updated > 0) msg += ` ${updated} updated.`;
        if (skipped > 0) msg += ` ${skipped} skipped (already marked).`;
        
        res.json({ success: true, message: msg });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Bulk assign DUES to a class (legacy — no academicYear)
router.post('/fees/bulk', auth, requirePermission('fees.manage'), async (req, res) => {
    try {
        const { class: cls, section, academicYear, category, feeType, amount, discount, discountReason, dueDate } = req.body;
        if (!cls || !feeType || !amount) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const validAmt = Number(amount);
        const validDisc = Number(discount) || 0;
        if (isNaN(validAmt) || validAmt <= 0 || validDisc < 0 || validDisc > validAmt) {
            return res.status(400).json({ success: false, message: 'Invalid fee amount or discount. Discount cannot exceed total amount.' });
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
            amount: validAmt,
            discount: validDisc,
            discountReason: discountReason || '',
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
router.get('/students', auth, anyStudentPerm, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const classFilter = req.query.class || '';

        const query = {};
        if (classFilter) query.class = classFilter;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { rollNumber: { $regex: search, $options: 'i' } }
            ];
        }

        const total = await Student.countDocuments(query);
        const students = await Student.find(query)
            .select('-password')
            .collation({ locale: "en_US", numericOrdering: true })
            .sort({ class: 1, rollNumber: 1 })
            .skip((page - 1) * limit)
            .limit(limit);

        res.json({ success: true, students, total, page, pages: Math.ceil(total / limit) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.get('/students-export', auth, requirePermission('students.export'), async (req, res) => {
    try {
        const students = await Student.find().select('-password').sort({ class: 1, rollNumber: 1 });
        res.json({ success: true, students });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.post('/students', auth, requirePermission('students.add'), async (req, res) => {
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

router.put('/students/:id([0-9a-fA-F]{24})', auth, requirePermission('students.edit'), async (req, res) => {
    try {
        const { name, rollNumber, class: cls, section, parentName, phone } = req.body;
        
        const existing = await Student.findOne({ rollNumber, _id: { $ne: req.params.id } });
        if (existing) {
            return res.status(400).json({ success: false, message: `Roll number ${rollNumber} is already assigned to another student!` });
        }

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

router.put('/students/:id([0-9a-fA-F]{24})/reset-password', auth, requirePermission('students.edit'), async (req, res) => {
    try {
        const { password } = req.body;
        if (!password || password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const updatedStudent = await Student.findByIdAndUpdate(
            req.params.id,
            { password: hashedPassword }
        );

        if (!updatedStudent) return res.status(404).json({ success: false, message: 'Student not found' });

        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error resetting password' });
    }
});

router.delete('/students/:id([0-9a-fA-F]{24})', auth, requirePermission('students.delete'), async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const stu = await Student.findById(req.params.id).session(session).select('name rollNumber');
        if (!stu) throw new Error('Student not found');
        
        await Student.findByIdAndDelete(req.params.id).session(session);
        await Result.deleteMany({ studentId: req.params.id }).session(session);
        await Attendance.deleteMany({ studentId: req.params.id }).session(session);
        await Fee.deleteMany({ studentId: req.params.id }).session(session);
        
        const docs = await StudentDoc.find({ studentId: req.params.id }).session(session);
        await StudentDoc.deleteMany({ studentId: req.params.id }).session(session);

        await session.commitTransaction();
        session.endSession();

        // Safely remove files from Cloudinary outside the transaction to prevent storage leaks
        for (const doc of docs) {
            if (doc.cloudinaryId) {
                const otherUsage = await StudentDoc.exists({ cloudinaryId: doc.cloudinaryId });
                if (!otherUsage) {
                    await cloudinary.uploader.destroy(doc.cloudinaryId, { resource_type: 'raw' });
                }
            }
        }

        await logAction(req, { action: `Deleted student & all data`, category: 'STUDENT', targetName: `${stu.name} (${stu.rollNumber})`, targetId: req.params.id });
        res.json({ success: true, message: 'Student deleted' });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ success: false, message: error.message });
    }
});

// Bulk delete selected students (Superadmin Only)
router.post('/students/bulk-delete', auth, async (req, res) => {
    try {
        if (req.admin.role !== 'superadmin') {
            return res.status(403).json({ success: false, message: 'Superadmin permission required' });
        }
        
        const { studentIds, password } = req.body;
        if (!studentIds || !studentIds.length || !password) {
            return res.status(400).json({ success: false, message: 'Missing students or password' });
        }

        const admin = await Admin.findById(req.admin.id);
        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Incorrect superadmin password' });
        }

        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const docs = await StudentDoc.find({ studentId: { $in: studentIds } }).session(session);

            await Result.deleteMany({ studentId: { $in: studentIds } }).session(session);
            await Attendance.deleteMany({ studentId: { $in: studentIds } }).session(session);
            await Fee.deleteMany({ studentId: { $in: studentIds } }).session(session);
            await StudentDoc.deleteMany({ studentId: { $in: studentIds } }).session(session);
            await Student.deleteMany({ _id: { $in: studentIds } }).session(session);

            await session.commitTransaction();
            session.endSession();

            // Clean up cloudinary
            for (const doc of docs) {
                if (doc.cloudinaryId) {
                    const otherUsage = await StudentDoc.exists({ cloudinaryId: doc.cloudinaryId });
                    if (!otherUsage) {
                        await cloudinary.uploader.destroy(doc.cloudinaryId, { resource_type: 'raw' });
                    }
                }
            }

            await logAction(req, { action: `Bulk deleted ${studentIds.length} students & all related data`, category: 'STUDENT' });
            res.json({ success: true, message: `Successfully deleted ${studentIds.length} students.` });
        } catch (err) {
            await session.abortTransaction();
            session.endSession();
            throw err;
        }
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ---- STAFF ATTENDANCE REQUESTS ----
// Teacher submits their own attendance for approval (Available to all non-superadmin staff)
router.post('/staff-attendance/mark', auth, async (req, res) => {
    try {
        const { date, status, remarks, entryTime, exitTime } = req.body;
        if (!date || !status) return res.status(400).json({ success: false, message: 'Date and status are required.' });
        
        const startOfDay = new Date(date);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setUTCHours(23, 59, 59, 999);

        if (startOfDay.getUTCDay() === 0) {
            return res.status(400).json({ success: false, message: 'Cannot mark attendance for Sundays.' });
        }

        const existing = await StaffAttendance.findOne({
            adminId: req.admin.id,
            date: { $gte: startOfDay, $lte: endOfDay }
        });

        if (existing) {
            existing.status = status;
            existing.remarks = remarks || '';
            existing.entryTime = entryTime || '';
            existing.exitTime = exitTime || '';
            existing.approvalStatus = 'Pending';
            existing.markedBy = 'Self';
            await existing.save();
            return res.json({ success: true, message: 'Attendance updated and sent for approval.' });
        }

        const record = new StaffAttendance({
            adminId: req.admin.id,
            date: startOfDay,
            status,
            remarks: remarks || '',
            entryTime: entryTime || '',
            exitTime: exitTime || '',
            approvalStatus: 'Pending',
            markedBy: 'Self'
        });

        await record.save();
        await logAction(req, { action: `Submitted self attendance for ${date}`, category: 'ADMIN' });

        res.status(201).json({ success: true, message: 'Attendance submitted for approval.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Teacher views their own attendance
router.get('/staff-attendance/my', auth, async (req, res) => {
    try {
        const records = await StaffAttendance.find({ adminId: req.admin.id }).sort({ date: -1 });
        res.json({ success: true, records });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin: Get history for a specific staff
router.get('/staff-attendance/history/:adminId', auth, requirePermission('staff.attendance.approve'), async (req, res) => {
    try {
        const { year, month } = req.query;
        if (!year || !month) return res.status(400).json({ success: false, message: 'Year and month required' });
        
        const startDate = new Date(Date.UTC(year, month - 1, 1));
        const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
        
        const records = await StaffAttendance.find({
            adminId: req.params.adminId,
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: -1 });
        
        res.json({ success: true, records });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Superadmin views all pending attendance records
router.get('/staff-attendance/pending', auth, requirePermission('staff.attendance.approve'), async (req, res) => {
    try {
        const records = await StaffAttendance.find({ approvalStatus: 'Pending' }).sort({ date: 1 }).populate('adminId', 'username realName');
        const formatted = records.map(r => ({ _id: r._id, teacherName: r.adminId?.realName || r.adminId?.username || 'Unknown', date: r.date, status: r.status, remarks: r.remarks, entryTime: r.entryTime, exitTime: r.exitTime }));
        res.json({ success: true, pending: formatted });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Superadmin approves or rejects attendance
router.put('/staff-attendance/approve/:id', auth, requirePermission('staff.attendance.approve'), async (req, res) => {
    try {
        const { approvalStatus } = req.body;
        if (!['Approved', 'Rejected'].includes(approvalStatus)) return res.status(400).json({ success: false, message: 'Invalid status' });

        const record = await StaffAttendance.findByIdAndUpdate(
            req.params.id,
            { approvalStatus },
            { new: true }
        );

        if (!record) return res.status(404).json({ success: false, message: 'Record not found.' });
        
        await logAction(req, { action: `${approvalStatus} attendance for teacher ID ${record.adminId}`, category: 'ADMIN' });
        res.json({ success: true, message: `Attendance ${approvalStatus.toLowerCase()} successfully.` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ---- STAFF DAILY ATTENDANCE (PHASE 2) ----

// Admin: Get today's staff attendance list
router.get('/staff-attendance/today', auth, requirePermission('staff.attendance.approve'), async (req, res) => {
    try {
        const dateStr = req.query.date || new Date().toISOString().split('T')[0];
        const startOfDay = new Date(dateStr);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(dateStr);
        endOfDay.setUTCHours(23, 59, 59, 999);

        const allAdmins = await Admin.find({ role: { $ne: 'superadmin' } }).select('-password');
        const todayRecords = await StaffAttendance.find({ date: { $gte: startOfDay, $lte: endOfDay } });

        const map = {};
        todayRecords.forEach(r => map[r.adminId.toString()] = r);

        const staffList = allAdmins.map(a => ({
            adminId: a._id,
            username: a.username,
            realName: a.realName || '',
            employeeId: a.employeeId || '',
            status: map[a._id.toString()] ? map[a._id.toString()].status : 'Present',
            remarks: map[a._id.toString()] ? map[a._id.toString()].remarks : '',
            entryTime: map[a._id.toString()] ? map[a._id.toString()].entryTime : '',
            exitTime: map[a._id.toString()] ? map[a._id.toString()].exitTime : ''
        }));

        res.json({ success: true, staffList });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Admin: Bulk mark staff attendance
router.post('/staff-attendance/bulk', auth, requirePermission('staff.attendance.approve'), async (req, res) => {
    try {
        const { date, records } = req.body;
        const startOfDay = new Date(date);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setUTCHours(23, 59, 59, 999);

        for (const r of records) {
            const existing = await StaffAttendance.findOne({ adminId: r.adminId, date: { $gte: startOfDay, $lte: endOfDay } });
            if (existing) {
                existing.status = r.status;
                existing.remarks = r.remarks;
                if (r.entryTime) existing.entryTime = r.entryTime;
                if (r.exitTime) existing.exitTime = r.exitTime;
                existing.approvalStatus = 'Approved'; // Bulk overrides to Approved
                await existing.save();
            } else {
                await new StaffAttendance({
                    adminId: r.adminId, date: startOfDay,
                    status: r.status, remarks: r.remarks, 
                    entryTime: r.entryTime || '', exitTime: r.exitTime || '',
                    markedBy: req.admin.username,
                    approvalStatus: 'Approved'
                }).save();
            }
        }
        res.json({ success: true, message: 'Staff attendance saved successfully' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ---- PHASE 3: STAFF PAYROLL ----

// Admin: Get payroll list for a specific month
router.get('/payroll/list', auth, requirePermission('staff.payroll.manage'), async (req, res) => {
    try {
        const { month } = req.query; // YYYY-MM
        if (!month) return res.status(400).json({ success: false, message: 'Month required' });

        const staffList = await Admin.find({ role: { $ne: 'superadmin' } }).select('-password');
        const payrolls = await Payroll.find({ month });

        const data = staffList.map(staff => {
            const slip = payrolls.find(p => p.adminId.toString() === staff._id.toString());
            return {
                staffId: staff._id,
                name: staff.realName || staff.username,
                employeeId: staff.employeeId || '-',
                basicSalary: staff.basicSalary || 0,
                payroll: slip || null
            };
        });

        res.json({ success: true, data });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Admin: Generate/Save Payroll Slip
router.post('/payroll/generate', auth, requirePermission('staff.payroll.manage'), async (req, res) => {
    try {
        const { adminId, month, basicSalary, allowances, arrears, deductions, netSalary, status, remarks } = req.body;
        
        const slip = await Payroll.findOneAndUpdate(
            { adminId, month },
            { basicSalary, allowances, arrears, deductions, netSalary, status, remarks, generatedBy: req.admin.username },
            { new: true, upsert: true }
        );

        await logAction(req, { action: `Generated salary slip for ${month}`, category: 'ADMIN', targetId: adminId });
        res.json({ success: true, message: 'Salary slip saved successfully!', slip });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Teacher: Get my own salary slips
router.get('/payroll/my', auth, async (req, res) => {
    try {
        const slips = await Payroll.find({ adminId: req.admin.id }).sort({ month: -1 });
        res.json({ success: true, slips });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Shared: Download PDF (Admin OR the Teacher who owns it)
router.get('/payroll/:id/pdf', auth, async (req, res) => {
    try {
        const slip = await Payroll.findById(req.params.id).populate('adminId');
        if (!slip) return res.status(404).json({ error: 'Slip not found' });
        
        if (!slip.adminId) return res.status(404).json({ error: 'Staff member associated with this slip no longer exists.' });

        const perms = req.admin.permissions || [];
        
        // Safely extract and stringify both IDs to prevent MongoDB type mismatch errors
        const slipOwnerId = slip.adminId._id ? String(slip.adminId._id) : String(slip.adminId);
        const currentUserId = req.admin.id ? String(req.admin.id) : String(req.admin._id);

        if (req.admin.role !== 'superadmin' && slipOwnerId !== currentUserId && !perms.includes('staff.payroll.manage')) {
            return res.status(403).json({ error: 'Access denied. You can only download your own slips.' });
        }

        let joined = 'N/A';
        if (slip.adminId.joiningDate) {
            const d = new Date(slip.adminId.joiningDate);
            if (!isNaN(d.getTime())) joined = d.toLocaleDateString();
        }

        const data = { slipId: slip._id, month: slip.month, staffName: slip.adminId.realName || slip.adminId.username || 'Unknown', employeeId: slip.adminId.employeeId || 'N/A', role: slip.adminId.role || 'staff', joiningDate: joined, status: slip.status, basicSalary: slip.basicSalary, allowances: slip.allowances, arrears: slip.arrears, deductions: slip.deductions, netSalary: slip.netSalary };
        const pdf = await generateSalarySlip(data);
        res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="SalarySlip_${data.month}.pdf"`); res.send(pdf);
    } catch (e) { console.error('Salary slip error:', e); res.status(500).json({ error: e.message }); }
});

// ---- RESULTS ----

router.get('/results/:id([0-9a-fA-F]{24})/pdf', auth, requirePermission('results.manage'), async (req, res) => {
    try {
        const result = await Result.findById(req.params.id);
        if (!result) return res.status(404).json({ error: 'Result not found' });
        
        const student = await Student.findById(result.studentId);
        if (!student) return res.status(404).json({ error: 'Student not found' });
        
        const pdf = await generateReportCard({ student, result });
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="ReportCard_${student.rollNumber}.pdf"`);
        res.send(pdf);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Bulk assign results
router.post('/results/bulk', auth, requirePermission('results.manage'), async (req, res) => {
    try {
        const { examName, term, academicYear, examDate, records } = req.body;
        if (!examName || !academicYear || !records || records.length === 0) {
            return res.status(400).json({ success: false, message: 'Missing required fields or records' });
        }

        let count = 0;
        for (const rec of records) {
            if (!rec.subjects || rec.subjects.length === 0) continue;
            
            // Upsert prevents duplicates for the same exam
            await Result.findOneAndUpdate(
                { studentId: rec.studentId, examName, term, academicYear },
                { examDate, subjects: rec.subjects, remark: '' },
                { upsert: true, new: true }
            );
            count++;
        }

        await logAction(req, { action: `Bulk saved results for "${examName}" (${count} students)`, category: 'STUDENT' });
        res.json({ success: true, message: `Successfully saved results for ${count} students` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/results', auth, requirePermission('results.manage'), async (req, res) => {
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

router.get('/results/:id([0-9a-fA-F]{24})', auth, requirePermission('results.manage'), async (req, res) => {
    try {
        const result = await Result.findById(req.params.id);
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.put('/results/:id([0-9a-fA-F]{24})', auth, requirePermission('results.manage'), async (req, res) => {
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

router.delete('/results/:id([0-9a-fA-F]{24})', auth, requirePermission('results.manage'), async (req, res) => {
    try {
        await Result.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Result deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ---- ATTENDANCE ----
router.post('/attendance', auth, requirePermission('attendance.manage'), async (req, res) => {
    try {
        const { studentId, date, status, remarks } = req.body;
        const day = new Date(date);
        day.setHours(0,0,0,0);
        const nextDay = new Date(day);
        nextDay.setDate(day.getDate() + 1);
        const existing = await Attendance.findOne({ studentId, date: { $gte: day, $lt: nextDay } });
        if (existing) {
            if (req.admin.role !== 'superadmin') {
                return res.status(403).json({ success: false, message: 'Attendance already marked. Only Superadmin can edit.' });
            }
            existing.status = status;
            existing.remarks = remarks || '';
            await existing.save();
            return res.json({ success: true, message: 'Attendance updated' });
        }
        await new Attendance({ studentId, date: day, status, remarks: remarks || '', markedBy: req.admin.username }).save();
        res.status(201).json({ success: true, message: 'Attendance marked' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// ---- TIMETABLE ----
router.get('/timetable', auth, requirePermission('timetable.manage'), async (req, res) => {
    try {
        const tt = await Timetable.findOne({ class: req.query.class, section: req.query.section || '' });
        res.json({ success: true, timetable: tt });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.post('/timetable', auth, requirePermission('timetable.manage'), async (req, res) => {
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
router.post('/fees', auth, requirePermission('fees.manage'), async (req, res) => {
    try {
        const { studentId, academicYear, category, feeType, amount, discount, discountReason, dueDate } = req.body;
        if (!studentId || !academicYear || !feeType || !amount) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        
        const validAmt = Number(amount);
        const validDisc = Number(discount) || 0;
        if (isNaN(validAmt) || validAmt <= 0 || validDisc < 0 || validDisc > validAmt) {
            return res.status(400).json({ success: false, message: 'Invalid fee amount or discount. Discount cannot exceed total amount.' });
        }

        const fee = new Fee({ studentId, academicYear, category, feeType, amount: validAmt, discount: validDisc, discountReason: discountReason || '', dueDate });
        await fee.save();
        res.status(201).json({ success: true, message: 'Fee due added' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Edit fee details
router.patch('/fees/:id([0-9a-fA-F]{24})', auth, requirePermission('fees.manage'), async (req, res) => {
    try {
        const { academicYear, feeType, amount, discount, discountReason, category, dueDate } = req.body;
        
        const validAmt = Number(amount);
        const validDisc = Number(discount) || 0;
        if (isNaN(validAmt) || validAmt <= 0 || validDisc < 0 || validDisc > validAmt) {
            return res.status(400).json({ success: false, message: 'Invalid fee amount or discount. Discount cannot exceed total amount.' });
        }

        const fee = await Fee.findByIdAndUpdate(req.params.id,
            { academicYear, feeType, amount: validAmt, discount: validDisc, discountReason, category, dueDate }, { returnDocument: 'after' });
        if (fee) {
            const totalPaid = fee.payments.reduce((s, p) => s + p.amount, 0);
            const netAmount = fee.amount - (fee.discount || 0);
            fee.status = totalPaid >= netAmount ? 'Paid' : (totalPaid > 0 ? 'Partial' : 'Pending');
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
router.post('/fees/:id([0-9a-fA-F]{24})/pay', auth, requirePermission('fees.manage'), async (req, res) => {
    try {
        const { amount, mode, receiptNo, remarks, date, collectedBy } = req.body;
        
        const safeReceiptNo = receiptNo ? String(receiptNo).trim() : '';
        if (!safeReceiptNo) {
            return res.status(400).json({ success: false, message: 'Receipt number is required' });
        }

        // Lock duplicate receipt numbers
        const existingReceipt = await Fee.findOne({ 'payments.receiptNo': safeReceiptNo });
        if (existingReceipt) {
            return res.status(400).json({ success: false, message: `Receipt number "${safeReceiptNo}" is already in use!` });
        }

        const validPayAmt = Number(amount);
        if (isNaN(validPayAmt) || validPayAmt <= 0) {
            return res.status(400).json({ success: false, message: 'Payment amount must be greater than zero' });
        }

        const fee = await Fee.findById(req.params.id);
        if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });

        fee.payments.push({
            amount: validPayAmt, mode, receiptNo: safeReceiptNo,
            collectedBy: collectedBy || req.admin.username,
            remarks: remarks || '',
            date: date ? new Date(date) : new Date()
        });

        const totalPaid = fee.payments.reduce((s, p) => s + p.amount, 0);
        const netAmount = fee.amount - (fee.discount || 0);
        fee.status = totalPaid >= netAmount ? 'Paid' : 'Partial';
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
router.delete('/fees/:feeId([0-9a-fA-F]{24})/pay/:paymentId', auth, requirePermission('fees.manage'), async (req, res) => {
    try {
        const fee = await Fee.findById(req.params.feeId);
        if (!fee) return res.status(404).json({ success: false, message: 'Fee not found' });
        fee.payments = fee.payments.filter(p => p._id.toString() !== req.params.paymentId);
        const totalPaid = fee.payments.reduce((s, p) => s + p.amount, 0);
        const netAmount = fee.amount - (fee.discount || 0);
        fee.status = totalPaid >= netAmount ? 'Paid' : (totalPaid > 0 ? 'Partial' : 'Pending');
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
router.delete('/fees/:id([0-9a-fA-F]{24})', auth, requirePermission('fees.manage'), async (req, res) => {
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
router.post('/fees/bulk-selected', auth, requirePermission('fees.manage'), async (req, res) => {
    try {
        const { studentIds, academicYear, category, feeType, amount, discount, discountReason, dueDate } = req.body;
        if (!studentIds || studentIds.length === 0 || !feeType || !amount || !academicYear) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        
        const validAmt = Number(amount);
        const validDisc = Number(discount) || 0;
        if (isNaN(validAmt) || validAmt <= 0 || validDisc < 0 || validDisc > validAmt) {
            return res.status(400).json({ success: false, message: 'Invalid fee amount or discount. Discount cannot exceed total amount.' });
        }

        const fees = studentIds.map(id => ({
            studentId: id,
            academicYear,
            category: category || 'Other',
            feeType,
            amount: validAmt,
            discount: validDisc,
            discountReason: discountReason || '',
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
router.post('/documents', auth, requirePermission('studentdocs.manage'), uploadDoc.single('file'), async (req, res) => {
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

// Bulk upload document to selected students
router.post('/documents/bulk', auth, requirePermission('studentdocs.manage'), uploadDoc.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
        
        let studentIds;
        try { studentIds = JSON.parse(req.body.studentIds); } 
        catch (e) { return res.status(400).json({ success: false, message: 'Invalid student list format' }); }

        if (!studentIds || studentIds.length === 0) {
            return res.status(400).json({ success: false, message: 'No students selected' });
        }

        const docsToInsert = studentIds.map(id => ({
            studentId: id, title: req.body.title,
            fileUrl: req.file.path, cloudinaryId: req.file.filename
        }));

        await StudentDoc.insertMany(docsToInsert);
        
        await logAction(req, {
            action: `Bulk uploaded doc "${req.body.title}" to ${studentIds.length} students`,
            category: 'STUDENT'
        });

        res.status(201).json({ success: true, message: `Document assigned to ${studentIds.length} students` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/documents/:id([0-9a-fA-F]{24})', auth, requirePermission('studentdocs.manage'), async (req, res) => {
    try {
        const doc = await StudentDoc.findById(req.params.id);
        res.json({ success: true, document: doc });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.put('/documents/:id([0-9a-fA-F]{24})', auth, requirePermission('studentdocs.manage'), uploadDoc.single('file'), async (req, res) => {
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

router.delete('/documents/:id([0-9a-fA-F]{24})', auth, requirePermission('studentdocs.manage'), async (req, res) => {
    try {
        const doc = await StudentDoc.findById(req.params.id);
        if (doc && doc.cloudinaryId) {
            const otherUsage = await StudentDoc.exists({ cloudinaryId: doc.cloudinaryId, _id: { $ne: req.params.id } });
            if (!otherUsage) {
                await cloudinary.uploader.destroy(doc.cloudinaryId, { resource_type: 'raw' });
            }
        }
        await StudentDoc.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Document deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// ============ FINANCE / DCR (Permission Based) ============

// 1. COLLECTION REPORT
router.get('/collection-report', auth, requirePermission('reports.view'), async (req, res) => {
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
router.get('/pending-summary', auth, requirePermission('reports.view'), async (req, res) => {
    try {
        const result = await Fee.aggregate([
            { $addFields: { paid: { $sum: '$payments.amount' } } },
            { $addFields: { pending: { $subtract: ['$amount', '$paid'] } } },
            { $addFields: { paid: { $sum: '$payments.amount' }, disc: { $ifNull: ['$discount', 0] } } },
            { $addFields: { netAmount: { $subtract: ['$amount', '$disc'] } } },
            { $addFields: { pending: { $subtract: ['$netAmount', '$paid'] } } },
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
            { $addFields: { paid: { $sum: '$payments.amount' }, disc: { $ifNull: ['$discount', 0] } } },
            { $addFields: { netAmount: { $subtract: ['$amount', '$disc'] } } },
            { $addFields: { pending: { $subtract: ['$netAmount', '$paid'] } } },
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
router.get('/defaulters', auth, requirePermission('reports.view'), async (req, res) => {
    try {
        const pipeline = [
            { $addFields: { paid: { $sum: '$payments.amount' } } },
            { $addFields: { pending: { $subtract: ['$amount', '$paid'] } } },
            { $addFields: { paid: { $sum: '$payments.amount' }, disc: { $ifNull: ['$discount', 0] } } },
            { $addFields: { netAmount: { $subtract: ['$amount', '$disc'] } } },
            { $addFields: { pending: { $subtract: ['$netAmount', '$paid'] } } },
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
router.get('/today-collection', auth, requirePermission('reports.view'), async (req, res) => {
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
router.post('/students/bulk-promote', auth, requirePermission('students.edit'), async (req, res) => {
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