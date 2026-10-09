/**
 * «Зубастик» — маршрутки Київ ↔ Малин — поки бронюються лише за телефоном.
 *
 * Кнопка «Забронювати» і заявка в базу лишаються. Попереджаємо там, де людина бронює (картка в
 * пошуку, модалка); реклама, SEO та AEO (ліди, FAQ, мета, llms.txt) обіцяють онлайн-бронювання як і
 * раніше — щонайбільше з м'яким `ZUBASTYK_TEMP_NOTE`, без «не працює».
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

/** М'яке речення для FAQ і «способів» на напрямках: обмеження тимчасове й лише для «Зубастика». */
export const ZUBASTYK_TEMP_NOTE = `Рейси «Зубастик» тимчасово бронюються за телефоном ${ZUBASTYK_MAIN_PHONE.label}.`;
