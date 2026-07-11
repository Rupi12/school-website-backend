const mongoose = require('mongoose');

// Singleton document — the app fetches this at load and falls back to
// hardcoded defaults if it's missing, so admins can update marketing
// numbers (result %, seats, toppers, etc.) without an app store release.
const HomepageSettingsSchema = new mongoose.Schema({
    boardResultPercent: { type: Number, default: 100 },
    studentCount: { type: Number, default: 1496 },
    facultyCount: { type: Number, default: 32 },
    yearsOfExcellence: { type: Number, default: 24 },
    seatsTotal: { type: Number, default: 400 },
    seatsFilled: { type: Number, default: 340 },
    resultTrend: {
        type: [{ year: String, pct: Number }],
        default: [
            { year: '2022', pct: 96 },
            { year: '2023', pct: 97 },
            { year: '2024', pct: 98 },
            { year: '2025', pct: 99 },
            { year: '2026', pct: 100 },
        ],
    },
    toppers: {
        type: [{ name: String, marks: String, cls: String, rank: Number }],
        default: [
            { name: 'Ananya Gupta', marks: '98.6%', cls: 'Class 12', rank: 1 },
            { name: 'Rahul Meena', marks: '97.8%', cls: 'Class 12', rank: 2 },
            { name: 'Simran Kaur', marks: '97.2%', cls: 'Class 10', rank: 3 },
        ],
    },
    testimonials: {
        type: [{ name: String, role: String, quote: String, rating: Number }],
        default: [
            { name: 'Meena Sharma', role: 'Parent, Class 8', quote: 'My daughter has grown so much in confidence. The teachers genuinely care about every child.', rating: 5 },
            { name: 'Rohit Verma', role: 'Parent, Class 10', quote: 'Best decision we made. Smart classrooms and regular progress updates keep us involved.', rating: 5 },
            { name: 'Priya Singh', role: 'Alumna, Batch 2022', quote: 'The foundation I got here shaped my entire career. Forever grateful to my teachers.', rating: 5 },
        ],
    },
    // `icon` is an emoji character (e.g. '💻'), not a MaterialCommunityIcons name —
    // the app renders it directly as text, picked from a fixed list in the admin UI.
    facilities: {
        type: [{ icon: String, title: String }],
        default: [
            { icon: '💻', title: 'Smart Classrooms' },
            { icon: '🧪', title: 'Science Labs' },
            { icon: '🏀', title: 'Sports Complex' },
            { icon: '🚌', title: 'Safe Transport' },
            { icon: '📷', title: '24/7 CCTV Surveillance' },
            { icon: '🛡️', title: 'Secure Campus' },
        ],
    },
    // Trust badges shown in a strip on the app homepage. Defaults are facts already
    // established elsewhere in this schema/app (affiliations, security, transport) —
    // deliberately not fabricated award/certification names with no backing data.
    // Update with real awards/certifications as the school earns them.
    // Every field besides `title` is optional — the app only renders whichever
    // fields are actually filled in per award, so a plain icon+title award still
    // works exactly as before.
    awards: {
        type: [{
            icon: String,          // MaterialCommunityIcons name, picked from a fixed list in the admin UI
            image: String,         // Cloudinary URL — shown instead of the icon badge when present
            title: String,
            description: String,
            highlights: [String],
            year: String,
        }],
        default: [
            { icon: 'shield-check', title: 'CBSE Affiliated' },
            { icon: 'shield-check', title: 'RBSE Affiliated' },
            { icon: 'cctv', title: '24/7 Secure Campus' },
            { icon: 'bus-school', title: 'Safe Transport' },
        ],
    },
}, { timestamps: true });

module.exports = mongoose.model('HomepageSettings', HomepageSettingsSchema);
