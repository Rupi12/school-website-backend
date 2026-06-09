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
const upload = multer({ dest: 'uploads/' }); // Setup multer for temporary file uploads

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



// ==========================================
// 1. FEATURE: UPDATE STUDENT DETAILS
// ==========================================
router.put('/:id', async (req, res) => {
    try {
        const { name, rollNumber, studentClass, section, parentName, phone } = req.body;
        
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
            { new: true }
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
router.put('/:id/reset-password', async (req, res) => {
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
            { new: true }
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
router.post('/bulk', upload.single('file'), async (req, res) => {
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

                const salt = await bcrypt.genSalt(10);

                for (const row of results) {
                    // Extract data from CSV rows (Handle variations in column headers spacing/casing)
                    const name = row['Name'] || row['name'];
                    const rollNumber = row['Roll Number'] || row['rollNumber'] || row['RollNumber'];
                    const studentClass = row['Class'] || row['class'];
                    const section = row['Section'] || row['section'] || '';
                    const plainPassword = row['Password'] || row['password'] || '123456'; // fallback pwd
                    const parentName = row['Parent Name'] || row['parentName'] || '';
                    const phone = row['Phone'] || row['phone'] || '';

                    if (!name || !rollNumber || !studentClass) {
                        skipCount++;
                        continue; // Skip rows missing mandatory data
                    }

                    // Check if student with this roll number already exists
                    const existingStudent = await Student.findOne({ rollNumber });
                    if (existingStudent) {
                        skipCount++;
                        continue; 
                    }

                    // Hash the password
                    const hashedPassword = await bcrypt.hash(plainPassword.toString(), salt);

                    // Create new student document
                    await Student.create({
                        name,
                        rollNumber,
                        class: studentClass,
                        section,
                        password: hashedPassword,
                        parentName,
                        phone
                    });

                    successCount++;
                }

                // Delete the temporary uploaded file from server storage
                fs.unlinkSync(filePath);

                res.json({
                    success: true,
                    message: `Bulk processing complete! Successfully added ${successCount} students. Skipped ${skipCount} duplicates/invalid rows.`
                });

            } catch (error) {
                console.error(error);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // fallback cleanup
                res.status(500).json({ success: false, message: 'Database error processing bulk upload' });
            }
        });
});




module.exports = router;