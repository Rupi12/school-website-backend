console.log('1. Starting server...');

const express = require('express');
console.log('2. Express loaded');

const mongoose = require('mongoose');
console.log('3. Mongoose loaded');

const cors = require('cors');
console.log('4. CORS loaded');

require('dotenv').config();
console.log('5. dotenv loaded');
console.log('6. PORT from env:', process.env.PORT);
console.log('7. MONGODB_URI exists:', !!process.env.MONGODB_URI);

const app = express();
console.log('8. Express app created');

app.set('trust proxy', 1);

// Middleware
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');

const hpp = require('hpp');



// Prevent HTTP Parameter Pollution
app.use(hpp());

// --- HARDENED MIDDLEWARE ---

// 1. Secure HTTP Headers (Helmet)
// Hides "X-Powered-By: Express" and sets strict rules for content execution
app.use(helmet());

// 2. Strict CORS Policy
// Right now, any website in the world can make requests to your API. 
// We must restrict this to ONLY your specific Netlify frontend URL.
app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500','https://www.amarjyotischool.in','https://amarjyotischool.in', 'https://amarjyotischooll.netlify.app',], 
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true // Required if you ever use cookies
}));

// Body parser (Existing)
app.use(express.json({ limit: '1mb' }));  // limit to save it payload crashing 
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 3. Data Sanitization against NoSQL Query Injection
// Prevents hackers from passing {"$gt": ""} into login fields to bypass passwords
app.use(mongoSanitize());

// 4. Data Sanitization against XSS (Cross-Site Scripting)
// Cleans any user input (like news descriptions or contact messages) of malicious HTML/JS tags
app.use(xss());

// Routes
try {
    app.use('/api/applications', require('./routes/applications'));
    console.log('9. Applications route loaded');
    
    app.use('/api/contacts', require('./routes/contacts'));
    console.log('10. Contacts route loaded');
    
    app.use('/api/auth', require('./routes/auth'));
    console.log('11. Auth route loaded');

    app.use('/api/gallery', require('./routes/gallery'));
    console.log('12. Gallery route loaded');


    app.use('/api/news', require('./routes/news'));
    console.log('13. news route loaded');

    app.use('/api/documents', require('./routes/documents'));
    console.log('14. documents route loaded');

    app.use('/api/student', require('./routes/student'));
    console.log('15. student route loaded');

    app.use('/api/student-admin', require('./routes/studentAdmin'));
    console.log('16. student-admin loaded');

    app.use('/api/audit', require('./routes/audit'));
    console.log('17. Logs audit');


} catch (err) {
    console.error('❌ Error loading routes:', err.message);
    process.exit(1);
}

// Health check route
app.get('/', (req, res) => {
    res.json({ 
        message: '🎓 School Website API is running!',
        version: '1.0.0'
    });
});

// Connect to MongoDB
console.log('12. Connecting to MongoDB...');
mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('✅ MongoDB connected successfully');
        
        // Cleanup stale permission keys from the database automatically
        try {
            const Admin = require('./models/Admin');
            const validPermissions = [
                'applications.view', 'applications.edit', 'applications.delete', 'applications.export',
                'messages.view', 'messages.delete',
                'gallery.add', 'gallery.edit', 'gallery.delete',
                'news.add', 'news.edit', 'news.delete',
                'documents.add', 'documents.delete',
                'students.view', 'students.add', 'students.edit', 'students.delete', 'students.export',
                'results.manage', 'fees.manage', 'attendance.manage', 'timetable.manage', 'studentdocs.manage',
                'reports.view', 'audit.view'
            ];
            const result = await Admin.updateMany({}, { $pull: { permissions: { $nin: validPermissions } } });
            if (result.modifiedCount > 0) {
                console.log(`🧹 Automatically cleared stale permissions from ${result.modifiedCount} sub-admin(s).`);
            }
        } catch (err) {
            console.error('Error cleaning permissions:', err.message);
        }
    })
    .catch(err => console.error('❌ MongoDB connection error:', err.message));

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});

console.log('13. Setup complete, waiting for connections...');