const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const studentSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    rollNumber: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    class: { type: String, required: true },
    section: { type: String, default: '' },
    parentName: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' },
    pushToken: { type: String, default: '' } // Expo push token for notifications
}, { timestamps: true });

studentSchema.methods.comparePassword = async function(pw) {
    return bcrypt.compare(pw, this.password);
};

module.exports = mongoose.model('Student', studentSchema);