/**
 * Чисті частини вкладки «Реклама» (PromoTab): розділи з власними адресами й підписи фільтрів. Без React.
 */

export const PROMO_ADMIN_BASE = '/admin/promo';

export type PromoSection = '' | 'reminders' | 'regulars';

export const isPromoSection = (s: string): s is PromoSection => s === '' || s === 'reminders' || s === 'regulars';

/** «Канал 12» — скільки людей без бота підходить під вибір, «Бот 40» — скільки з ботом */
export function promoSections(counts: { channel: number | null; bot: number | null }) {
  const n = (label: string, c: number | null) => (c == null ? label : `${label} ${c}`);
  return [
    { slug: '', label: n('Реклама каналу', counts.channel) },
    { slug: 'reminders', label: n('Нагадування в боті', counts.bot) },
    { slug: 'regulars', label: 'Постійні клієнти' },
  ];
}

/** База реклами каналу — люди без Telegram-бота */
export type ChannelFilter = 'no_telegram' | 'no_communication' | 'promo_not_found';

export const CHANNEL_FILTERS: ReadonlyArray<{ value: ChannelFilter; label: string }> = [
  { value: 'no_communication', label: 'Ще не писали' },
  { value: 'no_telegram', label: 'Усі без бота' },
  { value: 'promo_not_found', label: 'Не знайдені в Telegram' },
];

/** База нагадувань — люди, що вже підключили бота */
export type ReminderFilter = 'all' | 'no_active_viber' | 'no_reminder_7_days';

export const REMINDER_FILTERS: ReadonlyArray<{ value: ReminderFilter; label: string }> = [
  { value: 'all', label: 'Усі з ботом' },
  { value: 'no_active_viber', label: 'Без активного оголошення' },
  { value: 'no_reminder_7_days', label: 'Не нагадували 7+ днів' },
];

export const PROFILE_LABEL: Record<'driver' | 'passenger' | 'mixed', string> = {
  driver: 'водій',
  passenger: 'пасажир',
  mixed: 'і водій, і пасажир',
};

export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';

/** Перші `n` рядків списку й скільки ще лишилось */
export function firstOf<T>(list: readonly T[], n: number): { shown: T[]; more: number } {
  return { shown: list.slice(0, n), more: Math.max(0, list.length - n) };
}
