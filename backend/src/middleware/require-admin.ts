import type { NextFunction, Request, Response } from 'express';

/** Значення `Authorization` після успішного POST /admin/login */
export const ADMIN_AUTH_TOKEN = 'admin-authenticated';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization;
  if (token === ADMIN_AUTH_TOKEN) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
