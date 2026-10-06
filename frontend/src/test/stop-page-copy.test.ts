import { describe, expect, it } from 'vitest';
import {
  STOP_HUB_FAQ,
  stopArticleDescription,
  stopFallbackDescription,
  stopPageTitle,
  stopRoutesFaq,
} from '../../scripts/stop-page-copy.mjs';
import { stopArticlePlainText } from '@/content/stops';

describe('stop-page-copy (SPA board + static prerender share it)', () => {
  it('title, fallback description and FAQ wording', () => {
    expect(stopPageTitle('Базар')).toBe('Зупинка «Базар» — розклад маршруток Малина | malin.kiev.ua');
    expect(stopFallbackDescription('Базар', ['2', '3'])).toBe(
      'Табло зупинки «Базар» у Малині: маршрути №2, №3. Наступні відправлення міського транспорту.'
    );
    expect(stopFallbackDescription('Базар', [])).toBe('Табло зупинки «Базар» у Малині. Наступні відправлення міського транспорту.');
    const faq = stopRoutesFaq('Базар', ['2', '3'], 'st_a');
    expect(faq.q).toBe('Які маршрутки зупиняються на «Базар»?');
    expect(faq.a).toContain('№2, №3');
    expect(faq.a).toContain('malin.kiev.ua/transport/stop/st_a');
    expect(stopRoutesFaq('Базар', [], 'st_a').a).toContain('malin.kiev.ua/transport/stop/st_a');
    expect(STOP_HUB_FAQ).toHaveLength(2);
    expect(STOP_HUB_FAQ[1].q).toContain('«Звідки → Куди»');
  });

  it('the article description is one helper for the SPA and the static page', () => {
    const article = { id: 'st_a', name: 'Базар', place: 'центр міста', routeIds: ['2', '3'] };
    expect(stopArticleDescription(article)).toBe('Зупинка «Базар» у Малині — центр міста. Маршрути: №2, №3.');
    expect(stopArticlePlainText(article)).toBe(stopArticleDescription(article));
    expect(stopArticleDescription({ name: 'Базар', lead: ' Опис. ' })).toBe('Опис.');
    expect(stopArticleDescription({ name: 'Базар' })).toBe('Зупинка «Базар» у Малині.');
  });
});
