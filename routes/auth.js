const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const auth = require('../middleware/auth');

// POST - Register admin
router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        const existingAdmin = await Admin.findOne({ 
            $or: [{ email }, { username }] 
        });
        
        if (existingAdmin) {
            return res.status(400).json({ 
                success: false, 
                message: 'Admin already exists' 
            });
        }

        // Hash password manually
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const admin = new Admin({ 
            username, 
            email, 
            password: hashedPassword 
        });
        await admin.save();

        res.status(201).json({ 
            success: true, 
            message: 'Admin registered successfully' 
        });
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            message: error.message 
        });
    }
});

// POST - Login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        const admin = await Admin.findOne({ 
            $or: [{ username }, { email: username }] 
        });

        if (!admin) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }

        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }

        const token = jwt.sign(
                    { id: admin._id, username: admin.username, role: admin.role, permissions: admin.permissions },
                    process.env.JWT_SECRET,
                    { expiresIn: '24h' }
                );

        res.json({
                    success: true,
                    token,
                    admin: {
                        id: admin._id,
                        username: admin.username,
                        email: admin.email,
                        role: admin.role,
                        permissions: admin.permissions
                    }
                });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});




// Super admin only check
function superOnly(req, res, next) {
    if (req.admin.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Super admin only' });
    }
    next();
}

// List all admins
router.get('/admins', auth, superOnly, async (req, res) => {
    try {
        const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
        res.json({ success: true, admins });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Create sub-admin
router.post('/admins', auth, superOnly, async (req, res) => {
    try {
        const { username, email, password, permissions } = req.body;
        const exists = await Admin.findOne({ $or: [{ email }, { username }] });
        if (exists) return res.status(400).json({ success: false, message: 'Admin exists' });
        const hashed = await bcrypt.hash(password, 10);
        const admin = new Admin({ username, email, password: hashed, role: 'admin', permissions: permissions || [] });
        await admin.save();
        res.status(201).json({ success: true, message: 'Sub-admin created' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Update sub-admin permissions
router.put('/admins/:id', auth, superOnly, async (req, res) => {
    try {
        const admin = await Admin.findByIdAndUpdate(req.params.id,
            { permissions: req.body.permissions }, { new: true }).select('-password');
        res.json({ success: true, admin });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Delete sub-admin
router.delete('/admins/:id', auth, superOnly, async (req, res) => {
    try {
        const target = await Admin.findById(req.params.id);
        if (target && target.role === 'superadmin') {
            return res.status(400).json({ success: false, message: 'Cannot delete super admin' });
        }
        await Admin.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Sub-admin deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});




module.exports = router;