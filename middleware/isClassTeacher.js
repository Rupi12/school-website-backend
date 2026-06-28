/**
 * Middleware to enforce class teacher restrictions.
 * This ensures a teacher can only access data for their assigned class.
 */
const isClassTeacher = (req, res, next) => {
    // Superadmins can access anything.
    if (req.admin.role === 'superadmin') {
        return next();
    }

    const teacherClass = req.admin.assignedClass;
    const teacherSection = req.admin.assignedSection;

    // If the admin is not a designated class teacher, this middleware doesn't apply.
    // Their access will be determined by other permission middleware.
    if (!teacherClass) {
        return next();
    }

    // Get the class from the request (works for params or query strings).
    const requestedClass = req.params.class || req.query.class;

    // If the requested class does not match the teacher's assigned class, deny access.
    if (requestedClass && requestedClass !== teacherClass) {
        return res.status(403).json({ success: false, message: `Permission Denied. You can only access data for Class ${teacherClass}.` });
    }

    return next();
};

module.exports = isClassTeacher;