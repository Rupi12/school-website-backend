const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure storage
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'school-gallery',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        transformation: [{ width: 1200, height: 1200, crop: 'limit' }]
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }
});

// Storage for documents (PDF etc.)
const docStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: (req, file) => {
        const isPdf = file.mimetype === 'application/pdf';
        return {
            folder: isPdf ? 'school-news-pdf' : 'school-gallery',
            resource_type: 'auto',
            allowed_formats: isPdf ? ['pdf'] : ['jpg','jpeg','png','webp','gif'],
            public_id: isPdf ? `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, '')}` : undefined,
            format: isPdf ? 'pdf' : undefined
        };
    }
});

const uploadDoc = multer({
    storage: docStorage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

module.exports = { cloudinary, upload, uploadDoc };