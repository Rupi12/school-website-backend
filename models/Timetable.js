const mongoose = require('mongoose');

const timetableSchema = new mongoose.Schema({
    class: { type: String, required: true },
    section: { type: String, default: '' },
    schedule: [{
        day: String,        // Monday, Tuesday...
        periods: [{
            time: String,    // "9:00-10:00"
            subject: String,
            teacher: String
        }]
    }]
}, { timestamps: true });

module.exports = mongoose.model('Timetable', timetableSchema);