const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Result = require('../models/Result');
const Attendance = require('../models/Attendance');
const Timetable = require('../models/Timetable');
const Fee = require('../models/Fee');
const StudentDoc = require('../models/StudentDoc');
const studentAuth = require('../middleware/studentAuth');
const rateLimit = require('express-rate-limit');
const { loginLimiter } = require('../middleware/rateLimiter');
const Student = require('../models/Student'); // Adjust this path to your Student model
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');

// Secure multer: Max 5MB, only allow CSV files to prevent DoS disk fill
const upload = multer({ 
    dest: 'uploads/',
    limits: { fileSize: 5 * 1024 * 1024 }, 
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) cb(null, true);
        else cb(new Error('Only CSV files are allowed'));
    }
});
const auth = require('../middleware/auth');
const requirePermission = require('../middleware/permission');

const { generateReceipt } = require('../utils/receiptGenerator');
const { generateReportCard } = require('../utils/reportCardGenerator');

const studentLoginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Allow 10 attempts for students
    message: { 
        success: false, 
        message: 'Too many login attempts. Please wait 15 minutes and try again.' 
    }
});

// Student Login
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { rollNumber, password } = req.body;
        const student = await Student.findOne({ rollNumber });
        if (!student) return res.status(401).json({ success: false, message: 'Invalid credentials' });
        const match = await student.comparePassword(password);
        if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials' });

        const token = jwt.sign(
            { id: student._id, rollNumber: student.rollNumber, role: 'student' },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
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

// Download My Report Card PDF
router.get('/results/:id/pdf', studentAuth, async (req, res) => {
    try {
        const result = await Result.findOne({ _id: req.params.id, studentId: req.student.id });
        if (!result) return res.status(404).json({ error: 'Result not found' });
        
        const student = await Student.findById(req.student.id).lean();
        const pdf = await generateReportCard({ student, result });
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="ReportCard_${student.rollNumber}.pdf"`);
        res.send(pdf);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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

// Student changes own password
router.put('/change-password', studentAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Both passwords required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
        }
        const student = await Student.findById(req.student.id);
        const isMatch = await student.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        }
        student.password = await bcrypt.hash(newPassword, 10);
        await student.save();

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// ==========================================
// 1. FEATURE: UPDATE STUDENT DETAILS
// ==========================================
router.put('/:id', auth, requirePermission('students.edit'), async (req, res) => {
    try {
        const { name, rollNumber, studentClass, section, parentName, phone } = req.body;
        
        const existing = await Student.findOne({ rollNumber, _id: { $ne: req.params.id } });
        if (existing) {
            return res.status(400).json({ success: false, message: `Roll number ${rollNumber} is already assigned to another student!` });
        }

        // Find student and update fields (excluding password)
        const updatedStudent = await Student.findByIdAndUpdate(
            req.params.id,
            { 
                name, 
                rollNumber, 
                class: studentClass, // Mapping 'studentClass' from frontend to database 'class'
                section, 
                parentName, 
                phone 
            },
            { returnDocument: 'after' }
        );

        if (!updatedStudent) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        res.json({ success: true, message: 'Student updated successfully', student: updatedStudent });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error updating student' });
    }
});

// ==========================================
// 2. FEATURE: RESET STUDENT PASSWORD
// ==========================================
router.put('/:id/reset-password', auth, requirePermission('students.edit'), async (req, res) => {
    try {
        const { password } = req.body;
        if (!password || password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
        }

        // Hash the new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const updatedStudent = await Student.findByIdAndUpdate(
            req.params.id,
            { password: hashedPassword },
            { returnDocument: 'after' }
        );

        if (!updatedStudent) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Server error resetting password' });
    }
});

// ==========================================
// 3. FEATURE: BULK UPLOAD STUDENTS (CSV)
// ==========================================
router.post('/bulk', auth, requirePermission('students.add'), upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const results = [];
    const filePath = req.file.path;

    // Read and parse the CSV file
    fs.createReadStream(filePath)
        .pipe(csv()) // Expects headers: Name, Roll Number, Class, Section, Password, Parent Name, Phone
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            try {
                let successCount = 0;
                let skipCount = 0;
                const skippedReasons = []; // Track exact reasons for skipping

                const salt = await bcrypt.genSalt(10);
                const defaultHashedPassword = await bcrypt.hash('123456', salt); // Pre-hash default password for massive speedup

                // 1. Clean and validate all rows first
                const validRows = [];
                const incomingRolls = new Set();

                for (let i = 0; i < results.length; i++) {
                    const row = results[i];
                    
                    // Ignore completely blank rows generated by Excel
                    if (Object.values(row).every(val => !val || String(val).trim() === '')) {
                        continue;
                    }

                    // Normalize headers and trim whitespace automatically
                    const cleanRow = {};
                    for (let key in row) {
                        if (key) cleanRow[key.trim().toLowerCase()] = String(row[key]).trim();
                    }

                    const name = cleanRow['name'];
                    const rollNumber = cleanRow['roll number'] || cleanRow['rollnumber'];
                    const studentClass = cleanRow['class'];
                    const section = cleanRow['section'] || '';
                    const plainPassword = cleanRow['password'] || '123456';
                    const parentName = cleanRow['parent name'] || cleanRow['parentname'] || '';
                    const phone = cleanRow['phone'] || '';

                    if (!name || !rollNumber || !studentClass) {
                        skipCount++;
                        skippedReasons.push(`Row ${i + 2}: Missing Name, Roll, or Class`);
                        continue; 
                    }

                    if (incomingRolls.has(rollNumber)) {
                        skipCount++;
                        skippedReasons.push(`Row ${i + 2}: Duplicate Roll No in CSV (${rollNumber})`);
                        continue;
                    }

                    incomingRolls.add(rollNumber);
                    validRows.push({ name, rollNumber, studentClass, section, plainPassword, parentName, phone, rowIndex: i + 2 });
                }

                // 2. Fetch ALL existing students with these roll numbers at once (Massive DB optimization)
                const rollArray = Array.from(incomingRolls);
                const existingDocs = await Student.find({ rollNumber: { $in: rollArray } }, 'rollNumber').lean();
                const existingSet = new Set(existingDocs.map(doc => doc.rollNumber));

                // 3. Prepare bulk insert array
                const newStudents = [];

                for (const row of validRows) {
                    if (existingSet.has(row.rollNumber)) {
                        skipCount++;
                        skippedReasons.push(`Row ${row.rowIndex}: Already in Database (${row.rollNumber})`);
                        continue; 
                    }

                    // Optimize hashing: only calculate if it's NOT the default password
                    let hashedPassword = defaultHashedPassword;
                    if (row.plainPassword !== '123456') {
                        hashedPassword = await bcrypt.hash(String(row.plainPassword), salt);
                    }

                    newStudents.push({
                        name: row.name,
                        rollNumber: row.rollNumber,
                        class: row.studentClass,
                        section: row.section,
                        password: hashedPassword,
                        parentName: row.parentName,
                        phone: row.phone
                    });
                }

                // 4. Bulk insert all new students at once
                if (newStudents.length > 0) {
                    await Student.insertMany(newStudents, { ordered: false });
                    successCount += newStudents.length;
                }

                // Delete the temporary uploaded file from server storage
                fs.unlinkSync(filePath);

                let message = `Successfully added ${successCount} students.`;
                if (skipCount > 0) {
                    message += ` Skipped ${skipCount} rows.<br><br><small style="color:#991b1b;display:block;max-height:250px;overflow-y:auto;text-align:left;line-height:1.4;background:#fef2f2;padding:5px;border-radius:4px;"><strong>Skip Reasons:</strong><br>${skippedReasons.join('<br>')}</small>`;
                }

                res.json({
                    success: true,
                    message: message
                });

            } catch (error) {
                console.error(error);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // fallback cleanup
                res.status(500).json({ success: false, message: 'Database error processing bulk upload' });
            }
        });
});


// GET /api/student/my-fees — returns logged-in student's fees + payment history
router.get('/my-fees', studentAuth, async (req, res) => {
    try {
        const fees = await Fee.find({ studentId: req.student.id }).sort({ createdAt: -1 });

        const data = fees.map(f => {
            const totalPaid = f.payments.reduce((s, p) => s + p.amount, 0);
            const netAmount = f.amount - (f.discount || 0);
            return {
                _id: f._id,
                academicYear: f.academicYear,
                category: f.category,
                feeType: f.feeType,
                amount: f.amount,
                discount: f.discount || 0,
                discountReason: f.discountReason || '',
                netAmount,
                totalPaid,
                pending: netAmount - totalPaid,
                status: f.status,
                dueDate: f.dueDate,
                // payment history — internal field 'collectedBy' intentionally omitted
                payments: f.payments.map(p => ({
                    amount: p.amount,
                    date: p.date,
                    mode: p.mode,
                    receiptNo: p.receiptNo
                }))
            };
        });

        res.json({ success: true, fees: data });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to load fees' });
    }
});


// Student/parent downloads their OWN receipt (IDOR-safe via JWT)
router.get('/my-receipt/:receiptNo', studentAuth, async (req, res) => {
  try {
    // studentId comes from verified JWT, NOT the URL — prevents tampering
    const fee = await Fee.findOne({
      studentId: req.student.id,
      'payments.receiptNo': req.params.receiptNo,
    });
    if (!fee) return res.status(404).json({ error: 'Receipt not found' });

    const payment = fee.payments.find(p => String(p.receiptNo) === String(req.params.receiptNo));
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    const student = await Student.findById(req.student.id).lean();

    // Calculate accurately up to THIS specific payment, not future ones
    let paidTillDate = 0;
    for (const p of fee.payments) {
      paidTillDate += (p.amount || 0);
      if (String(p.receiptNo) === String(req.params.receiptNo)) break;
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

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Receipt_${payment.receiptNo}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;