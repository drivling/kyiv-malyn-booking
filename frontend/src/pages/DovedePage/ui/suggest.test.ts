import { describe, expect, it } from 'vitest';
import { PLACES } from '../nlu/gazetteer';
import { parseLocal } from '../nlu/parseLocal';
import { applySuggestion, placeForm, suggestPlaces } from './suggest';

const NOW = { date: '2026-11-13', mins: 14 * 60 + 20 };
const at = (text: string) => suggestPlaces(text, text.length);

describe('«Доведе» — підказки при наборі', () => {
  it('кожну форму, яку вставляє підказка, словник розуміє як те саме місце', () => {
    for (const p of PLACES) {
      expect(parseLocal(`з ${placeForm(p, 'gen')}`, NOW).intent.from?.id, `з ${placeForm(p, 'gen')}`).toBe(p.id);
      expect(parseLocal(`в ${placeForm(p, 'acc')}`, NOW).intent.to?.id, `в ${placeForm(p, 'acc')}`).toBe(p.id);
      expect(parseLocal(placeForm(p, 'nom'), NOW).intent.to?.id, placeForm(p, 'nom')).toBe(p.id);
    }
  });

  it('доповнює слово під курсором і ставить відмінок за прийменником', () => {
    const s = at('з Києва до цар');
    expect(s.map((x) => x.label)).toEqual(['Малин · Царське село']);
    expect(s[0].insert).toBe('Царського села');
    expect(applySuggestion('з Києва до цар', s[0])).toEqual({ text: 'з Києва до Царського села ', caret: 26 });
    expect(at('на авт')[0].insert).toBe('автостанцію');
    expect(at('свят')[0].insert).toBe('Святошин');
  });

  it('«вокзал» двозначний — пропонує обидва', () => {
    expect(at('до вокз').map((x) => x.place.id).sort()).toEqual(['kyiv.pas', 'malyn.vokzal']);
  });

  it('не заважає: одна літера, прийменник, вже дописане слово, не місце', () => {
    expect(at('з К')).toEqual([]);
    expect(at('до')).toEqual([]);
    expect(at('з Києва до автостанції')).toEqual([]);
    expect(at('завтра зранку')).toEqual([]);
    expect(at('з Києва ')).toEqual([]);
  });

  it('слово всередині речення замінюється цілком, решта тексту лишається', () => {
    const text = 'з свят до Малина';
    const s = suggestPlaces(text, 6);
    expect(applySuggestion(text, s[0]).text).toBe('з Святошина до Малина');
  });

  it('не більше чотирьох підказок', () => {
    expect(at('ма').length).toBeLessThanOrEqual(4);
  });
});
