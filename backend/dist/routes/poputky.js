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
function createPoputkyRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
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
