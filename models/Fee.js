const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
    amount: { type: Number, required: true },
    date: { type: Date, default: Date.now },
    mode: { type: String, enum: ['Cash', 'Online', 'Cheque', 'Bank Transfer', 'Other'], required: true },
    receiptNo: { type: String, required: true },
    collectedBy: { type: String, required: true },
    remarks: { type: String, default: '' }
});

const feeSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    academicYear: { type: String, required: true },
    category: {
        type: String,
        enum: ['Tuition', 'Transport', 'Exam', 'Annual', 'Trip', 'Library', 'Previous Balance', 'Other'],
        default: 'Other'
    },
    feeType: { type: String, required: true },
    amount: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    discountReason: { type: String, default: '' },
    dueDate: { type: Date },
    status: { type: String, enum: ['Paid', 'Pending', 'Partial'], default: 'Pending' },
    payments: [paymentSchema]
}, { timestamps: true });

feeSchema.index({ studentId: 1, academicYear: 1 });
feeSchema.index({ dueDate: 1, status: 1 });

module.exports = mongoose.model('Fee', feeSchema);