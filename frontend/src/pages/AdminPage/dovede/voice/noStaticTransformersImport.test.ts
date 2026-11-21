/**
 * Сайт не важчає (Docs/dovede-voice-roadmap.md, Ф1): `@huggingface/transformers` підключається лише динамічним
 * `import()`, тобто лежить окремим чанком, який ніхто не завантажує, поки адмін не натисне «Завантажити модель».
 * Статичний `import … from '@huggingface/transformers'` будь-де в `src` вклав би бібліотеку в основний чанк.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('@huggingface/transformers', () => {
  it('ніде не імпортується статично', () => {
    const offenders = walk(SRC).filter((f) => {
      if (f.endsWith('noStaticTransformersImport.test.ts')) return false;
      const text = readFileSync(f, 'utf8');
      return /(^|\n)\s*(import|export)\s[^;\n]*from\s+['"]@huggingface\/transformers['"]/.test(text) || /(^|\n)\s*import\s+['"]@huggingface\/transformers['"]/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it('whisper.ts підключає її через import()', () => {
    expect(readFileSync(join(SRC, 'pages/AdminPage/dovede/voice/whisper.ts'), 'utf8')).toMatch(/await import\('@huggingface\/transformers'\)/);
  });
});
