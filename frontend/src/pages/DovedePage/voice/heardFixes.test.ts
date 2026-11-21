/**
 * Правила «помилок слуху» Web Speech (Docs/dovede-voice-roadmap.md, Ф1·2) і поріг якості на живому прогоні
 * лабораторії: той самий розбір, що в лабораторії (`compareHeard`), на текстах Web Speech із
 * `Docs/dovede/research/voice-lab-2026-11-22.json`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareHeard } from '@/pages/AdminPage/dovede/voice/voiceMatch';
import { sameAnswer } from '@/pages/DovedePage/nlu/merge';
import { parseLocal } from '@/pages/DovedePage/nlu/parseLocal';
import { fixHeard, prepareHeard } from './heardFixes';

describe('fixHeard', () => {
  it.each([
    ['чи є попутка змалена на Київ', 'чи є попутка з Малина на Київ'],
    ['попуткою з Києва де мало на завтра і назад', 'попуткою з Києва до Малина завтра і назад'],
    ['мені зпашина залізничний вокзал', 'мені з Пашин залізничний вокзал'],
    ['від лікарні до вокзалу Крим 2 маршруту', 'від лікарні до вокзалу крім 2 маршруту'],
    ['від лікарні до вокзалу Крим другого маршруту', 'від лікарні до вокзалу крім другого маршруту'],
  ])('%s', (input, expected) => {
    expect(fixHeard(input)).toBe(expected);
  });

  it('не чіпає звичайні фрази і слово «Крим» без номера маршруту', () => {
    expect(fixHeard('з Малина до Києва')).toBe('з Малина до Києва');
    expect(fixHeard('як доїхати до Криму')).toBe('як доїхати до Криму');
    expect(fixHeard('Крим це далеко')).toBe('Крим це далеко');
  });
});

describe('prepareHeard', () => {
  it('числа словами, потім помилки слуху, пробіли охайні', () => {
    expect(prepareHeard('  з малинської лікарні до Києва завтра о шостій ранку ')).toBe('з малинської лікарні до Києва завтра о 6:00 ранку');
    expect(prepareHeard('від лікарні до вокзалу Крим другого маршруту')).toBe('від лікарні до вокзалу крім 2 маршруту');
  });
});

describe('живий прогін лабораторії (Web Speech, 39 фраз)', () => {
  const lab = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../Docs/dovede/research/voice-lab-2026-11-22.json'), 'utf8')) as {
    rows: Array<{ n: number; ref: string; webSpeech?: { text: string } }>;
  };
  const now = { date: '2026-11-22', mins: 600 };
  const rows = lab.rows.filter((r) => r.n <= 39 && r.webSpeech?.text);
  const sameRaw = (ref: string, heard: string) => sameAnswer(parseLocal(ref, now).intent, parseLocal(heard, now).intent);

  it('prepareHeard піднімає збіг понад сирий текст (без словника зупинок)', () => {
    const raw = rows.filter((r) => sameRaw(r.ref, r.webSpeech!.text)).length;
    const prepared = rows.filter((r) => compareHeard(r.ref, r.webSpeech!.text, now).match).length;
    expect(rows).toHaveLength(39);
    // 2026-11-22: сирий текст — 30 з 39, з prepareHeard — 33 (числа словами, «змалена», «де мало на», «Крим» → «крім»)
    expect(prepared).toBeGreaterThan(raw);
    expect(prepared).toBeGreaterThanOrEqual(33);
  });
});
