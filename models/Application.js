const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema({
    studentName: { 
        type: String, 
        required: true, 
        trim: true 
    },
    dob: { 
        type: Date, 
        required: true 
    },
    grade: { 
        type: String, 
        required: true 
    },
    gender: { 
        type: String, 
        required: true 
    },
    parentName: { 
        type: String, 
        required: true 
    },
    phone: { 
        type: String, 
        required: true 
    },
    email: { 
        type: String, 
        required: true, 
        lowercase: true 
    },
    address: { 
        type: String, 
        required: true 
    },
    prevSchool: { 
        type: String, 
        default: '' 
    },
    status: { 
        type: String, 
        enum: ['pending', 'reviewing', 'approved', 'rejected'], 
        default: 'pending' 
    }
}, { timestamps: true });

module.exports = mongoose.model('Application', applicationSchema);