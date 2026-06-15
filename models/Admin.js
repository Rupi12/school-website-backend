const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['admin', 'superadmin'], default: 'admin' },
    permissions: { type: [String], default: [] },
    realName: { type: String, default: '' },
    employeeId: { type: String, default: '' },
    phone: { type: String, default: '' },
    qualifications: { type: String, default: '' },
    joiningDate: { type: Date },
    basicSalary: { type: Number, default: 0 }
}, { timestamps: true });

adminSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Admin', adminSchema);