const AuditLog = require('../models/AuditLog');

// Fire-and-forget — never blocks or breaks the main request
async function logAction(req, { action, category, targetName = '', targetId = '' }) {
    try {
        await AuditLog.create({
            actorName: req.admin?.username || 'Unknown',
            actorRole: req.admin?.role || 'admin',
            action,
            category,
            targetName,
            targetId,
            ip: req.headers['x-forwarded-for'] || req.ip || ''
        });
    } catch (e) {
        console.error('Audit log failed:', e.message); // log but never throw
    }
}

module.exports = { logAction };