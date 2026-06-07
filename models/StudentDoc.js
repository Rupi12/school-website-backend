const mongoose = require('mongoose');

const studentDocSchema = new mongoose.Schema({
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
    title: { type: String, required: true },
    fileUrl: { type: String, required: true },
    cloudinaryId: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('StudentDoc', studentDocSchema);