/**
 * «Доведе» — ручний прогін еталонних питань через справжній Claude (Docs/dovede-roadmap.md, фаза 2).
 * Не в CI і не в `npm test`: коштує грошей і потребує ключа.
 *
 *   DOVEDE_EVAL=1 ANTHROPIC_API_KEY=… npx vitest run src/dovede/eval.test.ts
 *   DOVEDE_EVAL=1 DOVEDE_EVAL_SCOPE=all DOVEDE_MODEL=claude-haiku-5-5 …   # усі питання, інша модель
 *
 * Критерії фази: ≥ 90% слотів на питаннях `scope: "mvp"`, медіана < 3 с, з другого виклику кеш читається.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { TripIntent } from './intent';
import { understandFromEnv, type UnderstandResult } from './understand';

const ENABLED = process.env.DOVEDE_EVAL === '1';
const GOLDEN = path.resolve(__dirname, '../../../frontend/src/pages/DovedePage/eval/golden.json');
/** п'ятниця 13.11.2026, 14:20 за Києвом — `defaultNow` у golden.json */
const NOW = { date: '2026-11-13', mins: 14 * 60 + 20 };

interface GoldenCase {
  id: string;
  text: string;
  expect: { intent?: string; from?: string | null; to?: string | null; when?: Partial<TripIntent['when']>; modes?: string[]; unknown?: string[]; confidence?: string };
  scope: 'mvp' | 'later';
}

/**
 * Порівнюємо лише поля з expect, як `parseLocal.test.ts`. Відмінність: `unknown` — лише «є / немає», бо
 * Claude записує слова людини по-своєму («Ковалівки» / «з Ковалівки»); транспорт — без порядку.
 */
export function gradeIntent(got: TripIntent, e: GoldenCase['expect']): { ok: number; total: number; why: string[] } {
  let ok = 0;
  let total = 0;
  const why: string[] = [];
  const check = (name: string, actual: unknown, expected: unknown) => {
    total++;
    if (JSON.stringify(actual) === JSON.stringify(expected)) ok++;
    else why.push(`${name}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`);
  };
  if (e.intent !== undefined) check('intent', got.intent, e.intent);
  if (e.from !== undefined) check('from', got.from?.id ?? null, e.from);
  if (e.to !== undefined) check('to', got.to?.id ?? null, e.to);
  for (const k of ['day', 'time', 'kind', 'part'] as const) {
    if (e.when?.[k] !== undefined) check(`when.${k}`, got.when[k], e.when[k]);
  }
  if (e.modes !== undefined) check('modes', [...got.modes].sort(), [...e.modes].sort());
  if (e.unknown !== undefined) check('unknown', got.unknown.length > 0, e.unknown.length > 0);
  if (e.confidence !== undefined) check('confidence', got.confidence, e.confidence);
  return { ok, total, why };
}

test.skipIf(!ENABLED)(
  'еталони через Claude: ≥ 90% слотів, медіана < 3 с, кеш читається',
  async () => {
    const understand = understandFromEnv();
    assert.ok(understand, 'потрібен ANTHROPIC_API_KEY');
    const all = (JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) as { cases: GoldenCase[] }).cases;
    const cases = process.env.DOVEDE_EVAL_SCOPE === 'all' ? all : all.filter((c) => c.scope === 'mvp');

    let ok = 0;
    let total = 0;
    const misses: string[] = [];
    const results: UnderstandResult[] = [];
    // послідовно: перший виклик пише кеш промпту, решта мають його читати
    for (const c of cases) {
      const r = await understand(c.text, NOW);
      results.push(r);
      if (!r.ok) {
        const slots = gradeIntent({ intent: 'other', from: null, to: null, when: { day: '', kind: 'any' }, modes: [], unknown: [], confidence: 'low' }, c.expect).total;
        total += slots;
        misses.push(`${c.id} «${c.text}»: ${r.failure} — ${r.message}`);
        continue;
      }
      const g = gradeIntent(r.intent, c.expect);
      ok += g.ok;
      total += g.total;
      if (g.why.length) misses.push(`${c.id} «${c.text}»: ${g.why.join('; ')}`);
    }

    const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const median = lat[Math.floor(lat.length / 2)];
    const sum = (f: (r: UnderstandResult) => number) => results.reduce((n, r) => n + f(r), 0);
    const cached = results.slice(1).filter((r) => (r.usage?.cacheReadTokens ?? 0) > 0).length;
    console.info(
      [
        `Доведе eval · модель ${results[0]?.model} · питань ${cases.length}`,
        `слоти: ${ok}/${total} = ${((ok / total) * 100).toFixed(1)}%`,
        `затримка: медіана ${median} мс, найдовша ${lat[lat.length - 1]} мс`,
        `токени: вхід ${sum((r) => r.usage?.inputTokens ?? 0)}, з кешу ${sum((r) => r.usage?.cacheReadTokens ?? 0)}, у кеш ${sum((r) => r.usage?.cacheWriteTokens ?? 0)}, вихід ${sum((r) => r.usage?.outputTokens ?? 0)}`,
        `кеш прочитано у ${cached}/${results.length - 1} викликах після першого`,
        ...(misses.length ? ['розбіжності:', ...misses.map((m) => `  ${m}`)] : []),
      ].join('\n'),
    );
    assert.ok(ok / total >= 0.9, `слотів ${ok}/${total} — менше 90%`);
    assert.ok(median < 3000, `медіана ${median} мс`);
    assert.ok(cached > 0, 'кеш промпту жодного разу не прочитано — промпт коротший за мінімум моделі або змінюється між запитами');
  },
  10 * 60_000,
);
