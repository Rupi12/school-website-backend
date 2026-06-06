const mongoose = require('mongoose');

const gallerySchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    imageUrl: {
        type: String,
        required: true
    },
    cloudinaryId: {
        type: String,
        default: ''
    },
    category: {
        type: String,
        required: true,
        enum: ['Events', 'Sports', 'Campus', 'Academics', 'Cultural', 'Others'],
        default: 'Others'
    },
    description: {
        type: String,
        default: ''
    }
}, { timestamps: true });



module.exports = mongoose.model('Gallery', gallerySchema);