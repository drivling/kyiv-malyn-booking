/**
 * Маршрути сайту /poputky (тонкий шар поверх валідаторів).
 */
import crypto from 'crypto';
import express, { type Router } from 'express';
import { mapFromToToRoute } from '../index-helpers';
import { validatePoputkyAnnounceDraft } from '../validation/poputky-announce-draft';
import { setAnnounceDraft } from '../telegram';

export function createPoputkyRouter(): Router {
  const r = express.Router();

  r.post('/announce-draft', express.json(), (req, res) => {
    const parsed = validatePoputkyAnnounceDraft(req.body, mapFromToToRoute);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }
    const v = parsed.value;
    const token = crypto.randomBytes(8).toString('hex');
    setAnnounceDraft(token, {
      role: v.role,
      route: v.route,
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
