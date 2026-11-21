/** Слова питання: числа — година й номер маршруту (одна-дві цифри) або номер будинку (до трьох) */
import { describe, expect, it } from 'vitest';
import { tokenize } from './normalize';

const words = (text: string) => tokenize(text).map((t) => t.n);

describe('tokenize: числа', () => {
  it('тризначне число — одне слово: будинок 120, а не 12', () => {
    expect(words('Грушевського 120')).toEqual(['грушевського', '120']);
    expect(words('вул. Шевченка, буд. 106а')).toEqual(['вул', 'шевченка', 'буд', '106', 'а']);
    expect(words('СМП 650')).toEqual(['смп', '650']);
  });

  it('час, дата й довгі числа діляться, як і раніше', () => {
    expect(words('о 18:30')).toEqual(['о', '18:30']);
    expect(words('на 8 ранку')).toEqual(['на', '8', 'ранку']);
    expect(words('о 1830')).toEqual(['о', '18', '30']);
    expect(words('20.11.2026')).toEqual(['20.11', '20', '26']);
    expect(words('0931920008')).toEqual(['09', '31', '92', '00', '08']);
    expect(words('12345')).toEqual(['12', '34', '5']);
  });

  it('позиції слів у тексті збережено', () => {
    const [, n] = tokenize('Грушевського 120');
    expect([n.start, n.end]).toEqual([13, 16]);
  });
});
