/**
 * Маршрути сайту /poputky (тонкий шар поверх валідаторів).
 */
import crypto from 'crypto';
import express, { type Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { resolvePoputkyOdPair } from '../poputky-od';
import { validatePoputkyAnnounceDraft } from '../validation/poputky-announce-draft';
import { setAnnounceDraft } from '../telegram';
import { DATE_RE, searchPoputky } from '../poputky-search';

export function createPoputkyRouter(deps: { prisma: PrismaClient }): Router {
  const { prisma } = deps;
  const r = express.Router();

  /**
   * GET /poputky/search?from=Kyiv&to=Malyn&date=YYYY-MM-DD — попутки + розклад + вільні місця
   * одним запитом. Публічний, без телефонів. Короткий public cache: повторний клік «Оновити»
   * і однакові пошуки різних людей не б'ють у БД.
   */
  r.get('/search', async (req, res) => {
    const from = String(req.query.from ?? '').trim();
    const to = String(req.query.to ?? '').trim();
    const date = String(req.query.date ?? '').trim();
    if (!from || !to || !DATE_RE.test(date)) {
      return res.status(400).json({ error: 'from, to та date (YYYY-MM-DD) обов\'язкові' });
    }
    try {
      const result = await searchPoputky(prisma, { fromCode: from, toCode: to, date });
      res.set('Cache-Control', 'public, max-age=20');
      if (!result) {
        return res.json({ from: null, to: null, date, listings: [], schedules: [], availability: {} });
      }
      return res.json(result);
    } catch (error) {
      console.error('❌ /poputky/search:', error);
      return res.status(500).json({ error: 'Не вдалося виконати пошук' });
    }
  });

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
