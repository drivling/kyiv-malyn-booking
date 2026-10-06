"use strict";
/**
 * «Зубастик» — маршрутки Київ ↔ Малин — поки бронюються лише за телефоном.
 *
 * Онлайн-флоу (сайт, бот) і запис у базу лишаються, наявні попередження теж; тут — правило «це рейс
 * Зубастика» і тексти, які кожне повідомлення пасажиру про такий рейс додає явно.
 *
 * Дзеркало фронтового `frontend/src/pages/MizhgorodskiPage/phoneOnlyBooking.ts` (те саме правило) і
 * `ZUBASTYK_PHONES` з `zubastykContent.ts` — при зміні правити обидва місця.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHONE_ONLY_BOT_LINE_HTML = exports.PHONE_ONLY_TOAST = exports.PHONE_ONLY_SMS = exports.PHONE_ONLY_NOTICE_TEXT = exports.PHONE_ONLY_NOTICE_HTML = exports.ZUBASTYK_PHONES = void 0;
exports.isPhoneOnlyBooking = isPhoneOnlyBooking;
/** Телефони бронювання «Зубастика» (сторінка /zubastyk). Останній — резервний. */
exports.ZUBASTYK_PHONES = [
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
function isPhoneOnlyBooking(item) {
    if (item.source === 'viber_match')
        return false;
    if (item.vehicleType === 'elektrichka')
        return false;
    return KYIV_MALYN_ROUTE_RE.test(item.route ?? '');
}
const phonesPlain = exports.ZUBASTYK_PHONES.map((p) => (p.note ? `${p.label} (${p.note})` : p.label)).join(', ');
const phonesHtml = exports.ZUBASTYK_PHONES.map((p) => {
    const link = `<a href="tel:+${p.digits}">${p.label}</a>`;
    return p.note ? `${link} (${p.note})` : link;
}).join(', ');
/** Для Telegram (HTML): окремим абзацом у підтвердженнях, нагадуваннях і кроках бронювання. */
exports.PHONE_ONLY_NOTICE_HTML = '⛔️ <b>Онлайн-бронювання маршруток Київ ↔ Малин поки не працює.</b>\n' +
    `Місце бронюється лише за телефоном: ${phonesHtml}`;
/** Те саме простим текстом — у відповіді API. */
exports.PHONE_ONLY_NOTICE_TEXT = 'Онлайн-бронювання маршруток Київ ↔ Малин поки не працює. ' +
    `Місце бронюється лише за телефоном: ${phonesPlain}.`;
/** Коротко для SMS (кирилиця = UCS-2, 70 символів на сегмент) — два основні номери. */
exports.PHONE_ONLY_SMS = 'Онлайн-бронь поки не працює — лише за тел. 0931920008, 0961420008.';
/** Спливаюче повідомлення бота (`answerCallbackQuery`, ≤ 200 символів). */
exports.PHONE_ONLY_TOAST = 'Заявку збережено, але онлайн-бронювання поки не працює — зателефонуйте 093 192 00 08, щоб забронювати місце.';
/** Один рядок для загальних текстів бота (привітання, /help), де напрямок ще не обрано. */
exports.PHONE_ONLY_BOT_LINE_HTML = '☎️ Маршрутки Київ ↔ Малин («Зубастик») поки бронюються <b>лише за телефоном</b>: ' +
    `<a href="tel:+${exports.ZUBASTYK_PHONES[0].digits}">${exports.ZUBASTYK_PHONES[0].label}</a>`;
