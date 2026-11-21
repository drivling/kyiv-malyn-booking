/**
 * «Доведе» · голос: наскільки розпізнаний текст схожий на те, що читали (Docs/dovede-voice-roadmap.md, Ф1·1).
 * Це лише підказка для очей; головний показник лабораторії — чи збігся розбір (`voiceMatch.ts`).
 */

/** Слова без розділових знаків і регістру; апострофи зведено до одного */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[ʼ’`]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Частка помилок на слово (відстань Левенштейна по словах / слів у еталоні); `null`, якщо еталон порожній */
export function wordErrorRate(reference: string, hypothesis: string): number | null {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  if (!ref.length) return null;
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const cur = [i];
    for (let j = 1; j <= hyp.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[hyp.length] / ref.length;
}
