const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const auth = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const { loginLimiter } = require('../middleware/rateLimiter');
const requirePermission = require('../middleware/permission');
const { logAction } = require('../utils/auditLogger');
const AuditLog = require('../models/AuditLog');

// POST - Login
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const admin = await Admin.findOne({ $or: [{ username }, { email: username }] });
        if (!admin) return res.status(401).json({ success: false, message: 'Invalid credentials' });

        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials' });

        const token = jwt.sign(
            { id: admin._id, username: admin.username, role: admin.role, permissions: admin.permissions },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // 🔍 AUDIT — login has no auth middleware, log directly
        try {
            await AuditLog.create({
                actorName: admin.username,
                actorRole: admin.role,
                action: 'Logged in',
                category: 'AUTH',
                ip: req.headers['x-forwarded-for'] || req.ip || ''
            });
        } catch (e) { console.error('Audit (login) failed:', e.message); }

        res.json({
            success: true,
            token,
            admin: { id: admin._id, username: admin.username, email: admin.email, role: admin.role, permissions: admin.permissions }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Middleware to check if user can edit staff profile OR permissions
const canEditStaff = (req, res, next) => {
    if (req.admin.role === 'superadmin') return next();
    const p = req.admin.permissions || [];
    if (p.includes('staff.edit.profile') || p.includes('staff.edit.permissions')) return next();
    return res.status(403).json({ success: false, message: 'Permission denied' });
};

// Middleware to check if user has ANY staff permissions to view the directory
const canViewStaff = (req, res, next) => {
    if (req.admin.role === 'superadmin') return next();
    const p = req.admin.permissions || [];
    const staffPerms = ['staff.view', 'staff.create', 'staff.edit.profile', 'staff.edit.permissions', 'staff.reset.password', 'staff.delete', 'staff.attendance.approve'];
    if (staffPerms.some(perm => p.includes(perm))) return next();
    return res.status(403).json({ success: false, message: 'Permission denied' });
};

// List all admins
router.get('/admins', auth, canViewStaff, async (req, res) => {
    try {
        const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
        res.json({ success: true, admins });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Create sub-admin
router.post('/admins', auth, requirePermission('staff.create'), async (req, res) => {
    try {
        const { username, email, password, permissions } = req.body;
        const exists = await Admin.findOne({ $or: [{ email }, { username }] });
        if (exists) return res.status(400).json({ success: false, message: 'Admin exists' });
        const hashed = await bcrypt.hash(password, 10);
        const admin = new Admin({ username, email, password: hashed, role: 'admin', permissions: permissions || [] });
        await admin.save();

        await logAction(req, {
            action: `Created sub-admin "${username}"`,
            category: 'ADMIN',
            targetName: username,
            targetId: admin._id.toString()
        });

        res.status(201).json({ success: true, message: 'Sub-admin created' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Update sub-admin permissions & profile
router.put('/admins/:id', auth, canEditStaff, async (req, res) => {
    try {
        const { permissions, realName, employeeId, phone, qualifications, joiningDate, basicSalary } = req.body;
        
        const updateData = {};
        const canEditProfile = req.admin.permissions.includes('staff.edit.profile') || req.admin.role === 'superadmin';
        const canEditPerms = req.admin.permissions.includes('staff.edit.permissions') || req.admin.role === 'superadmin';

        if (canEditPerms && permissions) updateData.permissions = permissions;
        if (canEditProfile && realName !== undefined) updateData.realName = realName;
        if (canEditProfile && employeeId !== undefined) updateData.employeeId = employeeId;
        if (canEditProfile && phone !== undefined) updateData.phone = phone;
        if (canEditProfile && qualifications !== undefined) updateData.qualifications = qualifications;
        if (canEditProfile && joiningDate !== undefined) updateData.joiningDate = joiningDate;
        if (canEditProfile && basicSalary !== undefined) updateData.basicSalary = basicSalary;

        const admin = await Admin.findByIdAndUpdate(req.params.id,
            updateData, { returnDocument: 'after' }).select('-password');

        await logAction(req, {
            action: `Updated permissions for "${admin.username}"`,
            category: 'ADMIN',
            targetName: admin.username,
            targetId: req.params.id
        });

        res.json({ success: true, admin });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Delete sub-admin
router.delete('/admins/:id', auth, requirePermission('staff.delete'), async (req, res) => {
    try {
        const target = await Admin.findById(req.params.id);
        if (target && target.role === 'superadmin') {
            return res.status(400).json({ success: false, message: 'Cannot delete super admin' });
        }
        await Admin.findByIdAndDelete(req.params.id);

        await logAction(req, {
            action: `Deleted sub-admin "${target?.username || 'unknown'}"`,
            category: 'ADMIN',
            targetName: target?.username || '',
            targetId: req.params.id
        });

        res.json({ success: true, message: 'Sub-admin deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Reset a sub-admin's password
router.put('/admins/:id/reset-password', auth, requirePermission('staff.reset.password'), async (req, res) => {
    try {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters long' });
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        await Admin.findByIdAndUpdate(req.params.id, { password: hashedPassword });

        const targetAdmin = await Admin.findById(req.params.id).select('username');
        await logAction(req, {
            action: `Reset password for "${targetAdmin?.username || 'unknown'}"`,
            category: 'ADMIN',
            targetName: targetAdmin?.username || '',
            targetId: req.params.id
        });

        res.json({ success: true, message: 'Password reset successfully!' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin changes own password
router.put('/change-password', auth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Both passwords required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
        }
        const admin = await Admin.findById(req.admin.id);
        const isMatch = await bcrypt.compare(currentPassword, admin.password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Current password is incorrect' });
        }
        admin.password = await bcrypt.hash(newPassword, 10);
        await admin.save();

        await logAction(req, {
            action: 'Changed own password',
            category: 'ADMIN'
        });

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;