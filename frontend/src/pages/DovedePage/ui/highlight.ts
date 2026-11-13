import type { ParseSpan } from '../nlu/types';

/** Текст, порізаний на звичайні шматки й розпізнані (для підсвічування під полем) */
export function highlightParts(text: string, spans: ParseSpan[]): Array<{ text: string; kind: ParseSpan['kind'] | null }> {
  const out: Array<{ text: string; kind: ParseSpan['kind'] | null }> = [];
  let pos = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < pos || s.end > text.length) continue; // перекриття — пропускаємо, щоб не зсунути текст
    if (s.start > pos) out.push({ text: text.slice(pos, s.start), kind: null });
    out.push({ text: text.slice(s.start, s.end), kind: s.kind });
    pos = s.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), kind: null });
  return out;
}
