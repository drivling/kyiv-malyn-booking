"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SYNONYM_LIMIT = exports.SYNONYM_MAX_LENGTH = void 0;
exports.normalizePhrase = normalizePhrase;
exports.phraseProblem = phraseProblem;
/**
 * «Доведе» — синоніми з адмінки (Docs/dovede-roadmap.md): слово чи фраза, якою люди називають місце, → id місця.
 * Власник додає їх на вкладці журналу з того, чого сторінка не впізнала; діють одразу, без деплою: браузер читає
 * їх з GET /dovede/synonyms, Claude отримує в повідомленні з питанням (системний промпт і його кеш не міняються).
 */
const normalize_1 = require("./normalize");
exports.SYNONYM_MAX_LENGTH = 60;
/** Скільки синонімів віддаємо сторінці й Claude */
exports.SYNONYM_LIMIT = 300;
/** Фраза, як її зберігаємо: малі літери, один пробіл між словами, без розділових знаків по краях */
function normalizePhrase(raw) {
    if (typeof raw !== 'string')
        return '';
    return (0, normalize_1.normalizeWord)(raw)
        .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
/** Чому фразу не можна зберегти; null — можна */
function phraseProblem(phrase) {
    if (phrase.length < 2)
        return 'Фраза закоротка';
    if (phrase.length > exports.SYNONYM_MAX_LENGTH)
        return `Фраза задовга (до ${exports.SYNONYM_MAX_LENGTH} символів)`;
    if (!/\p{L}{2}/u.test(phrase))
        return 'У фразі має бути слово';
    return null;
}
