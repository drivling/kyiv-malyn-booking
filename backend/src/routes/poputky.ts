/**
 * Маршрути сайту /poputky (тонкий шар поверх валідаторів).
 */
import crypto from 'crypto';
import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { resolvePoputkyOdPair } from '../poputky-od';
import { validatePoputkyAnnounceDraft } from '../validation/poputky-announce-draft';
import { setAnnounceDraft } from '../telegram';

export function createPoputkyRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  r.post('/announce-draft', express.json(), async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const from = (body.from ?? '').toString();
    const to = (body.to ?? '').toString();
    const od = await resolvePoputkyOdPair(prisma, from, to);
    if (!od.ok) {
      return res.status(400).json({ error: od.error });
    }

    const parsed = validatePoputkyAnnounceDraft(body, () => od.route);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }
    const v = parsed.value;
    const token = crypto.randomBytes(8).toString('hex');
    setAnnounceDraft(token, {
      role: v.role,
      route: v.route,
      fromPointId: od.from.id,
      toPointId: od.to.id,
      date: v.dateStr,
      departureTime: v.departureTime || undefined,
      notes: v.notes,
      priceUah: v.priceUah,
    });
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'malin_kiev_ua_bot';
    const deepLink = `https://t.me/${botUsername}?start=${v.role}_${token}`;
    return res.json({ token, deepLink });
  });

  return r;
}
