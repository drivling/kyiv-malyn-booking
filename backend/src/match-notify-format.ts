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

export type MatchCounterpartRole = 'passenger' | 'driver';

export type CounterpartLineInput = {
  /** Уже відформатоване ім'я, напр. `displayName(listing.senderName, 'Пасажир')` */
  name: string;
  /** Уже відформатований клікабельний телефон, напр. `formatPhoneTelLink(listing.phone)` */
  phoneHtml: string;
  departureTime: string | null;
  notes: string | null;
  /** Лише для водія: `seats != null ? \`${seats} місць\` : '—'` */
  seatsLabel?: string;
};

export function formatCounterpartLine(role: MatchCounterpartRole, input: CounterpartLineInput): string {
  const time = input.departureTime ?? '—';
  const notesLine = input.notes ? `\n  📝 ${input.notes}` : '';
  if (role === 'passenger') {
    return `• 👤 ${input.name} — ${time}\n  📞 ${input.phoneHtml}${notesLine}`;
  }
  return `• 🚗 ${input.name} — ${time}, ${input.seatsLabel ?? '—'}\n  📞 ${input.phoneHtml}${notesLine}`;
}

export type MatchTypeGroups<T> = { exact: T[]; approximate: T[]; same_day: T[] };

/** `matches.filter(...).map(m => m.listing)` тричі → один прохід. */
export function groupListingsByMatchType<L>(
  matches: Array<{ matchType: 'exact' | 'approximate' | 'same_day'; listing: L }>,
): MatchTypeGroups<L> {
  const groups: MatchTypeGroups<L> = { exact: [], approximate: [], same_day: [] };
  for (const m of matches) groups[m.matchType].push(m.listing);
  return groups;
}
