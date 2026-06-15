const mongoose = require('mongoose');

const staffAttendanceRequestSchema = new mongoose.Schema({
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin',
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    entryTime: {
        type: String, // HH:MM format
        required: true
    },
    exitTime: {
        type: String, // HH:MM format
        required: true
    },
    requestStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    requestedBy: { // Store admin username for easier audit/display
        type: String,
        required: true
    },
    approvedBy: { // Admin ID who approved/rejected
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Admin'
    },
    adminNotes: { // Notes from the approver
        type: String
    }
}, { timestamps: true });

staffAttendanceRequestSchema.index({ adminId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('StaffAttendanceRequest', staffAttendanceRequestSchema);