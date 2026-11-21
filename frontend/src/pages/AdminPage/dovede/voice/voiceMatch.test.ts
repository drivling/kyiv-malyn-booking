import { describe, expect, it } from 'vitest';
import { compareHeard } from './voiceMatch';
import { VOICE_PHRASES } from './phrases';

const NOW = { date: '2026-11-21', mins: 600 };

describe('compareHeard', () => {
  it('те саме питання іншими словами числа — розбір збігся', () => {
    const p = VOICE_PHRASES.find((x) => x.n === 3)!;
    // «після 14» і «після чотирнадцятої» — один час
    expect(compareHeard(p.ref, p.spoken, NOW).match).toBe(true);
  });

  it('помилка в місці — розбір не збігся', () => {
    expect(compareHeard('Як доїхати з Малина до Києва', 'Як доїхати з Малина до Житомира', NOW).match).toBe(false);
  });

  it('помилка в часі — розбір не збігся', () => {
    expect(compareHeard('З Малина до Києва завтра о 6 ранку', 'З Малина до Києва завтра о 8 ранку', NOW).match).toBe(false);
  });

  it('порожній розпізнаний текст не збігається з питанням', () => {
    expect(compareHeard('З Малина до Києва', '', NOW).match).toBe(false);
  });
});

describe('ідеальна розшифровка', () => {
  it('кожна фраза, прочитана як є, веде до того самого розбору, що й набрана', () => {
    const bad = VOICE_PHRASES.filter((p) => !compareHeard(p.ref, p.spoken, NOW).match).map((p) => `${p.n}: ${p.spoken}`);
    expect(bad).toEqual([]);
  });
});
