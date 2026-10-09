"use strict";
/**
 * Спільне форматування рядка контрагента в перетинах пасажир↔водій.
 *
 * Рядок «• 👤 Ім'я — час \n 📞 тел \n 📝 нотатки» (пасажир) чи «• 🚗 Ім'я — час, місць …»
 * (водій) був продубльований буквально у 6 місцях (`notifyMatchingPassengersForNewDriver`,
 * `notifyMatchingDriversForNewPassenger`, `/mydriverrides`, `/mypassengerrides`) — усюди, де
 * бот показує список збігів. Тут — одна функція; ім'я/телефон форматуються (displayName,
 * formatPhoneTelLink) на виклику, щоб модуль не залежав від telegram.ts (уникаємо циклічного
 * імпорту: telegram.ts сам імпортує цей файл).
 * Docs/poputky-search-performance-plan.md, Фаза 6.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatCounterpartLine = formatCounterpartLine;
exports.groupListingsByMatchType = groupListingsByMatchType;
function formatCounterpartLine(role, input) {
    const time = input.departureTime ?? '—';
    const notesLine = input.notes ? `\n  📝 ${input.notes}` : '';
    if (role === 'passenger') {
        return `• 👤 ${input.name} — ${time}\n  📞 ${input.phoneHtml}${notesLine}`;
    }
    return `• 🚗 ${input.name} — ${time}, ${input.seatsLabel ?? '—'}\n  📞 ${input.phoneHtml}${notesLine}`;
}
/** `matches.filter(...).map(m => m.listing)` тричі → один прохід. */
function groupListingsByMatchType(matches) {
    const groups = { exact: [], approximate: [], same_day: [] };
    for (const m of matches)
        groups[m.matchType].push(m.listing);
    return groups;
}
