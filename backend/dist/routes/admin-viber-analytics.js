"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminViberAnalyticsRouter = createAdminViberAnalyticsRouter;
const express_1 = __importDefault(require("express"));
const telegram_1 = require("../telegram");
const telegram_bot_blocked_1 = require("../telegram-bot-blocked");
const index_helpers_1 = require("../index-helpers");
const phonecheck_1 = require("../phonecheck");
const require_admin_1 = require("../middleware/require-admin");
function createAdminViberAnalyticsRouter(deps) {
    const { prisma } = deps;
    const r = express_1.default.Router();
    r.post('/admin/viber-analytics/import', require_admin_1.requireAdmin, async (_req, res) => {
        try {
            // Які ViberListing вже імпортовані в ViberRideEvent (по viberRideId)
            const existing = await prisma.viberRideEvent.findMany({
                select: { viberRideId: true },
            });
            const importedIds = new Set(existing.map((r) => r.viberRideId));
            // Читаємо всі (або більшість) записів з ViberListing
            const rows = (await prisma.viberListing.findMany({
                orderBy: { id: 'asc' },
            }));
            const newRows = rows.filter((r) => !importedIds.has(r.id));
            if (newRows.length === 0) {
                const totalEvents = await prisma.viberRideEvent.count();
                return res.json({
                    success: true,
                    totalSource: rows.length,
                    alreadyImported: rows.length,
                    importedNow: 0,
                    message: 'Нових записів ViberRide немає — все вже імпортовано раніше.',
                    totalListings: rows.length,
                    totalEvents,
                });
            }
            const toInsert = [];
            for (const r of newRows) {
                const rawPhone = (r.phone ?? '').trim();
                const normalized = rawPhone ? (0, telegram_1.normalizePhone)(rawPhone) : '';
                let weekday = null;
                let hour = null;
                if (r.date instanceof Date) {
                    // JS: 0 = неділя ... 6 = субота
                    weekday = r.date.getDay();
                }
                if (r.departureTime) {
                    const timePart = r.departureTime.split('-')[0].trim();
                    const [hStr] = timePart.split(':');
                    const hNum = parseInt(hStr, 10);
                    if (!Number.isNaN(hNum) && hNum >= 0 && hNum <= 23) {
                        hour = hNum;
                    }
                }
                const phoneNormalized = normalized || rawPhone || '';
                const personId = r.personId ?? null;
                toInsert.push({
                    viberRideId: r.id,
                    contactPhone: rawPhone || phoneNormalized,
                    phoneNormalized,
                    personId,
                    route: r.route ?? null,
                    departureDate: r.date ?? null,
                    departureTime: r.departureTime ?? null,
                    availableSeats: r.seats ?? null,
                    priceUah: r.priceUah ?? null,
                    isParsed: true,
                    isActive: r.isActive ?? null,
                    parsingErrors: null,
                    weekday,
                    hour,
                    createdAt: r.createdAt ?? new Date(),
                });
            }
            let created = 0;
            const chunkSize = 500;
            for (let i = 0; i < toInsert.length; i += chunkSize) {
                const chunk = toInsert.slice(i, i + chunkSize);
                if (!chunk.length)
                    continue;
                const result = await prisma.viberRideEvent.createMany({
                    data: chunk,
                    skipDuplicates: true,
                });
                created += result.count;
            }
            // Після імпорту чистимо джерело: видаляємо записи старше ніж "дата запиту - 1 місяць".
            // У поточній схемі історія "ViberRide" зберігається в таблиці ViberListing (поле date = дата поїздки).
            const requestDate = new Date();
            const cutoff = new Date(requestDate);
            cutoff.setMonth(cutoff.getMonth() - 1);
            const deletedOldSource = await prisma.viberListing.deleteMany({
                where: {
                    date: { lt: cutoff },
                },
            });
            const totalEvents = await prisma.viberRideEvent.count();
            res.json({
                success: true,
                totalSource: rows.length,
                alreadyImported: rows.length - newRows.length,
                importedNow: created,
                totalListings: rows.length,
                totalEvents,
                deletedSourceOld: deletedOldSource.count,
                sourceCleanupBefore: cutoff.toISOString(),
            });
        }
        catch (e) {
            console.error('❌ Помилка імпорту з ViberRide в ViberRideEvent:', e);
            res.status(500).json({
                error: 'Не вдалося імпортувати історичні ViberRide дані. Переконайтеся, що таблиця "ViberRide" існує і має очікувані колонки.',
            });
        }
    });
    // Аналіз телефонів через phonecheck.top: для кожного телефону дивимося, чи є дані (ігноруємо "Данные не найдены").
    r.post('/admin/phonecheck/analyze', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const body = (req.body || {});
            const rawPhones = Array.isArray(body.phones) ? body.phones : [];
            const uniquePhones = Array.from(new Set(rawPhones
                .map((p) => (typeof p === 'string' ? p.trim() : ''))
                .filter((p) => p.length > 0)));
            if (uniquePhones.length === 0) {
                return res.status(400).json({ error: 'Потрібен масив phones' });
            }
            const results = [];
            for (const phone of uniquePhones) {
                const result = await (0, phonecheck_1.runPhoneCheckForPhone)(phone);
                if (result) {
                    results.push(result);
                }
            }
            const withDataCount = results.filter((r) => r.hasData).length;
            console.log(`[phonecheck] analyze: totalPhones=${uniquePhones.length}, results=${results.length}, withData=${withDataCount}`);
            for (const r of results) {
                console.log(`[phonecheck] ${r.phone}: ${r.hasData ? 'HAS_DATA' : 'NO_DATA'}`);
            }
            res.json({
                total: uniquePhones.length,
                withData: withDataCount,
                results,
            });
        }
        catch (e) {
            console.error('❌ POST /admin/phonecheck/analyze:', e);
            res.status(500).json({ error: 'Не вдалося виконати аналіз phonecheck.top' });
        }
    });
    // Аналітика поведінки клієнтів на основі ViberRideEvent.
    // Повертає до N клієнтів з найбільшою кількістю поїздок та коротким описом патернів.
    r.get('/admin/viber-analytics/summary', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const pageParam = Number(req.query.page);
            const pageSizeParam = Number(req.query.pageSize ?? req.query.limit);
            const minRidesParam = Number(req.query.minRides);
            const pageSize = Number.isFinite(pageSizeParam) && pageSizeParam > 0
                ? Math.min(200, Math.max(10, Math.floor(pageSizeParam)))
                : 50;
            const requestedPage = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
            const minRides = Number.isFinite(minRidesParam) && minRidesParam > 0
                ? Math.floor(minRidesParam)
                : 3;
            const grouped = await prisma.viberRideEvent.groupBy({
                by: ['phoneNormalized'],
                _count: { _all: true },
                where: {
                    phoneNormalized: { not: '' },
                    isParsed: true,
                },
            });
            const filteredTop = grouped
                .filter((t) => t._count._all >= minRides)
                .sort((a, b) => b._count._all - a._count._all);
            const total = filteredTop.length;
            if (total === 0) {
                return res.json({
                    clients: [],
                    total: 0,
                    page: 1,
                    pageSize,
                    totalPages: 0,
                });
            }
            const totalPages = Math.max(1, Math.ceil(total / pageSize));
            const page = Math.min(Math.max(requestedPage, 1), totalPages);
            const startIndex = (page - 1) * pageSize;
            const pageSlice = filteredTop.slice(startIndex, startIndex + pageSize);
            if (pageSlice.length === 0) {
                return res.json({
                    clients: [],
                    total,
                    page,
                    pageSize,
                    totalPages,
                });
            }
            const phones = pageSlice.map((t) => t.phoneNormalized);
            const [events, persons] = await Promise.all([
                prisma.viberRideEvent.findMany({
                    where: { phoneNormalized: { in: phones } },
                    orderBy: { departureDate: 'asc' },
                }),
                prisma.person.findMany({
                    where: { phoneNormalized: { in: phones } },
                    select: {
                        id: true,
                        phoneNormalized: true,
                        fullName: true,
                        telegramChatId: true,
                        telegramPromoSentAt: true,
                    },
                }),
            ]);
            // Мапимо id оголошення ViberListing → тип (водій/пасажир), щоб розрізняти ролі
            const listingIdsSet = new Set();
            for (const ev of events) {
                if (typeof ev.viberRideId === 'number') {
                    listingIdsSet.add(ev.viberRideId);
                }
            }
            const listingIds = Array.from(listingIdsSet);
            const listings = listingIds.length
                ? await prisma.viberListing.findMany({
                    where: { id: { in: listingIds } },
                    select: { id: true, listingType: true },
                })
                : [];
            const listingTypeById = new Map();
            for (const l of listings) {
                if (l && typeof l.id === 'number' && l.listingType) {
                    listingTypeById.set(l.id, l.listingType);
                }
            }
            const personByPhone = new Map();
            for (const p of persons) {
                personByPhone.set(p.phoneNormalized, p);
            }
            const eventsByPhone = new Map();
            for (const ev of events) {
                if (!ev.phoneNormalized)
                    continue;
                if (!eventsByPhone.has(ev.phoneNormalized)) {
                    eventsByPhone.set(ev.phoneNormalized, []);
                }
                eventsByPhone.get(ev.phoneNormalized).push(ev);
            }
            const clients = [];
            for (const phone of phones) {
                const evs = eventsByPhone.get(phone) ?? [];
                if (!evs.length)
                    continue;
                const totalRides = evs.length;
                const firstRideDate = (evs[0].departureDate ?? evs[0].createdAt);
                const lastRideDate = (evs[evs.length - 1].departureDate ?? evs[evs.length - 1].createdAt);
                // Статистика по маршрутах
                const routeCounts = new Map();
                for (const e of evs) {
                    const r = e.route || 'Unknown';
                    routeCounts.set(r, (routeCounts.get(r) ?? 0) + 1);
                }
                const routes = Array.from(routeCounts.entries())
                    .map(([route, count]) => ({ route, count, share: count / totalRides }))
                    .sort((a, b) => b.count - a.count);
                // Статистика по днях тижня
                const weekdayCounts = new Array(7).fill(0);
                for (const e of evs) {
                    const wd = typeof e.weekday === 'number'
                        ? e.weekday
                        : e.departureDate instanceof Date
                            ? e.departureDate.getDay()
                            : null;
                    if (wd != null && wd >= 0 && wd <= 6) {
                        weekdayCounts[wd]++;
                    }
                }
                const weekdayStats = weekdayCounts.map((count, weekday) => ({ weekday, count }));
                // Статистика по часу доби
                let morning = 0;
                let day = 0;
                let evening = 0;
                let night = 0;
                for (const e of evs) {
                    const h = typeof e.hour === 'number' ? e.hour : null;
                    if (h == null)
                        continue;
                    if (h >= 5 && h < 11)
                        morning++;
                    else if (h >= 11 && h < 17)
                        day++;
                    else if (h >= 17 && h < 23)
                        evening++;
                    else
                        night++;
                }
                const timeOfDayStats = { morning, day, evening, night };
                // Ролі: скільки оголошень як "driver" та "passenger"
                let driverTrips = 0;
                let passengerTrips = 0;
                for (const e of evs) {
                    const viberRideId = typeof e.viberRideId === 'number' ? e.viberRideId : null;
                    if (!viberRideId)
                        continue;
                    const lt = listingTypeById.get(viberRideId);
                    if (lt === 'driver')
                        driverTrips++;
                    else if (lt === 'passenger')
                        passengerTrips++;
                }
                let profileRole = 'mixed';
                if (driverTrips >= passengerTrips * 1.5 && driverTrips > 0) {
                    profileRole = 'driver';
                }
                else if (passengerTrips >= driverTrips * 1.5 && passengerTrips > 0) {
                    profileRole = 'passenger';
                }
                const mainRoute = routes[0];
                const person = personByPhone.get(phone) || null;
                const name = person?.fullName ?? null;
                const activeDays = (lastRideDate.getTime() - firstRideDate.getTime()) / (1000 * 60 * 60 * 24) || 1;
                const ridesPerWeek = (totalRides / (activeDays / 7)).toFixed(1);
                const weekdayWorkdays = weekdayCounts[1] + weekdayCounts[2] + weekdayCounts[3] + weekdayCounts[4] + weekdayCounts[5];
                const weekdayWeekend = weekdayCounts[0] + weekdayCounts[6];
                const tags = [];
                if (profileRole === 'driver') {
                    tags.push('часто виступає як водій');
                }
                else if (profileRole === 'passenger') {
                    tags.push('часті поїздки як пасажир');
                }
                else {
                    tags.push('активний як водій і пасажир');
                }
                if (mainRoute && mainRoute.route !== 'Unknown') {
                    tags.push(`часто їздить маршрутом ${mainRoute.route}`);
                }
                if (weekdayWorkdays > weekdayWeekend * 1.5) {
                    tags.push('переважно їздить у будні дні');
                }
                else if (weekdayWeekend > weekdayWorkdays * 1.5) {
                    tags.push('часті поїздки на вихідних');
                }
                if (evening > morning && evening > day && evening > night) {
                    tags.push('частіше їздить ввечері');
                }
                else if (morning > evening && morning > day && morning > night) {
                    tags.push('частіше їздить зранку');
                }
                const behaviorSummary = `${name ?? phone}: ${totalRides} поїздок за весь період (~${ridesPerWeek} на тиждень)` +
                    (tags.length ? `. Основні патерни: ${tags.join(', ')}.` : '.');
                let recommendations;
                if (profileRole === 'driver') {
                    recommendations = [
                        'Технічна: показувати цьому водію список пасажирів на його типових маршрутах і годинах.',
                        'Технічна: запропонувати автопідказку для повторного створення оголошень з тим самим маршрутом і часом.',
                        'Технічна: можна показувати персональні рекомендації щодо цін/завантаженості поїздок для водія.',
                    ];
                }
                else if (profileRole === 'passenger') {
                    recommendations = [
                        'Технічна: запропонувати автосповіщення про нових водіїв на його основних маршрутах і годинах.',
                        'Технічна: додати «швидке бронювання» на часті для нього напрямки (1–2 кліки).',
                        'Технічна: можна показувати персональні акції/знижки на популярні для нього поїздки.',
                    ];
                }
                else {
                    recommendations = [
                        'Технічна: для цього користувача поєднати сценарії водія та пасажира в один персональний блок.',
                        'Технічна: показувати йому як пасажирів, так і водіїв на його основних напрямках.',
                        'Технічна: у майбутньому дозволити швидко перемикатися між ролями «Я водій» / «Я пасажир» з урахуванням його історії.',
                    ];
                }
                const hasTelegramBot = !!(person?.telegramChatId && person.telegramChatId !== '0' && person.telegramChatId.trim() !== '');
                const promoFailedAt = person?.telegramPromoSentAt ? new Date(person.telegramPromoSentAt).getTime() : null;
                const communicationFailed = !hasTelegramBot && promoFailedAt !== null && promoFailedAt === new Date(0).getTime();
                clients.push({
                    phoneNormalized: phone,
                    fullName: name,
                    totalRides,
                    firstRideDate: firstRideDate.toISOString(),
                    lastRideDate: lastRideDate.toISOString(),
                    routes,
                    weekdayStats,
                    timeOfDayStats,
                    behaviorSummary,
                    recommendations,
                    hasTelegramBot,
                    communicationFailed,
                    profileRole,
                });
            }
            // Сортування: «Комунікація не вдалася» — внизу сторінки
            clients.sort((a, b) => (a.communicationFailed === b.communicationFailed ? 0 : a.communicationFailed ? 1 : -1));
            res.json({ clients, total, page, pageSize, totalPages });
        }
        catch (e) {
            console.error('❌ Помилка аналітики ViberRideEvent:', e);
            res.status(500).json({
                error: 'Не вдалося побудувати аналітику поведінки клієнтів за ViberRideEvent',
                details: e instanceof Error ? e.message : String(e),
            });
        }
    });
    /** Сценарії реклами для UI: ключ → лейбл і для якого профілю. */
    const PROMO_SCENARIO_KEYS = [
        'driver_passengers',
        'driver_autocreate',
        'passenger_notify',
        'passenger_quick',
        'mixed_unified',
        'mixed_both',
    ];
    r.get('/admin/viber-analytics/promo-scenarios', require_admin_1.requireAdmin, (_req, res) => {
        res.json({
            scenarios: PROMO_SCENARIO_KEYS.map((key) => ({
                key,
                label: telegram_1.BEHAVIOR_PROMO_SCENARIO_LABELS[key],
                profiles: telegram_1.BEHAVIOR_PROMO_SCENARIO_PROFILES[key],
            })),
            scenarioKeysByProfile: {
                driver: (0, index_helpers_1.getScenarioKeysForProfile)('driver'),
                passenger: (0, index_helpers_1.getScenarioKeysForProfile)('passenger'),
                mixed: (0, index_helpers_1.getScenarioKeysForProfile)('mixed'),
            },
        });
    });
    /**
     * Відправити персональну рекламу по клієнту з аналітики ViberRide.
     * Якщо є Telegram бот — через бота, інакше через особистий акаунт.
     * При невдалій комунікації (не знайдено в Telegram) проставляється маркер — кнопка стає неактивною.
     */
    r.post('/admin/viber-analytics/send-person-promo', require_admin_1.requireAdmin, async (req, res) => {
        try {
            const { phoneNormalized: rawPhone, scenarioKey, mainRoute } = req.body;
            const phone = rawPhone ? (0, telegram_1.normalizePhone)(String(rawPhone).trim()) : '';
            if (!phone) {
                return res.status(400).json({ error: 'Потрібен phoneNormalized' });
            }
            if (!scenarioKey || !PROMO_SCENARIO_KEYS.includes(scenarioKey)) {
                return res.status(400).json({ error: 'Невірний scenarioKey' });
            }
            const key = scenarioKey;
            const person = await prisma.person.findFirst({
                where: { phoneNormalized: phone },
                select: { id: true, fullName: true, telegramChatId: true, telegramPromoSentAt: true, telegramUsername: true },
            });
            const context = {
                fullName: person?.fullName ?? null,
                mainRoute: typeof mainRoute === 'string' ? mainRoute.trim() || undefined : undefined,
            };
            if (person?.telegramChatId && person.telegramChatId !== '0' && person.telegramChatId.trim() !== '') {
                try {
                    await (0, telegram_1.sendBehaviorPromoMessage)(person.telegramChatId, key, context);
                    console.log(`📢 Behavior promo (bot) sent to ${phone}, scenario=${key}`);
                    return res.json({ success: true, sentVia: 'bot' });
                }
                catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    const isBlocked = (0, telegram_bot_blocked_1.isTelegramBotBlockedByUserError)(err);
                    const isChatNotFound = /chat not found|400 Bad Request|bad request: chat/i.test(msg) ||
                        (msg.includes('400') && msg.toLowerCase().includes('chat'));
                    if (person?.id && isChatNotFound && !isBlocked) {
                        await prisma.person.update({
                            where: { id: person.id },
                            data: { telegramChatId: null, telegramUserId: null },
                        });
                        console.log(`ℹ️ send-person-promo: chat not found для ${phone}, прив'язку Telegram скинуто, пробуємо особистий акаунт`);
                    }
                    else if (!isChatNotFound && !isBlocked) {
                        console.error('❌ send-person-promo (bot):', err);
                        return res.status(500).json({ success: false, sentVia: 'bot', error: msg });
                    }
                    else if (isBlocked) {
                        console.log(`ℹ️ send-person-promo: бот заблоковано для ${phone}, пробуємо особистий акаунт`);
                    }
                }
            }
            const htmlMessage = (0, telegram_1.buildBehaviorPromoMessage)(key, context);
            const plainMessage = htmlMessage
                .replace(/<b>/g, '')
                .replace(/<\/b>/g, '')
                .replace(/<i>/g, '')
                .replace(/<\/i>/g, '')
                .replace(/<a href="([^"]+)">[^<]*<\/a>/g, '$1')
                .replace(/<[^>]+>/g, '')
                .trim();
            const ok = await (0, telegram_1.sendMessageViaUserAccount)(phone, plainMessage, {
                telegramUsername: person?.telegramUsername ?? undefined,
            });
            if (ok) {
                await prisma.person.updateMany({
                    where: { phoneNormalized: phone },
                    data: { telegramPromoSentAt: new Date() },
                });
                console.log(`📢 Behavior promo (user) sent to ${phone}, scenario=${key}`);
                return res.json({ success: true, sentVia: 'user' });
            }
            await prisma.person.updateMany({
                where: { phoneNormalized: phone },
                data: { telegramPromoSentAt: index_helpers_1.PROMO_NOT_FOUND_SENTINEL },
            });
            return res.json({
                success: false,
                sentVia: 'user',
                error: 'Не знайдено в Telegram; кнопки реклами для цього контакту будуть неактивні.',
            });
        }
        catch (e) {
            console.error('❌ send-person-promo:', e);
            res.status(500).json({
                error: e instanceof Error ? e.message : 'Помилка відправки реклами',
            });
        }
    });
    return r;
}
