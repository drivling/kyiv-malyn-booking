/**
 * «Доведе» · обхід у ширину для наповнення бази доріг містом: фраза команди `npm run dovede:crawl` розбирається
 * словником сторінки. Ядро обходу — `backend/src/dovede/crawl-core.ts` (тест поруч із ним), форма назви —
 * `nlu/cityDetail.ts` (тест рівності з `parseLocal` — `nlu/cityDetail.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { seedFromIntent } from '../../../backend/src/dovede/crawl-core';
import { parseLocal } from '@/pages/DovedePage/nlu/parseLocal';

describe('dovede-crawl: фраза → з чого почати', () => {
  it('бере місце словами так, як його розбирає сторінка', () => {
    const k = { date: '2026-11-17', mins: 600 };
    expect(seedFromIntent(parseLocal('з Малина до Києва на вулицю Ентузіастів 7', k).intent)).toEqual({ city: 'Kyiv', place: 'вулиця Ентузіастів 7', dir: 'to' });
    expect(seedFromIntent(parseLocal('з Києва від ТРЦ Лавина до Малина завтра зранку', k).intent)).toEqual({ city: 'Kyiv', place: 'ТРЦ Лавина', dir: 'from' });
    expect(seedFromIntent(parseLocal('з Малина в Житомир на Польову 12', k).intent)).toEqual({ city: 'Zhytomyr', place: 'Польова 12', dir: 'to' });
    // станція метро — власні дані: сервер про неї не питають
    expect(seedFromIntent(parseLocal('з Малина до Києва до Лівобережної', k).intent)).toBeNull();
  });
});
