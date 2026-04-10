"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminSessionRouter = createAdminSessionRouter;
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
function createAdminSessionRouter(options) {
    const r = express_1.default.Router();
    const { adminPassword } = options;
    r.post('/admin/login', async (req, res) => {
        const { password } = req.body;
        if (password === adminPassword) {
            res.json({ token: require_admin_1.ADMIN_AUTH_TOKEN, success: true });
        }
        else {
            res.status(401).json({ error: 'Невірний пароль' });
        }
    });
    r.get('/admin/check', require_admin_1.requireAdmin, (_req, res) => {
        res.json({ authenticated: true });
    });
    return r;
}
