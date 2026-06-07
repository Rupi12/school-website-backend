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

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    .then(() => console.log('✅ MongoDB connected successfully'))
    .catch(err => console.error('❌ MongoDB connection error:', err.message));

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});

console.log('13. Setup complete, waiting for connections...');