import { describe, expect, it } from 'vitest';
import { localIsSure, pickIntent, sameAnswer, usableAiIntent, withIntent } from './merge';
import { parseLocal } from './parseLocal';
import type { TripIntent } from './types';

const NOW = { date: '2026-11-13', mins: 14 * 60 + 20 };

const ai = (over: Partial<TripIntent>): TripIntent => ({
  intent: 'trip',
  from: { id: 'city.Kyiv', text: 'Києва' },
  to: { id: 'malyn.vokzal', text: 'вокзал' },
  when: { day: 'today', kind: 'depart' },
  modes: [],
  unknown: [],
  confidence: 'high',
  ...over,
});

describe('«Доведе» — злиття місцевого розбору й Claude', () => {
  it('повне питання місцевий розбір розуміє сам', () => {
    expect(localIsSure(parseLocal('з Києва до Малина на вокзал', NOW))).toBe(true);
    expect(localIsSure(parseLocal('мені на вокзал', NOW))).toBe(false);
    expect(localIsSure(parseLocal('з Ковалівки до Малина', NOW))).toBe(false);
  });

  it('sameAnswer: слова людини й упевненість не важать, місця й час — важать', () => {
    const a = ai({});
    expect(sameAnswer(a, ai({ from: { id: 'city.Kyiv', text: 'Киева' }, confidence: 'medium' }))).toBe(true);
    expect(sameAnswer(a, ai({ to: { id: 'malyn.avtostantsiya', text: 'автостанція' } }))).toBe(false);
    expect(sameAnswer(a, ai({ when: { day: 'tomorrow', kind: 'depart' } }))).toBe(false);
    expect(sameAnswer(a, ai({ modes: ['elektrichka'] }))).toBe(false);
    expect(sameAnswer(a, ai({ intent: 'schedule' }))).toBe(true);
    expect(sameAnswer(a, ai({ intent: 'price' }))).toBe(false);
  });

  it('Claude зрозумів те, чого не зрозумів словник, — беремо Claude', () => {
    const local = parseLocal('хочу потрапити до залізки в малині з столиці', NOW).intent;
    const picked = pickIntent(local, ai({}));
    expect(picked.from?.id).toBe('city.Kyiv');
    expect(picked.to?.id).toBe('malyn.vokzal');
  });

  it('Claude не відповів або сам не впевнений — лишається місцевий розбір', () => {
    const local = parseLocal('мені на вокзал', NOW).intent;
    expect(pickIntent(local, null)).toBe(local);
    expect(pickIntent(local, ai({ from: null, to: null, confidence: 'low', intent: 'other' }))).toBe(local);
  });

  it('розбір з місцем поза словником не приймаємо', () => {
    expect(usableAiIntent(ai({ to: { id: 'city.Lviv', text: 'Львів' } }))).toBe(false);
    expect(usableAiIntent(ai({}))).toBe(true);
    expect(usableAiIntent(null)).toBe(false);
  });

  it('withIntent: рядок «Розумію…» показує намір, що пішов у відповідь', () => {
    const parse = parseLocal('до залізки', NOW);
    const shown = withIntent(parse, ai({ from: null, unknown: ['Ковалівки'] }));
    expect(shown.intent.to?.id).toBe('malyn.vokzal');
    expect(shown.unknownRole).toBe('from');
    expect(shown.spans).toEqual([]);
    expect(withIntent(parse, parse.intent)).toBe(parse);
  });
});

describe('«Доведе» — словник місць', () => {
  it('mirror: frontend gazetteer.ts is byte-identical to backend dovede/gazetteer.ts', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const here = path.resolve(__dirname, 'gazetteer.ts');
    const mirror = path.resolve(__dirname, '../../../../../backend/src/dovede/gazetteer.ts');
    // Claude отримує id з бекенд-копії, а браузер перевіряє їх своєю: розійдуться — розбір Claude відкидатиметься
    expect(fs.readFileSync(here, 'utf8')).toBe(fs.readFileSync(mirror, 'utf8'));
  });
});
