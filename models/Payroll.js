const mongoose = require('mongoose');

const payrollSchema = new mongoose.Schema({
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
    month: { type: String, required: true }, // Format: "YYYY-MM"
    basicSalary: { type: Number, required: true },
    allowances: { type: Number, default: 0 },
    arrears: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 },
    netSalary: { type: Number, required: true },
    paymentDate: { type: Date, default: Date.now },
    status: { type: String, enum: ['Pending', 'Paid'], default: 'Paid' },
    remarks: { type: String, default: '' },
    generatedBy: { type: String }
}, { timestamps: true });

// Prevent generating multiple duplicate slips for the same month
payrollSchema.index({ adminId: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('Payroll', payrollSchema);