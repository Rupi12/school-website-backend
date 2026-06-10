const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    actorName: { type: String, required: true },      // admin username
    actorRole: { type: String, default: 'admin' },    // admin / superadmin
    action: { type: String, required: true },          // human-readable, e.g. "Recorded payment ₹500"
    category: { type: String, required: true },         // FEE / STUDENT / ADMIN / AUTH
    targetName: { type: String, default: '' },          // e.g. student name
    targetId: { type: String, default: '' },            // related record id
    ip: { type: String, default: '' }
}, { timestamps: true });

// auto-delete logs older than 1 year (optional — keeps DB small on free tier)
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

module.exports = mongoose.model('AuditLog', auditLogSchema);