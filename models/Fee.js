const mongoose = require('mongoose');

const feeSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    feeType: { type: String, required: true },   // Tuition, Exam, etc.
    amount: { type: Number, required: true },
    dueDate: { type: Date },
    status: { type: String, enum: ['Paid', 'Pending'], default: 'Pending' },
    paidDate: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Fee', feeSchema);