/**
 * «Зубастик» — маршрутки Київ ↔ Малин — поки бронюються лише за телефоном.
 *
 * Кнопка «Забронювати» і заявка в базу лишаються, але кожен екран про такий рейс явно каже, що
 * онлайн-бронювання не працює. Дзеркало бекендового `backend/src/phone-booking.ts` (те саме правило)
 * — при зміні правити обидва місця.
 */
import type { Schedule } from '@/types';
import { ZUBASTYK_PHONES } from './zubastykContent';

/** Kyiv-Malyn-Irpin, Malyn-Kyiv-Bucha тощо (електрички мають ті самі `Kyiv-Malyn` / `Malyn-Kyiv`). */
const KYIV_MALYN_ROUTE_RE = /^(Kyiv-Malyn|Malyn-Kyiv)(-|$)/;

export function isPhoneOnlySchedule(schedule: Pick<Schedule, 'route'> & { vehicleType?: string | null }): boolean {
  if (schedule.vehicleType === 'elektrichka') return false;
  return KYIV_MALYN_ROUTE_RE.test(schedule.route ?? '');
}

export const PHONE_ONLY_TITLE = 'Онлайн-бронювання поки не працює';

/** Основний номер для кнопки «Подзвонити». */
export const ZUBASTYK_MAIN_PHONE = ZUBASTYK_PHONES[0];

export const zubastykTelHref = (digits: string = ZUBASTYK_MAIN_PHONE.digits) => `tel:+${digits}`;

/** «093 192 00 08, 096 142 00 08, 066 162 00 08, 093 170 18 35 (резервний)» */
export const ZUBASTYK_PHONES_TEXT = ZUBASTYK_PHONES.map((p) => (p.note ? `${p.label} (${p.note})` : p.label)).join(
  ', '
);

/** Одне речення для FAQ, мета-описів і JSON-LD. */
export const PHONE_ONLY_SENTENCE =
  'Онлайн-бронювання маршруток Київ ↔ Малин («Зубастик») поки не працює — місце бронюється лише за телефоном: ' +
  `${ZUBASTYK_PHONES_TEXT}.`;
