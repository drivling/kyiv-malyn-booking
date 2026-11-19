/**
 * Приклади питань на сторінці «Доведе» («Спитайте, наприклад» і підказка «Я підказую дорогу»). Типові — тут; власник
 * міняє їх в адмінці без деплою («Налаштування» → «Дані сторінки», ключ `examples`): `applyExamplesData`.
 */
export const EXAMPLES_DEFAULT: readonly string[] = [
  'Як доїхати з Києва (Святошин) до Малина на вокзал',
  'з Царського села до Києва завтра зранку',
  'електричкою з Києва до Малина',
  'автобусом з Царського села на вокзал',
  'з Паперової фабрики в Коростень до міськлікарні',
  'у Коростені з Пашин до вокзалу',
];

export const KOROSTEN_EXAMPLES_DEFAULT: readonly string[] = ['З Пашин до міськлікарні', 'Від Гастелло до вокзалу', 'Коли №4 на Грозине', 'З Чолівки на ринок'];

let malyn: readonly string[] = EXAMPLES_DEFAULT;
let korosten: readonly string[] = KOROSTEN_EXAMPLES_DEFAULT;

/** Приклади, що діють зараз: для сторінки Малина чи Коростеня */
export const pageExamples = (forKorosten = false): readonly string[] => (forKorosten ? korosten : malyn);

const list = (v: unknown): string[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x.length >= 3);
  return out.length ? out.slice(0, 10) : null;
};

/** Дані з адмінки: `examples` — `{ malyn?: string[], korosten?: string[] }`; чого немає — лишається типове */
export function applyExamplesData(values: Record<string, unknown>): void {
  const v = values.examples as { malyn?: unknown; korosten?: unknown } | null | undefined;
  if (!v || typeof v !== 'object') return;
  const m = list(v.malyn);
  const k = list(v.korosten);
  if (m) malyn = m;
  if (k) korosten = k;
}

/** Назад до типових (тести) */
export function resetExamplesData(): void {
  malyn = EXAMPLES_DEFAULT;
  korosten = KOROSTEN_EXAMPLES_DEFAULT;
}
