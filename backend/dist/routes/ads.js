"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdsRouter = createAdsRouter;
/**
 * Облік реклами «Доведе» (ad-events.ts, Docs/dovede-roadmap.md, «Облік реклами»):
 * - POST /ads/events — подія перегляду з браузера (публічний, як скани наклейок; повтор viewId + event — 200 без запису);
 *   `page` (відкрив /dovede з доступом) приймається лише із заголовком доступу «Доведе» чи адміна — інакше 403;
 * - GET /ads/wall?key=&city= — зведення для стіни наклейок (вкладка «Реклама»), той самий ключ стіни, що й
 *   GET /transport/sticker-wall (лише читання, HMAC від ADMIN_PASSWORD).
 */
const express_1 = require("express");
const ad_events_1 = require("../ad-events");
const access_1 = require("../dovede/access");
const sticker_wall_1 = require("../sticker-wall");
const transport_city_1 = require("../transport-city");
function createAdsRouter(deps) {
    const r = (0, express_1.Router)();
    const access = deps.access ?? (0, access_1.dovedeAccessFromEnv)();
    r.post('/ads/events', async (req, res, next) => {
        try {
            const ev = (0, ad_events_1.parseAdEvent)(req.body);
            if (!ev) {
                res.status(400).json({ error: 'Invalid ad event' });
                return;
            }
            const cityCode = ev.placement === 'sticker' ? (0, transport_city_1.parseTransportCity)(req.body?.city) : transport_city_1.DEFAULT_TRANSPORT_CITY;
            if (!cityCode) {
                res.status(404).json({ error: 'Unknown city' });
                return;
            }
            let kind = null;
            if (ev.event === 'page') {
                kind = (0, access_1.dovedeAccessKind)(req, access);
                if (!kind) {
                    res.status(403).json({ error: 'No access to Dovede' });
                    return;
                }
            }
            try {
                await deps.prisma.adEvent.create({ data: { ...ev, cityCode, access: kind, device: (0, ad_events_1.deviceOf)(req.headers['user-agent']) } });
            }
            catch (e) {
                if (e?.code !== 'P2002')
                    throw e;
                res.json({ ok: true, counted: false });
                return;
            }
            res.status(201).json({ ok: true, counted: true });
        }
        catch (e) {
            next(e);
        }
    });
    r.get('/ads/wall', async (req, res, next) => {
        try {
            res.set('Cache-Control', 'no-store');
            if (!(0, sticker_wall_1.isStickerWallKey)(req.query.key, deps.adminPassword)) {
                res.status(403).json({ error: 'Invalid wall key' });
                return;
            }
            const cityCode = (0, transport_city_1.parseTransportCity)(req.query.city);
            if (!cityCode) {
                res.status(404).json({ error: 'Unknown city' });
                return;
            }
            res.json(await (0, ad_events_1.adWallSnapshot)(deps.prisma, { cityCode }));
        }
        catch (e) {
            next(e);
        }
    });
    return r;
}
