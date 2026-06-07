const mongoose = require('mongoose');

const resultSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    examName: { type: String, required: true, trim: true },
    term: { type: String, enum: ['Term 1', 'Term 2', 'Annual', 'Unit Test', 'Other'], default: 'Term 1' },
    academicYear: { type: String, required: true },  // e.g. "2025-26"
    examDate: { type: Date },
    subjects: [{
        subject: String,
        marksObtained: Number,
        totalMarks: Number
    }],
    remark: { type: String, default: '' }
}, { timestamps: true });

// Index for faster queries
resultSchema.index({ studentId: 1, academicYear: 1 });

module.exports = mongoose.model('Result', resultSchema);