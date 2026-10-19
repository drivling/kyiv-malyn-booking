"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createUserProfileRouter = createUserProfileRouter;
/**
 * `/user/*` — профіль людини, що увійшла через Telegram Login (сторінка `/user`).
 *
 * Хто ця людина — лише з підписаного заголовка `X-Telegram-Login` (`requireTelegramLogin`,
 * Docs/transport-open-data-2026-10.md, фаза 4): `telegramUserId` у query/body більше не читаємо, бо його
 * знає будь-хто. Експорт (`GET /user/export`) і видалення (`DELETE /user`) — «Дані належать людині», П4.
 */
const express_1 = __importDefault(require("express"));
const index_helpers_1 = require("../index-helpers");
const telegram_login_auth_1 = require("../telegram-login-auth");
const person_data_export_1 = require("../person-data-export");
const person_erase_1 = require("../person-erase");
function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}
function createUserProfileRouter(deps) {
    const { prisma } = deps;
    const now = deps.now ?? (() => new Date());
    const r = express_1.default.Router();
    const auth = (0, telegram_login_auth_1.requireTelegramLogin)({ botToken: deps.telegramBotToken, now: () => Math.floor(now().getTime() / 1000) });
    r.get('/user/profile', auth, async (_req, res) => {
        const telegramUserId = (0, telegram_login_auth_1.telegramLoginFromRes)(res).id;
        try {
            const person = await prisma.person.findFirst({ where: { telegramUserId } });
            const since = startOfToday();
            const [bookings, passengerListings, driverListings] = await Promise.all([
                prisma.booking.findMany({
                    where: { telegramUserId, date: { gte: since } },
                    orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
                }),
                person
                    ? prisma.viberListing.findMany({
                        where: { personId: person.id, listingType: 'passenger', isActive: true, date: { gte: since } },
                        orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
                    })
                    : [],
                person
                    ? prisma.viberListing.findMany({
                        where: { personId: person.id, listingType: 'driver', isActive: true, date: { gte: since } },
                        orderBy: [{ date: 'asc' }, { departureTime: 'asc' }],
                    })
                    : [],
            ]);
            const profile = {
                person: person
                    ? {
                        id: person.id,
                        fullName: person.fullName,
                        phoneNormalized: person.phoneNormalized,
                        telegramUserId: person.telegramUserId,
                    }
                    : null,
                bookings: bookings.map((b) => ({
                    id: b.id,
                    route: b.route,
                    date: b.date instanceof Date ? b.date.toISOString() : b.date,
                    departureTime: b.departureTime,
                    seats: b.seats,
                    name: b.name,
                    phone: b.phone,
                    source: b.source,
                    createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
                })),
                passengerListings: passengerListings.map((l) => (0, index_helpers_1.serializeViberListing)(l)),
                driverListings: driverListings.map((l) => (0, index_helpers_1.serializeViberListing)(l)),
            };
            res.json(profile);
        }
        catch (error) {
            console.error('❌ GET /user/profile:', error);
            res.status(500).json({ error: 'Failed to load profile' });
        }
    });
    r.put('/user/profile/name', auth, async (req, res) => {
        const telegramUserId = (0, telegram_login_auth_1.telegramLoginFromRes)(res).id;
        const { fullName } = req.body;
        try {
            const person = await prisma.person.findFirst({ where: { telegramUserId } });
            if (!person) {
                return res.status(404).json({ error: 'Профіль не знайдено. Підключіть номер телефону в боті.' });
            }
            const newName = fullName != null && String(fullName).trim() !== '' ? String(fullName).trim() : null;
            const displayName = newName ?? '';
            await prisma.$transaction([
                prisma.person.update({
                    where: { id: person.id },
                    data: { fullName: newName },
                }),
                prisma.booking.updateMany({
                    where: { personId: person.id },
                    data: { name: displayName },
                }),
                prisma.viberListing.updateMany({
                    where: { personId: person.id },
                    data: { senderName: newName },
                }),
            ]);
            res.json({ success: true, fullName: newName });
        }
        catch (error) {
            const err = error;
            if (err.code === 'P2025')
                return res.status(404).json({ error: 'Profile not found' });
            console.error('❌ PUT /user/profile/name:', error);
            res.status(500).json({ error: 'Failed to update name' });
        }
    });
    /** «Завантажити мої дані» — один JSON файлом (той самий збирач, що й /mydata у боті) */
    r.get('/user/export', auth, async (_req, res) => {
        const telegramUserId = (0, telegram_login_auth_1.telegramLoginFromRes)(res).id;
        try {
            const at = now();
            const data = await (0, person_data_export_1.collectPersonData)(prisma, { telegramUserId, now: at });
            if (!data) {
                return res.status(404).json({ error: 'Про вас у нас немає жодного запису — експортувати нічого.' });
            }
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${(0, person_data_export_1.personDataExportFileName)(at)}"`);
            res.setHeader('Cache-Control', 'no-store');
            res.send(JSON.stringify(data, null, 2));
        }
        catch (error) {
            console.error('❌ GET /user/export:', error);
            res.status(500).json({ error: 'Failed to export data' });
        }
    });
    /** «Видалити акаунт» — знеособлення (person-erase.ts); підтвердження — на сторінці, тіло `{ confirm: true }` */
    r.delete('/user', auth, async (req, res) => {
        const login = (0, telegram_login_auth_1.telegramLoginFromRes)(res);
        const body = (req.body ?? {});
        if (body.confirm !== true) {
            return res.status(400).json({ error: 'Підтвердіть видалення: { "confirm": true }' });
        }
        try {
            const result = await (0, person_erase_1.erasePerson)(prisma, { telegramUserId: login.id, now: now() });
            if (!result) {
                return res.status(404).json({ error: 'Про вас у нас немає жодного запису — видаляти нічого.' });
            }
            const summary = (0, person_erase_1.describeEraseResult)(result);
            if (deps.notifyAdmin) {
                await deps
                    .notifyAdmin(`🧹 <b>Людина видалила акаунт</b> (сайт): Person #${result.personId ?? '—'}, tg ${login.id}.\n${summary}`)
                    .catch((e) => console.error('❌ notifyAdmin (DELETE /user):', e));
            }
            res.json({ success: true, erasedAt: result.erasedAt.toISOString(), counts: result.counts, summary });
        }
        catch (error) {
            console.error('❌ DELETE /user:', error);
            res.status(500).json({ error: 'Failed to delete account' });
        }
    });
    return r;
}
