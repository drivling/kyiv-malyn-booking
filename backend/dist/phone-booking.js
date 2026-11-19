"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.phoneOnlyToast = exports.phoneOnlySms = exports.phoneOnlyNoticeText = exports.phoneOnlyNoticeHtml = exports.zubastykPhones = void 0;
exports.isPhoneOnlyBooking = isPhoneOnlyBooking;
const zubastyk_phones_1 = require("./zubastyk-phones");
Object.defineProperty(exports, "zubastykPhones", { enumerable: true, get: function () { return zubastyk_phones_1.zubastykPhones; } });
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
const plain = (list) => list.map((p) => (p.note ? `${p.label} (${p.note})` : p.label)).join(', ');
const html = (list) => list
    .map((p) => {
    const link = `<a href="tel:+${p.digits}">${p.label}</a>`;
    return p.note ? `${link} (${p.note})` : link;
})
    .join(', ');
/** Для Telegram (HTML): окремим абзацом у підтвердженнях, нагадуваннях і кроках бронювання. */
const phoneOnlyNoticeHtml = () => '⛔️ <b>Онлайн-бронювання маршруток Київ ↔ Малин поки не працює.</b>\n' + `Місце бронюється лише за телефоном: ${html((0, zubastyk_phones_1.zubastykPhones)())}`;
exports.phoneOnlyNoticeHtml = phoneOnlyNoticeHtml;
/** Те саме простим текстом — у відповіді API. */
const phoneOnlyNoticeText = () => 'Онлайн-бронювання маршруток Київ ↔ Малин поки не працює. ' + `Місце бронюється лише за телефоном: ${plain((0, zubastyk_phones_1.zubastykPhones)())}.`;
exports.phoneOnlyNoticeText = phoneOnlyNoticeText;
/** Коротко для SMS (кирилиця = UCS-2, 70 символів на сегмент) — два перші номери без резервних. */
const phoneOnlySms = () => {
    const list = (0, zubastyk_phones_1.zubastykPhones)();
    const main = list.filter((p) => !p.note);
    const two = (main.length ? main : list).slice(0, 2).map((p) => `0${p.digits.slice(3)}`);
    return `Онлайн-бронь поки не працює — лише за тел. ${two.join(', ')}.`;
};
exports.phoneOnlySms = phoneOnlySms;
/** Спливаюче повідомлення бота (`answerCallbackQuery`, ≤ 200 символів). */
const phoneOnlyToast = () => `Заявку збережено, але онлайн-бронювання поки не працює — зателефонуйте ${(0, zubastyk_phones_1.zubastykPhones)()[0].label}, щоб забронювати місце.`;
exports.phoneOnlyToast = phoneOnlyToast;
