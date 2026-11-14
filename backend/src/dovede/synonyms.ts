/**
 * «Доведе» — синоніми з адмінки (Docs/dovede-roadmap.md): слово чи фраза, якою люди називають місце, → id місця.
 * Власник додає їх на вкладці журналу з того, чого сторінка не впізнала; діють одразу, без деплою: браузер читає
 * їх з GET /dovede/synonyms, Claude отримує в повідомленні з питанням (системний промпт і його кеш не міняються).
 */
import { normalizeWord } from './normalize';

export const SYNONYM_MAX_LENGTH = 60;
/** Скільки синонімів віддаємо сторінці й Claude */
export const SYNONYM_LIMIT = 300;

export interface DovedeSynonymEntry {
  phrase: string;
  placeId: string;
}

/** Фраза, як її зберігаємо: малі літери, один пробіл між словами, без розділових знаків по краях */
export function normalizePhrase(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return normalizeWord(raw)
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Чому фразу не можна зберегти; null — можна */
export function phraseProblem(phrase: string): string | null {
  if (phrase.length < 2) return 'Фраза закоротка';
  if (phrase.length > SYNONYM_MAX_LENGTH) return `Фраза задовга (до ${SYNONYM_MAX_LENGTH} символів)`;
  if (!/\p{L}{2}/u.test(phrase)) return 'У фразі має бути слово';
  return null;
}
