const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

async function auth(req, res, next) {
    try {
        const authHeader = req.header('Authorization');
        
        if (!authHeader) {
            return res.status(401).json({ 
                success: false, 
                message: 'No token, authorization denied' 
            });
        }
        
        const token = authHeader.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'No token provided' 
            });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // 🔒 FIX: Verify the admin still exists in the database and pull LIVE permissions!
        const admin = await Admin.findById(decoded.id).select('role permissions username allowedClasses');
        if (!admin) {
            return res.status(401).json({ success: false, message: 'Admin account no longer exists or was deleted' });
        }

        req.admin = {
            id: admin._id,
            username: admin.username,
            role: admin.role,
            permissions: admin.permissions, // Live permissions directly from DB!
            // Empty/absent = NO access to any class for non-superadmins (must be granted
            // explicitly). Superadmins are never restricted regardless of this field.
            allowedClasses: admin.allowedClasses || []
        };

        next();
    } catch (error) {
        return res.status(401).json({ 
            success: false, 
            message: 'Token is not valid: ' + error.message 
        });
    }
}

module.exports = auth;