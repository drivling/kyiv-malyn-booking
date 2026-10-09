"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPoputkyRouter = createPoputkyRouter;
/**
 * Маршрути сайту /poputky (тонкий шар поверх валідаторів).
 */
const crypto_1 = __importDefault(require("crypto"));
const express_1 = __importDefault(require("express"));
const poputky_od_1 = require("../poputky-od");
const poputky_announce_draft_1 = require("../validation/poputky-announce-draft");
const telegram_1 = require("../telegram");
const poputky_search_1 = require("../poputky-search");
function createPoputkyRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    /**
     * GET /poputky/search?from=Kyiv&to=Malyn&date=YYYY-MM-DD — попутки + розклад + вільні місця
     * одним запитом. Публічний, без телефонів. Короткий public cache: повторний клік «Оновити»
     * і однакові пошуки різних людей не б'ють у БД.
     */
    r.get('/search', async (req, res) => {
        const from = String(req.query.from ?? '').trim();
        const to = String(req.query.to ?? '').trim();
        const date = String(req.query.date ?? '').trim();
        if (!from || !to || !poputky_search_1.DATE_RE.test(date)) {
            return res.status(400).json({ error: 'from, to та date (YYYY-MM-DD) обов\'язкові' });
        }
        try {
            const result = await (0, poputky_search_1.searchPoputky)(prisma, { fromCode: from, toCode: to, date });
            res.set('Cache-Control', 'public, max-age=20');
            if (!result) {
                return res.json({ from: null, to: null, date, listings: [], schedules: [], availability: {} });
            }
            return res.json(result);
        }
        catch (error) {
            console.error('❌ /poputky/search:', error);
            return res.status(500).json({ error: 'Не вдалося виконати пошук' });
        }
    });
    r.post('/announce-draft', express_1.default.json(), async (req, res) => {
        const body = (req.body ?? {});
        const from = (body.from ?? '').toString();
        const to = (body.to ?? '').toString();
        const od = await (0, poputky_od_1.resolvePoputkyOdPair)(prisma, from, to);
        if (!od.ok) {
            return res.status(400).json({ error: od.error });
        }
        const parsed = (0, poputky_announce_draft_1.validatePoputkyAnnounceDraft)(body, () => od.route);
        if (!parsed.ok) {
            return res.status(400).json({ error: parsed.error });
        }
        const v = parsed.value;
        const token = crypto_1.default.randomBytes(8).toString('hex');
        (0, telegram_1.setAnnounceDraft)(token, {
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
