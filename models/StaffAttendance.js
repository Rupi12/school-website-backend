const mongoose = require('mongoose');

const staffAttendanceSchema = new mongoose.Schema({
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['Present', 'Absent', 'Half-Day', 'Leave', 'Holiday'],
        default: 'Present'
    },
    remarks: {
        type: String,
        default: ''
    },
    entryTime: { type: String, default: '' },
    exitTime: { type: String, default: '' },
    approvalStatus: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Approved' // Bulk marks by superadmin default to approved
    },
    markedBy: { type: String } // Superadmin who marked it
}, { timestamps: true });

module.exports = mongoose.model('StaffAttendance', staffAttendanceSchema);