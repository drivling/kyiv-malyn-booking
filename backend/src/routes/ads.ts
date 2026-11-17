/**
 * Облік реклами «Доведе» (ad-events.ts, Docs/dovede-roadmap.md, «Облік реклами»):
 * - POST /ads/events — подія перегляду з браузера (публічний, як скани наклейок; повтор viewId + event — 200 без запису);
 *   досмотрений тизер перед табло позначається й у людини з наклейок (StickerPerson.teaserAt, src/sticker-people.ts);
 *   `page` (відкрив /dovede з доступом) приймається лише із заголовком доступу «Доведе» чи адміна — інакше 403;
 *   `punched` (прокомпостував талон після ролика /dovede) — без доступу, але з тим самим «хто», якщо заголовок є;
 * - GET /ads/wall?key=&city= — зведення для стіни наклейок (вкладка «Реклама»), той самий ключ стіни, що й
 *   GET /transport/sticker-wall (лише читання, HMAC від ADMIN_PASSWORD).
 */
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { adWallSnapshot, deviceOf, parseAdEvent } from '../ad-events';
import { type DovedeAccessConfig, dovedeAccessFromEnv, dovedeAccessKind } from '../dovede/access';
import { recordPersonTeaser } from '../sticker-people';
import { isStickerWallKey } from '../sticker-wall';
import { DEFAULT_TRANSPORT_CITY, parseTransportCity } from '../transport-city';

export function createAdsRouter(deps: { prisma: PrismaClient; adminPassword: string; access?: DovedeAccessConfig }): Router {
  const r = Router();
  const access = deps.access ?? dovedeAccessFromEnv();

  r.post('/ads/events', async (req, res, next) => {
    try {
      const ev = parseAdEvent(req.body);
      if (!ev) {
        res.status(400).json({ error: 'Invalid ad event' });
        return;
      }
      const cityCode = ev.placement === 'sticker' ? parseTransportCity(req.body?.city) : DEFAULT_TRANSPORT_CITY;
      if (!cityCode) {
        res.status(404).json({ error: 'Unknown city' });
        return;
      }
      let kind: string | null = null;
      if (ev.event === 'page') {
        kind = dovedeAccessKind(req, access);
        if (!kind) {
          res.status(403).json({ error: 'No access to Dovede' });
          return;
        }
      } else if (ev.event === 'punched') {
        kind = dovedeAccessKind(req, access);
      }
      try {
        await deps.prisma.adEvent.create({ data: { ...ev, cityCode, access: kind, device: deviceOf(req.headers['user-agent']) } });
      } catch (e) {
        if ((e as { code?: string })?.code !== 'P2002') throw e;
        res.json({ ok: true, counted: false });
        return;
      }
      if (ev.placement === 'sticker' && ev.event === 'completed' && ev.clientId) {
        await recordPersonTeaser(deps.prisma, { cityCode, clientId: ev.clientId }).catch((e) => console.error('[POST /ads/events] person', e));
      }
      res.status(201).json({ ok: true, counted: true });
    } catch (e) {
      next(e);
    }
  });

  r.get('/ads/wall', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      if (!isStickerWallKey(req.query.key, deps.adminPassword)) {
        res.status(403).json({ error: 'Invalid wall key' });
        return;
      }
      const cityCode = parseTransportCity(req.query.city);
      if (!cityCode) {
        res.status(404).json({ error: 'Unknown city' });
        return;
      }
      res.json(await adWallSnapshot(deps.prisma, { cityCode }));
    } catch (e) {
      next(e);
    }
  });

  return r;
}
