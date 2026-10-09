import { describe, expect, it } from 'vitest';
import { DEFAULT_TILES, DEFAULT_TILES_ATTRIBUTION, normalizeTileTemplate, resolveMapTiles } from './mapTiles';

const CARTO = 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=k';

describe('resolveMapTiles', () => {
  it('без змінних — стандартні OSM-тайли з атрибуцією OSM (фільтр увімкнено)', () => {
    expect(resolveMapTiles({})).toEqual({ url: DEFAULT_TILES, attribution: DEFAULT_TILES_ATTRIBUTION, isDefault: true });
    expect(resolveMapTiles({ url: '  ', attribution: '' }).isDefault).toBe(true);
  });

  it('кастомний провайдер — URL і атрибуція як задано, без OSM-фільтра', () => {
    expect(resolveMapTiles({ url: CARTO, attribution: '&copy; CARTO' })).toEqual({
      url: CARTO,
      attribution: '&copy; CARTO',
      isDefault: false,
    });
  });

  it('дужки, закодовані адресним рядком (%7Bz%7D), повертаються в {z}', () => {
    expect(normalizeTileTemplate('https://x/%7Bz%7D/%7bx%7d/%7By%7D%7Br%7D.png?key=k')).toBe('https://x/{z}/{x}/{y}{r}.png?key=k');
    expect(resolveMapTiles({ url: 'https://basemaps.cartocdn.com/rastertiles/voyager/%7Bz%7D/%7Bx%7D/%7By%7D%7Br%7D.png?key=k' }).url).toBe(CARTO);
  });

  it('порожня атрибуція при кастомному URL — атрибуція OSM', () => {
    expect(resolveMapTiles({ url: CARTO }).attribution).toBe(DEFAULT_TILES_ATTRIBUTION);
  });
});
