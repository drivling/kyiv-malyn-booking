"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.idDmGuard = exports.ID_DM_DAILY_CAP_DEFAULT = void 0;
exports.idDmEnabled = idDmEnabled;
exports.idDmDailyCap = idDmDailyCap;
exports.idDmLimits = idDmLimits;
exports.createIdDmGuard = createIdDmGuard;
/**
 * Предохранитель для писем від особистого акаунта за числовим Telegram-id (автори без username і номера).
 *
 * Сесія одна на все (Джура, обіди, юзербот): скарги на спам від незнайомих → ліміти/бан → падає все.
 * Тому такі DM: вимикаються в адмінці «Сповіщення» (`NotificationSettings.tgUserByIdEnabled`) або назавжди
 * `TELEGRAM_USER_DM_BY_ID=0` (тоді в адмінці не ввімкнути), ≤ `tgUserByIdDailyCap` за добу (Київ; не задано —
 * `TELEGRAM_USER_DM_BY_ID_DAILY_CAP`, інакше 20), а після `PEER_FLOOD` від Telegram припиняються до наступної доби.
 */
exports.ID_DM_DAILY_CAP_DEFAULT = 20;
const KYIV_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' });
function idDmEnabled(env = process.env) {
    return env.TELEGRAM_USER_DM_BY_ID?.trim() !== '0';
}
function idDmDailyCap(env = process.env) {
    const n = Number(env.TELEGRAM_USER_DM_BY_ID_DAILY_CAP);
    return Number.isFinite(n) && n >= 0 && env.TELEGRAM_USER_DM_BY_ID_DAILY_CAP?.trim() ? Math.floor(n) : exports.ID_DM_DAILY_CAP_DEFAULT;
}
/** Що діє зараз: змінна середовища `=0` перемагає адмінку; ліміт з адмінки, інакше зі змінної / 20 */
function idDmLimits(settings, env = process.env) {
    const lockedBy = idDmEnabled(env) ? null : 'TELEGRAM_USER_DM_BY_ID=0';
    const defaultCap = idDmDailyCap(env);
    return {
        enabled: !lockedBy && settings?.tgUserByIdEnabled !== false,
        cap: settings?.tgUserByIdDailyCap ?? defaultCap,
        lockedBy,
        defaultCap,
    };
}
function createIdDmGuard(opts = {}) {
    const cap = opts.cap ?? (() => idDmDailyCap());
    const enabled = opts.enabled ?? (() => idDmEnabled());
    const now = opts.now ?? (() => new Date());
    let day = '';
    let count = 0;
    let flooded = false;
    const roll = () => {
        const d = KYIV_DAY.format(now());
        if (d !== day) {
            day = d;
            count = 0;
            flooded = false;
        }
    };
    return {
        tryAcquire(limits) {
            roll();
            const on = limits ? limits.enabled : enabled();
            const max = limits ? limits.cap : cap();
            if (!on || flooded || count >= max)
                return false;
            count++;
            return true;
        },
        trip() {
            roll();
            flooded = true;
        },
        used() {
            roll();
            return count;
        },
        tripped() {
            roll();
            return flooded;
        },
    };
}
exports.idDmGuard = createIdDmGuard();
