/**
 * «Доведе» — метро Києва: усі 52 станції як місця, шляхи з пересадками й еталони `eval/kyiv-metro.json`
 * (питання людини, примітки водіїв, пари станцій). Без ШІ — це словник у браузері.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import golden from '../eval/kyiv-metro.json';
import mainGolden from '../eval/golden.json';
import { kyivNotePoint, metroTrip } from '../data/kyiv';
import { matchMetro, metroPath, metroPlace } from './kyivMetro';
import { METRO_STATIONS, METRO_TRANSFERS } from './kyivMetroData';
import { tokenize } from './normalize';
import { parseLocal } from './parseLocal';
import { resolvePlace } from './places';

const NOW = { date: '2026-11-13', mins: 14 * 60 + 20 };
const parse = (text: string) => parseLocal(text, NOW).intent;

describe('метро Києва: дані', () => {
  it('52 станції, три лінії 18 + 18 + 16, id унікальні, пересадки між різними лініями', () => {
    expect(METRO_STATIONS).toHaveLength(52);
    const per = (line: string) => METRO_STATIONS.filter((s) => s.line === line).length;
    expect([per('M1'), per('M2'), per('M3')]).toEqual([18, 18, 16]);
    expect(new Set(METRO_STATIONS.map((s) => s.id)).size).toBe(52);
    for (const [a, b] of METRO_TRANSFERS) {
      const [sa, sb] = [a, b].map((id) => METRO_STATIONS.find((s) => s.id === id));
      expect(sa && sb && sa.line !== sb.line).toBe(true);
    }
  });

  it('кожна станція — місце в Києві, і її назва зі словом «метро» розбирається назад у неї', () => {
    for (const st of METRO_STATIONS) {
      expect(resolvePlace(st.id)).toMatchObject({ id: st.id, city: 'Kyiv' });
      expect(metroPlace(st.id)?.label).toBe(`м. ${st.name}`);
      const toks = tokenize(`метро ${st.name}`);
      expect(matchMetro(toks, 1)?.station.id, st.name).toBe(st.id);
      expect(parse(`з Малина до метро ${st.name}`).to?.id, st.name).toBe(st.id);
    }
  });

  it('копія на сервері байт-у-байт та сама (backend/src/dovede/kyivMetroData.ts)', () => {
    const here = fs.readFileSync(path.resolve(__dirname, 'kyivMetroData.ts'), 'utf8');
    const mirror = fs.readFileSync(path.resolve(__dirname, '../../../../../backend/src/dovede/kyivMetroData.ts'), 'utf8');
    expect(mirror).toBe(here);
  });
});

describe('метро Києва: еталони', () => {
  it.each(golden.questions)('питання: «$text»', ({ text, from, to }) => {
    const intent = parse(text);
    expect(intent.from?.id ?? null).toBe(from);
    // «!kyiv» — що завгодно, аби не київська станція (вулиця Малина чи нічого)
    if (to === '!kyiv') expect(intent.to?.id ?? '').not.toMatch(/^kyiv\./);
    else if (to === null) expect(intent.to?.id ?? '').not.toMatch(/^kyiv\.m\./);
    else expect(intent.to?.id ?? null).toBe(to);
  });

  it.each(golden.notes)('примітка водія: «$note»', ({ note, kyiv }) => {
    expect(kyivNotePoint(note)).toBe(kyiv);
  });

  it.each(golden.paths)('шлях $from → $to', ({ from, to, hops, transfers }) => {
    const p = metroPath(from, to)!;
    expect([p.hops, p.transfers.length]).toEqual([hops, transfers]);
    expect(p.minutes).toBe(hops * 2 + transfers * 5 + 5);
  });

  it('підказка: без пересадки — з номером лінії, з пересадкою — де пересісти', () => {
    expect(metroTrip('kyiv.sviatoshyn', 'kyiv.pas')).toEqual({ text: 'метро М1 «Святошин» → «Вокзальна», 5 станцій, ≈ 15 хв', minutes: 15 });
    expect(metroTrip('kyiv.akadem', 'kyiv.m.maidan')?.text).toBe('метро «Академмістечко» → «Майдан Незалежності», 10 станцій, пересадка «Хрещатик» → «Майдан Незалежності», ≈ 30 хв');
    expect(metroTrip('kyiv.borshch', 'kyiv.akadem')).toBeNull();
    expect(metroTrip('kyiv.akadem', 'kyiv.akadem')).toBeNull();
  });
});

describe('метро не ламає старе', () => {
  // усі питання головного набору без зупинок міста: місця, які розбирались до метро, мають лишитись тими самими
  const cases = (mainGolden as { cases?: Array<{ text: string; expect: { from?: string | null; to?: string | null }; scope: string }> }).cases ?? (mainGolden as unknown as Array<{ text: string; expect: { from?: string | null; to?: string | null }; scope: string }>);
  it('жодне питання головного набору (крім kyiv) не отримало станцію метро замість свого місця', () => {
    const list = Array.isArray(cases) ? cases : [];
    expect(list.length).toBeGreaterThan(50);
    for (const c of list.filter((x) => x.scope !== 'kyiv')) {
      const intent = parse(c.text);
      for (const role of ['from', 'to'] as const) {
        const want = c.expect[role];
        const got = intent[role]?.id ?? null;
        if (got?.startsWith('kyiv.m.')) expect(want, `${c.text} (${role})`).toBe(got);
      }
    }
  });
});
