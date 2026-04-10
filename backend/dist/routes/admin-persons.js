"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminPersonsRouter = createAdminPersonsRouter;
const express_1 = __importDefault(require("express"));
const telegram_1 = require("../telegram");
const require_admin_1 = require("../middleware/require-admin");
function createAdminPersonsRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    r.post('/admin/person', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const { phone, fullName } = req.body;
            const rawPhone = typeof phone === 'string' ? phone.trim() : '';
            const rawName = typeof fullName === 'string' ? fullName.trim() : '';
            if (!rawPhone) {
                res.status(400).json({ error: 'Потрібен номер телефону' });
                return;
            }
            if (!rawName) {
                res.status(400).json({ error: 'Потрібне ім\'я' });
                return;
            }
            const person = await (0, telegram_1.findOrCreatePersonByPhone)(rawPhone, { fullName: rawName });
            res.json(person);
        }
        catch (e) {
            console.error('❌ POST /admin/person:', e);
            res.status(500).json({ error: 'Не вдалося створити контакт' });
        }
    });
    /** Список Person для управління даними. Query: ?search= — пошук по телефону або імені. */
    r.get('/admin/persons', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const search = req.query.search?.trim() || '';
            const where = search
                ? {
                    OR: [
                        { phoneNormalized: { contains: search.replace(/\D/g, '') } },
                        { fullName: { contains: search, mode: 'insensitive' } },
                    ],
                }
                : {};
            const persons = await prisma.person.findMany({
                where,
                orderBy: { id: 'asc' },
                include: {
                    _count: { select: { bookings: true, viberListings: true } },
                },
            });
            res.json(persons);
        }
        catch (e) {
            console.error('❌ GET /admin/persons:', e);
            res.status(500).json({ error: 'Не вдалося завантажити список персон' });
        }
    });
    /** Оновити імена персон: спочатку по боту, потім по номеру (ваш акаунт), потім через Opendatabot. Якщо імені не було — заповнити будь-яким; інакше вибрати найдовше кириличне серед усіх. onlyEmpty: true — лише персони без імені в базі. onlyLatin: true — лише персони з іменем, де немає кирилиці (латиниця). */
    r.post('/admin/persons/refresh-names', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const body = (req.body || {});
            const personIds = Array.isArray(body.personIds) ? body.personIds.filter((id) => Number.isInteger(id) && id > 0) : undefined;
            const onlyEmpty = body.onlyEmpty === true;
            const onlyLatin = body.onlyLatin === true;
            const emptyNameCondition = { OR: [{ fullName: null }, { fullName: '' }] };
            const where = onlyEmpty && personIds && personIds.length > 0
                ? { id: { in: personIds }, ...emptyNameCondition }
                : onlyEmpty
                    ? emptyNameCondition
                    : personIds && personIds.length > 0
                        ? { id: { in: personIds } }
                        : {};
            let persons = await prisma.person.findMany({
                where,
                orderBy: { id: 'asc' },
            });
            const totalPersons = persons.length;
            if (onlyEmpty) {
                persons = persons.filter((p) => !p.fullName || !p.fullName.trim());
            }
            let latinCandidates = 0;
            if (onlyLatin) {
                latinCandidates = persons.filter((p) => p.fullName && p.fullName.trim() && !(0, telegram_1.hasCyrillic)(p.fullName)).length;
                persons = persons.filter((p) => p.fullName && p.fullName.trim() && !(0, telegram_1.hasCyrillic)(p.fullName));
            }
            console.log(`[refresh-names] Старт: total=${totalPersons}, latinCandidates=${latinCandidates}, для_перевірки=${persons.length}` +
                `${onlyEmpty ? ' (onlyEmpty)' : ''}` +
                `${onlyLatin ? ' (onlyLatin)' : ''}`);
            const changes = [];
            let updated = 0;
            let skipped = 0;
            const errors = [];
            for (const p of persons) {
                try {
                    const { nameFromBot, nameFromUser, nameFromOpendatabot } = await (0, telegram_1.getResolvedNameForPerson)(p.phoneNormalized, p.telegramChatId);
                    const currentName = p.fullName?.trim() || null;
                    const { newName, source } = (0, telegram_1.pickBestNameFromCandidates)(currentName, nameFromBot, nameFromUser, nameFromOpendatabot);
                    console.log(`[refresh-names] #${p.id} ${p.phoneNormalized}: поточне="${currentName ?? ''}" | бот="${nameFromBot ?? ''}" | по_номеру="${nameFromUser ?? ''}" | opendatabot="${nameFromOpendatabot ?? ''}" → обрано="${newName ?? ''}" (${source ?? '—'})`);
                    if (newName !== currentName && newName) {
                        await prisma.person.update({
                            where: { id: p.id },
                            data: { fullName: newName },
                        });
                        await prisma.booking.updateMany({ where: { personId: p.id }, data: { name: newName } });
                        await prisma.viberListing.updateMany({ where: { personId: p.id }, data: { senderName: newName } });
                        updated++;
                        changes.push({ personId: p.id, phone: p.phoneNormalized, oldName: currentName, newName, source });
                        console.log(`[refresh-names] #${p.id} оновлено: "${currentName ?? ''}" → "${newName}" (${source})`);
                    }
                    else {
                        skipped++;
                    }
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    errors.push(`#${p.id} ${p.phoneNormalized}: ${msg}`);
                    console.error(`[refresh-names] #${p.id} ${p.phoneNormalized} помилка:`, msg);
                }
            }
            console.log(`[refresh-names] Підсумок: total=${persons.length}, updated=${updated}, skipped=${skipped}, errors=${errors.length}`);
            res.json({
                total: persons.length,
                updated,
                skipped,
                errors: errors.length > 0 ? errors : undefined,
                changes,
            });
        }
        catch (e) {
            console.error('❌ POST /admin/persons/refresh-names:', e);
            res.status(500).json({ error: 'Не вдалося оновити імена' });
        }
    });
    /** Перевірити номера: знайти персон без telegramChatId, спробувати ResolvePhone і оновити telegramUsername. */
    r.post('/admin/persons/check-usernames', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const persons = await prisma.person.findMany({
                where: {
                    telegramChatId: null,
                    OR: [{ telegramUsername: null }, { telegramUsername: '' }],
                },
                orderBy: { id: 'asc' },
            });
            let updated = 0;
            const errors = [];
            for (const p of persons) {
                try {
                    const username = await (0, telegram_1.resolveUsernameByPhoneFromTelegram)(p.phoneNormalized);
                    if (username?.trim()) {
                        await prisma.person.update({
                            where: { id: p.id },
                            data: { telegramUsername: username.trim() },
                        });
                        updated++;
                        console.log(`[check-usernames] #${p.id} ${p.phoneNormalized} → @${username}`);
                    }
                    // Пауза між запитами, щоб не перевищити rate limit
                    await new Promise((r) => setTimeout(r, 1500));
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    errors.push(`#${p.id} ${p.phoneNormalized}: ${msg}`);
                }
            }
            console.log(`[check-usernames] Підсумок: total=${persons.length}, updated=${updated}`);
            res.json({ total: persons.length, updated, errors: errors.length > 0 ? errors : undefined });
        }
        catch (e) {
            console.error('❌ POST /admin/persons/check-usernames:', e);
            res.status(500).json({ error: 'Не вдалося перевірити номера' });
        }
    });
    /** Одна персона за id. */
    r.get('/admin/persons/:id', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (Number.isNaN(id)) {
                res.status(400).json({ error: 'Невірний id' });
                return;
            }
            const person = await prisma.person.findUnique({
                where: { id },
                include: {
                    _count: { select: { bookings: true, viberListings: true } },
                },
            });
            if (!person) {
                res.status(404).json({ error: 'Персону не знайдено' });
                return;
            }
            res.json(person);
        }
        catch (e) {
            console.error('❌ GET /admin/persons/:id:', e);
            res.status(500).json({ error: 'Не вдалося завантажити персону' });
        }
    });
    /** Оновити персону. При зміні телефону або імені оновлюються пов’язані Booking (phone, name) та ViberListing (phone, senderName). */
    r.put('/admin/persons/:id', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (Number.isNaN(id)) {
                res.status(400).json({ error: 'Невірний id' });
                return;
            }
            const body = req.body;
            const person = await prisma.person.findUnique({ where: { id } });
            if (!person) {
                res.status(404).json({ error: 'Персону не знайдено' });
                return;
            }
            const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : (typeof body.phoneNormalized === 'string' ? body.phoneNormalized.trim() : '');
            const newPhoneNormalized = rawPhone ? (0, telegram_1.normalizePhone)(rawPhone) : person.phoneNormalized;
            const newFullName = body.fullName !== undefined ? (typeof body.fullName === 'string' ? body.fullName.trim() || null : null) : person.fullName;
            const newTelegramChatId = body.telegramChatId !== undefined ? (body.telegramChatId === '' ? null : body.telegramChatId) : person.telegramChatId;
            const newTelegramUserId = body.telegramUserId !== undefined ? (body.telegramUserId === '' ? null : body.telegramUserId) : person.telegramUserId;
            const newTelegramUsername = body.telegramUsername !== undefined ? (body.telegramUsername === '' ? null : body.telegramUsername) : person.telegramUsername;
            let newTelegramPromoSentAt = person.telegramPromoSentAt;
            if (body.telegramPromoSentAt !== undefined) {
                if (body.telegramPromoSentAt === null || body.telegramPromoSentAt === '') {
                    newTelegramPromoSentAt = null;
                }
                else {
                    const parsed = new Date(body.telegramPromoSentAt);
                    newTelegramPromoSentAt = Number.isNaN(parsed.getTime()) ? person.telegramPromoSentAt : parsed;
                }
            }
            let newTelegramReminderSentAt = person.telegramReminderSentAt;
            if (body.telegramReminderSentAt !== undefined) {
                if (body.telegramReminderSentAt === null || body.telegramReminderSentAt === '') {
                    newTelegramReminderSentAt = null;
                }
                else {
                    const parsed = new Date(body.telegramReminderSentAt);
                    newTelegramReminderSentAt = Number.isNaN(parsed.getTime()) ? person.telegramReminderSentAt : parsed;
                }
            }
            if (!newPhoneNormalized) {
                res.status(400).json({ error: 'Телефон не може бути порожнім' });
                return;
            }
            const phoneChanged = newPhoneNormalized !== person.phoneNormalized;
            const nameChanged = newFullName !== person.fullName;
            const updated = await prisma.person.update({
                where: { id },
                data: {
                    phoneNormalized: newPhoneNormalized,
                    fullName: newFullName,
                    telegramChatId: newTelegramChatId,
                    telegramUserId: newTelegramUserId,
                    telegramUsername: newTelegramUsername,
                    telegramPromoSentAt: newTelegramPromoSentAt,
                    telegramReminderSentAt: newTelegramReminderSentAt,
                },
            });
            if (phoneChanged || nameChanged) {
                const bookingData = {};
                if (phoneChanged)
                    bookingData.phone = newPhoneNormalized;
                if (nameChanged)
                    bookingData.name = newFullName ?? '';
                const viberData = {};
                if (phoneChanged)
                    viberData.phone = newPhoneNormalized;
                if (nameChanged)
                    viberData.senderName = newFullName;
                const [bookingsUpdated, viberUpdated] = await Promise.all([
                    Object.keys(bookingData).length > 0
                        ? prisma.booking.updateMany({ where: { personId: id }, data: bookingData })
                        : Promise.resolve({ count: 0 }),
                    Object.keys(viberData).length > 0
                        ? prisma.viberListing.updateMany({ where: { personId: id }, data: viberData })
                        : Promise.resolve({ count: 0 }),
                ]);
                if (bookingsUpdated.count > 0 || viberUpdated.count > 0) {
                    console.log(`📝 Оновлено персону #${id}: booking.count=${bookingsUpdated.count}, viberListing.count=${viberUpdated.count}`);
                }
            }
            res.json(updated);
        }
        catch (e) {
            console.error('❌ PUT /admin/persons/:id:', e);
            res.status(500).json({ error: 'Не вдалося оновити персону' });
        }
    });
    /** Видалити персону та всі залежні записи по personId (Booking, ViberListing, ViberRideEvent). */
    r.delete('/admin/persons/:id', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (Number.isNaN(id)) {
                res.status(400).json({ error: 'Невірний id' });
                return;
            }
            const result = await prisma.$transaction(async (tx) => {
                const person = await tx.person.findUnique({ where: { id } });
                if (!person)
                    return null;
                const [bookingsDeleted, viberListingsDeleted, viberRideEventsDeleted] = await Promise.all([
                    tx.booking.deleteMany({ where: { personId: id } }),
                    tx.viberListing.deleteMany({ where: { personId: id } }),
                    tx.viberRideEvent.deleteMany({ where: { personId: id } }),
                ]);
                await tx.person.delete({ where: { id } });
                return {
                    id,
                    deleted: {
                        bookings: bookingsDeleted.count,
                        viberListings: viberListingsDeleted.count,
                        viberRideEvents: viberRideEventsDeleted.count,
                    },
                };
            });
            if (!result) {
                res.status(404).json({ error: 'Персону не знайдено' });
                return;
            }
            console.log(`🗑️ Видалено персону #${result.id}: booking.count=${result.deleted.bookings}, viberListing.count=${result.deleted.viberListings}, viberRideEvent.count=${result.deleted.viberRideEvents}`);
            res.json(result);
        }
        catch (e) {
            console.error('❌ DELETE /admin/persons/:id:', e);
            res.status(500).json({ error: 'Не вдалося видалити персону' });
        }
    });
    return r;
}
