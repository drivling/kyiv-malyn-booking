/** Нормалізація слів для словника: регістр, апострофи, ё/е. */
export function normalizeWord(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'")
    .replace(/ё/g, 'е');
}

export interface Token {
  raw: string;
  /** normalizeWord(raw) */
  n: string;
  start: number;
  end: number;
}

/** Слова (з апострофом усередині; дефіс ділить «Малин-Київ»), час 18:00 / дата 20.11, числа */
const TOKEN_RE = /[\p{L}][\p{L}'’ʼ]*|\d{1,2}[:.]\d{2}|\d{1,2}/gu;

export function tokenize(text: string): Token[] {
  return [...text.matchAll(TOKEN_RE)].map((m) => {
    const raw = m[0];
    const start = m.index ?? 0;
    return { raw, n: normalizeWord(raw), start, end: start + raw.length };
  });
}
