const jwt = require('jsonwebtoken');

function auth(req, res, next) {
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
        req.admin = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ 
            success: false, 
            message: 'Token is not valid: ' + error.message 
        });
    }
}

module.exports = auth;