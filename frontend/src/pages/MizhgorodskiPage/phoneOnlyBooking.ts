/**
 * «Зубастик» — маршрутки Київ ↔ Малин — поки бронюються лише за телефоном.
 *
 * Кнопка «Забронювати» і заявка в базу лишаються. Попереджаємо лише в момент бронювання — у модалці
 * (`BusBookingModal`) і в боті; головна, пошук, «Доведе», реклама, SEO та AEO (ліди, FAQ, мета, llms.txt)
 * обіцяють онлайн-бронювання як і раніше, без жодної примітки (рішення власника 2026-11-19: окрема інтеграція
 * з перевізником у роботі).
 * Дзеркало бекендового `backend/src/phone-booking.ts` (те саме правило) — при зміні правити обидва місця.
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

