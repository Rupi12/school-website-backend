require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./models/Admin');

async function test() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected');
        
        const admin = new Admin({
            username: 'testadmin',
            email: 'testadmin@test.com',
            password: 'test123'
        });
        
        await admin.save();
        console.log('✅ Admin created!');
        console.log('Hashed password:', admin.password);
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

test();