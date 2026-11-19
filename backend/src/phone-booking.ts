/**
 * «Зубастик» — маршрутки Київ ↔ Малин — поки бронюються лише за телефоном.
 *
 * Онлайн-флоу (сайт, бот) і запис у базу лишаються, наявні попередження теж; тут — правило «це рейс
 * Зубастика» і тексти, які додаються там, де людина бронює (кроки бота, підтвердження, нагадування,
 * SMS, відповідь API). Реклама й загальні тексти бота (привітання, /help, промо) обіцяють
 * онлайн-бронювання як і раніше — тимчасове обмеження там не згадуємо.
 *
 * Дзеркало фронтового `frontend/src/pages/MizhgorodskiPage/phoneOnlyBooking.ts` (те саме правило). Номери — з
 * `zubastyk-phones.ts` (власник міняє в адмінці), тому тексти нижче — функції, а не сталі.
 */

import { zubastykPhones, type ZubastykPhone } from './zubastyk-phones';

/** Телефони, що діють зараз (типові або з адмінки, `zubastyk-phones.ts`) */
export { zubastykPhones };

/** Kyiv-Malyn-Irpin, Malyn-Kyiv-Bucha тощо (електрички мають ті самі `Kyiv-Malyn` / `Malyn-Kyiv`). */
const KYIV_MALYN_ROUTE_RE = /^(Kyiv-Malyn|Malyn-Kyiv)(-|$)/;

/**
 * Рейс / бронювання «Зубастика»: маршрутка Київ ↔ Малин. Електрички відсікає `vehicleType`
 * (у Booking його немає, але бронь електрички не створюється), попутки — `source`.
 */
export function isPhoneOnlyBooking(item: {
  route: string | null | undefined;
  vehicleType?: string | null;
  source?: string | null;
}): boolean {
  if (item.source === 'viber_match') return false;
  if (item.vehicleType === 'elektrichka') return false;
  return KYIV_MALYN_ROUTE_RE.test(item.route ?? '');
}

const plain = (list: readonly ZubastykPhone[]) => list.map((p) => (p.note ? `${p.label} (${p.note})` : p.label)).join(', ');

const html = (list: readonly ZubastykPhone[]) =>
  list
    .map((p) => {
      const link = `<a href="tel:+${p.digits}">${p.label}</a>`;
      return p.note ? `${link} (${p.note})` : link;
    })
    .join(', ');

/** Для Telegram (HTML): окремим абзацом у підтвердженнях, нагадуваннях і кроках бронювання. */
export const phoneOnlyNoticeHtml = (): string =>
  '⛔️ <b>Онлайн-бронювання маршруток Київ ↔ Малин поки не працює.</b>\n' + `Місце бронюється лише за телефоном: ${html(zubastykPhones())}`;

/** Те саме простим текстом — у відповіді API. */
export const phoneOnlyNoticeText = (): string =>
  'Онлайн-бронювання маршруток Київ ↔ Малин поки не працює. ' + `Місце бронюється лише за телефоном: ${plain(zubastykPhones())}.`;

/** Коротко для SMS (кирилиця = UCS-2, 70 символів на сегмент) — два перші номери без резервних. */
export const phoneOnlySms = (): string => {
  const list = zubastykPhones();
  const main = list.filter((p) => !p.note);
  const two = (main.length ? main : list).slice(0, 2).map((p) => `0${p.digits.slice(3)}`);
  return `Онлайн-бронь поки не працює — лише за тел. ${two.join(', ')}.`;
};

/** Спливаюче повідомлення бота (`answerCallbackQuery`, ≤ 200 символів). */
export const phoneOnlyToast = (): string =>
  `Заявку збережено, але онлайн-бронювання поки не працює — зателефонуйте ${zubastykPhones()[0].label}, щоб забронювати місце.`;
