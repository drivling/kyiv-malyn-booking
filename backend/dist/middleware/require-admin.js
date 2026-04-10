"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADMIN_AUTH_TOKEN = void 0;
exports.requireAdmin = requireAdmin;
/** Значення `Authorization` після успішного POST /admin/login */
exports.ADMIN_AUTH_TOKEN = 'admin-authenticated';
function requireAdmin(req, res, next) {
    const token = req.headers.authorization;
    if (token === exports.ADMIN_AUTH_TOKEN) {
        next();
    }
    else {
        res.status(401).json({ error: 'Unauthorized' });
    }
}
