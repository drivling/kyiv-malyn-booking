"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSiteSettingsRouter = createSiteSettingsRouter;
/**
 * Налаштування сайту з адмінки (не лише «Доведе»). Поки — телефони «Зубастика» (`zubastyk-phones.ts`):
 * `GET /site/zubastyk-phones` — для всіх сторінок і збірки статичних (кеш 5 хв), `GET` / `PUT
 * /admin/site/zubastyk-phones` — власнику (`{ phones: [{ phone, note? }] }` або `{ reset: true }`).
 */
const express_1 = __importDefault(require("express"));
const require_admin_1 = require("../middleware/require-admin");
const zubastyk_phones_1 = require("../zubastyk-phones");
function createSiteSettingsRouter(deps) {
    const store = deps.zubastykPhones ?? (0, zubastyk_phones_1.createZubastykPhonesStore)(deps.prisma);
    // без спільного сховища (тести, інший процес) — прочитати базу один раз, при першому запиті
    let loaded = deps.zubastykPhones ? Promise.resolve() : null;
    const ready = () => (loaded ?? (loaded = store.refresh()));
    const r = express_1.default.Router();
    r.get('/site/zubastyk-phones', async (_req, res) => {
        await ready();
        res.set('Cache-Control', 'public, max-age=300');
        res.json({ phones: store.view().phones });
    });
    r.get('/admin/site/zubastyk-phones', require_admin_1.requireAdmin, async (_req, res) => {
        await ready();
        res.set('Cache-Control', 'private, no-store');
        res.json(store.view());
    });
    r.put('/admin/site/zubastyk-phones', require_admin_1.requireAdmin, async (req, res) => {
        const b = (req.body ?? {});
        if (b.reset !== true && !Array.isArray(b.phones)) {
            res.status(400).json({ error: 'потрібні phones: [{ phone, note? }] або reset: true' });
            return;
        }
        try {
            res.json(await store.set(b.reset === true ? null : b.phones));
        }
        catch (e) {
            if (e instanceof RangeError) {
                res.status(400).json({ error: e.message });
                return;
            }
            console.error('❌ PUT /admin/site/zubastyk-phones:', e);
            res.status(500).json({ error: 'Не вдалося зберегти' });
        }
    });
    return r;
}
