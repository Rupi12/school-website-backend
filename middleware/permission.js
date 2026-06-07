function requirePermission(perm) {
    return (req, res, next) => {
        if (req.admin.role === 'superadmin') return next();
        if (req.admin.permissions && req.admin.permissions.includes(perm)) return next();
        return res.status(403).json({ success: false, message: 'Permission denied' });
    };
}
module.exports = requirePermission;