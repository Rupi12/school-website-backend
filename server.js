console.log('1. Starting server...');

// --- CRASH-PROOFING: GLOBAL ERROR HANDLERS ---
// These will catch any errors that are not handled elsewhere in the app,
// log them, and prevent the entire server from crashing.
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('💥 UNCAUGHT EXCEPTION:', error);
  process.exit(1); // It's often best to restart after an uncaught exception
});

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
// Allow requests from any origin. This is necessary for the Expo mobile app to work.
// For a public API accessed by a native app, this is a common configuration.
app.use(cors());

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

    app.use('/api/homepage-settings', require('./routes/homepageSettings'));
    console.log('18. homepage-settings route loaded');


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
    .then(() => {
        console.log('✅ MongoDB connected successfully');
    })
    .catch(err => console.error('❌ MongoDB connection error:', err.message));

// Start server
const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});

//app.listen(PORT, '0.0.0.0', () => {
  //console.log(`Local:   http://localhost:${PORT}`);
  //console.log(`Network: http://10.104.35.40:${PORT}`);
//});


console.log('13. Setup complete, waiting for connections...');