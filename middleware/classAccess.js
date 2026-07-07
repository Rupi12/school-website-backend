// Shared helpers for restricting a subadmin to specific classes.
// req.admin.allowedClasses is populated by middleware/auth.js. Only a superadmin
// is unrestricted — every other admin is scoped to exactly their allowedClasses
// list, so an empty/absent list means "no access to any class" (must be granted
// explicitly), not "access to everything".
function isRestricted(admin) {
    return admin.role !== 'superadmin';
}

// For list/aggregate endpoints: merges the admin's class restriction into a Mongo
// query's `class` condition. If the client also requested a specific class, that
// request is honored only if it's within the admin's allowed set (otherwise the
// query is forced to match nothing, rather than silently ignoring the restriction).
function applyClassScope(req, query, classFieldPath = 'class') {
    if (!isRestricted(req.admin)) return query;
    const allowed = req.admin.allowedClasses;
    const requested = query[classFieldPath];
    if (requested) {
        const requestedVal = typeof requested === 'string' ? requested : requested.$in;
        const allowedRequested = Array.isArray(requestedVal)
            ? requestedVal.filter((c) => allowed.includes(c))
            : (allowed.includes(requestedVal) ? [requestedVal] : []);
        query[classFieldPath] = allowedRequested.length ? { $in: allowedRequested } : '__no_class_access__';
    } else {
        query[classFieldPath] = { $in: allowed };
    }
    return query;
}

// For single-student action routes: throws-by-return-value style check. Pass the
// target student's class; returns true if the admin is allowed to act on it.
function canAccessClass(admin, studentClass) {
    if (!isRestricted(admin)) return true;
    return admin.allowedClasses.includes(studentClass);
}

// Express middleware for routes where the student's class can only be known by
// loading the student first (keyed by :id, :studentId, or body.studentId).
// `getStudentIdFn` extracts the id from req; defaults to the common param names.
function requireClassAccessForStudent(Student, getStudentIdFn) {
    return async (req, res, next) => {
        if (!isRestricted(req.admin)) return next();
        try {
            const studentId = getStudentIdFn
                ? getStudentIdFn(req)
                : (req.params.studentId || req.params.id || req.body.studentId);
            if (!studentId) return next(); // nothing to scope; route itself will 400 on missing id
            const student = await Student.findById(studentId).select('class').lean();
            if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
            if (!canAccessClass(req.admin, student.class)) {
                return res.status(403).json({ success: false, message: 'You do not have access to this student\'s class' });
            }
            next();
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    };
}

// For routes keyed by a record's own _id (Result/Fee/StudentDoc), where the
// student is only reachable via record.studentId. Loads the record, resolves
// its owning student's class, and stashes the record on req._classCheckedRecord
// so the route handler can reuse it instead of querying twice.
function requireClassAccessForRecord(RecordModel, Student, idParam = 'id') {
    return async (req, res, next) => {
        if (!isRestricted(req.admin)) return next();
        try {
            const record = await RecordModel.findById(req.params[idParam]);
            if (!record) return res.status(404).json({ success: false, message: 'Record not found' });
            const student = await Student.findById(record.studentId).select('class').lean();
            if (!student || !canAccessClass(req.admin, student.class)) {
                return res.status(403).json({ success: false, message: 'You do not have access to this student\'s class' });
            }
            req._classCheckedRecord = record;
            next();
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    };
}

module.exports = { isRestricted, applyClassScope, canAccessClass, requireClassAccessForStudent, requireClassAccessForRecord };
