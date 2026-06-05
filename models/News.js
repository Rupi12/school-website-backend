const mongoose = require('mongoose');

const newsSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    category: {
        type: String,
        required: true,
        enum: ['News', 'Events', 'Achievements', 'Announcements'],
        default: 'News'
    },
    imageUrl: { type: String, default: '' },
    cloudinaryId: { type: String, default: '' },
    eventDate: { type: Date, default: null },
    isPinned: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('News', newsSchema);