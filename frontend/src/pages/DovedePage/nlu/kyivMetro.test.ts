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
    // удень: 5 перегонів М1 × 158 с + пів інтервалу 180 с + вхід і вихід 240 с = 1210 с
    expect(metroTrip('kyiv.sviatoshyn', 'kyiv.pas')).toMatchObject({ text: 'метро М1 «Святошин» → «Вокзальна», 5 станцій, ≈ 20 хв', minutes: 20, headwayMin: 6, priceUah: 30, closed: false });
    expect(metroTrip('kyiv.akadem', 'kyiv.m.maidan')?.text).toBe('метро «Академмістечко» → «Майдан Незалежності», 10 станцій, пересадка «Хрещатик» → «Майдан Незалежності», ≈ 37 хв');
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

describe('метро: відрізки, напрямки, час доби', () => {
  it('напрямок — за кінцевою лінії, як на табличках платформи', () => {
    const there = metroPath('kyiv.sviatoshyn', 'kyiv.pas')!;
    expect(there.segments).toHaveLength(1);
    expect(there.segments[0]).toMatchObject({ line: 'M1', hops: 5 });
    expect([there.segments[0].from.name, there.segments[0].to.name, there.segments[0].towards.name]).toEqual(['Святошин', 'Вокзальна', 'Лісова']);
    expect(there.segments[0].stations.map((s) => s.name)).toEqual(['Святошин', 'Нивки', 'Берестейська', 'Шулявська', 'Політехнічний інститут', 'Вокзальна']);
    expect(metroPath('kyiv.pas', 'kyiv.sviatoshyn')!.segments[0].towards.name).toBe('Академмістечко');
  });

  it('усі три пересадки дають два відрізки різних ліній', () => {
    const cases: Array<[string, string, string, string]> = [
      ['kyiv.akadem', 'kyiv.obolon', 'Хрещатик', 'Майдан Незалежності'],
      ['kyiv.akadem', 'kyiv.m.syrets', 'Театральна', 'Золоті ворота'],
      ['kyiv.m.teremky', 'kyiv.m.syrets', 'Площа Українських Героїв', 'Палац спорту'],
    ];
    for (const [from, to, a, b] of cases) {
      const p = metroPath(from, to)!;
      expect(p.transfers.map((t) => [t.from.name, t.to.name])).toEqual([[a, b]]);
      expect(p.segments).toHaveLength(2);
      expect(p.segments[0].to.name).toBe(a);
      expect(p.segments[1].from.name).toBe(b);
      expect(p.segments[0].line).not.toBe(p.segments[1].line);
    }
  });

  it('час залежить від години: у пік поїзди частіше, ввечері рідше', () => {
    const at = (h: number, date = '2026-11-17') => metroTrip('kyiv.sviatoshyn', 'kyiv.pas', { mins: h * 60, date })!;
    expect([at(8).headwayMin, at(12).headwayMin, at(21).headwayMin]).toEqual([4, 6, 7]);
    expect(at(8).minutes).toBeLessThan(at(21).minutes);
    // субота — піку немає
    expect(at(8, '2026-11-21').headwayMin).toBe(6);
  });

  it('поза годинами роботи (05:30–23:00) — closed; пізня поїздка, що не встигає до закриття, теж', () => {
    const at = (mins: number) => metroTrip('kyiv.sviatoshyn', 'kyiv.pas', { mins, date: '2026-11-17' })!.closed;
    expect([at(5 * 60), at(5 * 60 + 30), at(22 * 60), at(22 * 60 + 50), at(23 * 60 + 30)]).toEqual([true, false, false, true, true]);
  });

  it('зелена лінія за «Видубичами»: далі автобус №318 замість метро — окремим відрізком зі своїм часом', () => {
    const t = metroTrip('kyiv.m.zoloti-vorota', 'kyiv.m.pozniaky')!;
    expect(t.segments.map((s) => [s.from.name, s.to.name, s.hops, s.bus])).toEqual([
      ['Золоті ворота', 'Видубичі', 5, null],
      ['Видубичі', 'Позняки', 3, '318'],
    ]);
    // 5 × 185 + 180 (поїзд) + 3 × 200 + 300 (автобус) + 240 = 2245 с
    expect(t.minutes).toBe(37);
    expect(t.text).toContain('від «Видубичі» до «Позняки» — автобус №318 замість метро');
    // цілком на закритій дільниці й у зворотний бік
    expect(metroTrip('kyiv.m.osokorky', 'kyiv.m.kharkivska')!.segments.map((s) => s.bus)).toEqual(['318']);
    expect(metroTrip('kyiv.m.pozniaky', 'kyiv.m.klovska')!.segments.map((s) => [s.from.name, s.to.name, s.bus])).toEqual([
      ['Позняки', 'Видубичі', '318'],
      ['Видубичі', 'Кловська', null],
    ]);
    // решта ліній — без автобусів
    expect(metroTrip('kyiv.heroiv', 'kyiv.m.teremky')!.segments.every((s) => s.bus === null)).toBe(true);
  });
});
