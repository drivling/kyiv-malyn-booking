import express, { type Router } from 'express';
import { adminAuthToken, requireAdmin, safeEqual } from '../middleware/require-admin';

export function createAdminSessionRouter(options: { adminPassword: string }): Router {
  const r = express.Router();
  const { adminPassword } = options;
  const token = adminAuthToken(adminPassword);

  r.post('/admin/login', async (req, res) => {
    const { password } = req.body ?? {};
    if (safeEqual(password, adminPassword)) {
      res.json({ token, success: true });
    } else {
      res.status(401).json({ error: 'Невірний пароль' });
    }
  });

  r.get('/admin/check', requireAdmin, (_req, res) => {
    res.json({ authenticated: true });
  });

  return r;
}
