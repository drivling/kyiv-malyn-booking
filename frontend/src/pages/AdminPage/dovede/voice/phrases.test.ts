/**
 * Список фраз у коді й файл `Docs/dovede/research/voice-reading-list.md` — одне й те саме: власник читає з файлу,
 * лабораторія показує з коду (Docs/dovede-voice-roadmap.md, Ф1·1).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VOICE_PHRASES } from './phrases';

const DOC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../../Docs/dovede/research/voice-reading-list.md');

describe('VOICE_PHRASES', () => {
  it('збігається з Docs/dovede/research/voice-reading-list.md', () => {
    const rows: Array<{ n: number; spoken: string; ref: string }> = [];
    for (const line of readFileSync(DOC, 'utf8').split('\n')) {
      if (!line.startsWith('|')) continue;
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      if (/^\d+$/.test(cells[0])) rows.push({ n: Number(cells[0]), spoken: cells[1], ref: cells[2] });
    }
    expect(VOICE_PHRASES.map(({ n, spoken, ref }) => ({ n, spoken, ref }))).toEqual(rows);
  });

  it('39 основних фраз і 2 необовʼязкові, номери підряд', () => {
    expect(VOICE_PHRASES.filter((p) => !p.optional)).toHaveLength(39);
    expect(VOICE_PHRASES.filter((p) => p.optional)).toHaveLength(2);
    expect(VOICE_PHRASES.map((p) => p.n)).toEqual(VOICE_PHRASES.map((_, i) => i + 1));
  });
});
