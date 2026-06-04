const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');

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
            { id: admin._id, username: admin.username, role: admin.role },
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
                role: admin.role
            }
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: error.message 
        });
    }
});

module.exports = router;