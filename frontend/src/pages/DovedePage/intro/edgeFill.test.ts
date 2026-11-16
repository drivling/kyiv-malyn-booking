import { describe, expect, it } from 'vitest';
import { edgeProfile, medianColor, shareNear, type Rgb } from './edgeFill';

const WHITE: Rgb = [255, 255, 255];
const LINE: Rgb = [30, 120, 220];
const NIGHT: Rgb = [11, 20, 22];
const many = (c: Rgb, n: number): Rgb[] => Array.from({ length: n }, () => c);

describe('поля навколо ролика: колір тла біля краю кадру', () => {
  it('медіана за яскравістю — тло, навіть коли край перетинають лінії схеми', () => {
    expect(medianColor([...many(WHITE, 17), ...many(LINE, 7)])).toEqual(WHITE);
    expect(medianColor([...many(NIGHT, 20), ...many(WHITE, 4)])).toEqual(NIGHT);
    expect(medianColor([])).toEqual(WHITE);
  });

  it('частка пікселів, близьких до кольору', () => {
    expect(shareNear([...many(WHITE, 3), [250, 250, 248], LINE], WHITE)).toBe(0.8);
    expect(shareNear([], WHITE)).toBe(0);
  });

  it('строката ділянка (лінії, фото) бере колір тла всього краю, однорідна — свій', () => {
    const gradientTop: Rgb[] = many([220, 236, 240], 24);
    const busy: Rgb[] = [...many(WHITE, 12), ...many(LINE, 6), ...many(NIGHT, 6)];
    const plain: Rgb[] = many(WHITE, 24);
    const p = edgeProfile([gradientTop, busy, plain, plain]);
    expect(p.base).toEqual(WHITE);
    expect(p.cells[0]).toEqual([220, 236, 240]);
    expect(p.cells[1]).toEqual(WHITE);
    expect(p.cells[2]).toEqual(WHITE);
  });

  it('темний кадр (цитата) — темне поле', () => {
    const p = edgeProfile([many(NIGHT, 24), many(NIGHT, 24)]);
    expect(p.base).toEqual(NIGHT);
    expect(p.cells).toEqual([NIGHT, NIGHT]);
  });
});
