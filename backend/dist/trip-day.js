"use strict";
/**
 * Одна «доба поїздки» для всіх шляхів (пошук, мерж, матчинг, дедуп, cleanup).
 *
 * `ViberListing.date` зберігається як північ дня поїздки в локальному часі процесу
 * (`new Date(y, m, d)`; на Railway TZ=UTC). Раніше пошук брав локальну добу, мерж — локальні
 * getFullYear/getMonth/getDate, а матчинг — UTC-добу через toISOString: у проді збігалося,
 * на машині з іншим TZ те саме оголошення потрапляло в різні дні
 * (Docs/На будущее.md §2.5; Docs/poputky-search-performance-plan.md, Фаза 4.2).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tripDayWindow = tripDayWindow;
exports.tripDayWhere = tripDayWhere;
exports.tripDayKey = tripDayKey;
exports.parseDayString = parseDayString;
/** Межі доби [start, end) у локальному часі процесу для дати або рядка YYYY-MM-DD. */
function tripDayWindow(date) {
    const d = typeof date === 'string' ? parseDayString(date) : new Date(date);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return { start, end };
}
/** Prisma-фрагмент `date: { gte, lt }` для тієї ж доби. */
function tripDayWhere(date) {
    const { start, end } = tripDayWindow(date);
    return { gte: start, lt: end };
}
/** Ключ доби YYYY-MM-DD у локальному часі процесу (для групування, порівняння). */
function tripDayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
/** «2026-12-01» → локальна північ цього дня (а не UTC, як робить `new Date('2026-12-01')`). */
function parseDayString(s) {
    const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m)
        return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(s);
}
