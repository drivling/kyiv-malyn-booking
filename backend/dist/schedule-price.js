"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSchedulePriceUah = defaultSchedulePriceUah;
exports.parseOptionalPriceUah = parseOptionalPriceUah;
/** Default marshrutka fare (UAH) by schedule route string when admin omits priceUah. */
function defaultSchedulePriceUah(route) {
    const r = String(route || '');
    if (r.includes('Kyiv-Malyn') || r.includes('Malyn-Kyiv'))
        return 280;
    // Zhytomyr / Korosten — TBD
    return null;
}
function parseOptionalPriceUah(raw) {
    if (raw === undefined)
        return undefined;
    if (raw === null || raw === '')
        return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0)
        return null;
    return Math.round(n);
}
