import express, { type Router } from 'express';
import { ADMIN_AUTH_TOKEN, requireAdmin } from '../middleware/require-admin';

export function createAdminSessionRouter(options: { adminPassword: string }): Router {
  const r = express.Router();
  const { adminPassword } = options;

  r.post('/admin/login', async (req, res) => {
    const { password } = req.body;
    if (password === adminPassword) {
      res.json({ token: ADMIN_AUTH_TOKEN, success: true });
    } else {
      res.status(401).json({ error: 'Невірний пароль' });
    }
  });

  r.get('/admin/check', requireAdmin, (_req, res) => {
    res.json({ authenticated: true });
  });

  return r;
}
