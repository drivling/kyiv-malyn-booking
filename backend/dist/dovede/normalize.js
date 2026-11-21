"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeWord = normalizeWord;
exports.tokenize = tokenize;
/** Нормалізація слів для словника: регістр, апострофи, ё/е. */
function normalizeWord(s) {
    return s
        .toLowerCase()
        .replace(/[’ʼ`]/g, "'")
        .replace(/ё/g, 'е');
}
/**
 * Слова (з апострофом усередині; дефіс ділить «Малин-Київ»), час 18:00 / дата 20.11, числа.
 * Число — одна-дві цифри (година, номер маршруту) або рівно три, якщо воно не частина довшого («Грушевського 120» —
 * будинок 120, а не 12). Довші числа й далі діляться по дві цифри: «1830» — це 18 і 30, рік «2026» — 20 і 26.
 */
const TOKEN_RE = /[\p{L}][\p{L}'’ʼ]*|\d{1,2}[:.]\d{2}|(?<!\d)\d{3}(?!\d)|\d{1,2}/gu;
function tokenize(text) {
    return [...text.matchAll(TOKEN_RE)].map((m) => {
        const raw = m[0];
        const start = m.index ?? 0;
        return { raw, n: normalizeWord(raw), start, end: start + raw.length };
    });
}
