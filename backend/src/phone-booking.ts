/**
 * «Зубастик» — маршрутки Київ ↔ Малин — поки бронюються лише за телефоном.
 *
 * Онлайн-флоу (сайт, бот) і запис у базу лишаються, наявні попередження теж; тут — правило «це рейс
 * Зубастика» і тексти, які додаються там, де людина бронює (кроки бота, підтвердження, нагадування,
 * SMS, відповідь API). Реклама й загальні тексти бота (привітання, /help, промо) обіцяють
 * онлайн-бронювання як і раніше — тимчасове обмеження там не згадуємо.
 *
 * Дзеркало фронтового `frontend/src/pages/MizhgorodskiPage/phoneOnlyBooking.ts` (те саме правило) і
 * `ZUBASTYK_PHONES` з `zubastykContent.ts` — при зміні правити обидва місця.
 */

/** Телефони бронювання «Зубастика» (сторінка /zubastyk). Останній — резервний. */
export const ZUBASTYK_PHONES: ReadonlyArray<{ digits: string; label: string; note?: string }> = [
  { digits: '380931920008', label: '093 192 00 08' },
  { digits: '380961420008', label: '096 142 00 08' },
  { digits: '380661620008', label: '066 162 00 08' },
  { digits: '380931701835', label: '093 170 18 35', note: 'резервний' },
];

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

const phonesPlain = ZUBASTYK_PHONES.map((p) => (p.note ? `${p.label} (${p.note})` : p.label)).join(', ');

const phonesHtml = ZUBASTYK_PHONES.map((p) => {
  const link = `<a href="tel:+${p.digits}">${p.label}</a>`;
  return p.note ? `${link} (${p.note})` : link;
}).join(', ');

/** Для Telegram (HTML): окремим абзацом у підтвердженнях, нагадуваннях і кроках бронювання. */
export const PHONE_ONLY_NOTICE_HTML =
  '⛔️ <b>Онлайн-бронювання маршруток Київ ↔ Малин поки не працює.</b>\n' +
  `Місце бронюється лише за телефоном: ${phonesHtml}`;

/** Те саме простим текстом — у відповіді API. */
export const PHONE_ONLY_NOTICE_TEXT =
  'Онлайн-бронювання маршруток Київ ↔ Малин поки не працює. ' +
  `Місце бронюється лише за телефоном: ${phonesPlain}.`;

/** Коротко для SMS (кирилиця = UCS-2, 70 символів на сегмент) — два основні номери. */
export const PHONE_ONLY_SMS = 'Онлайн-бронь поки не працює — лише за тел. 0931920008, 0961420008.';

/** Спливаюче повідомлення бота (`answerCallbackQuery`, ≤ 200 символів). */
export const PHONE_ONLY_TOAST =
  'Заявку збережено, але онлайн-бронювання поки не працює — зателефонуйте 093 192 00 08, щоб забронювати місце.';
