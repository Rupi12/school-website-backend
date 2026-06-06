const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    category: {
        type: String,
        enum: ['Results', 'Notices', 'Forms', 'Circulars', 'Others'],
        default: 'Others'
    },
    fileUrl: { type: String, required: true },
    cloudinaryId: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Document', documentSchema);