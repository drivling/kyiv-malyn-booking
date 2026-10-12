import { describe, expect, it } from 'vitest';
import { buildTelegramMessageLink, describeListingOrigin } from './telegram-source-link';

describe('telegram-source-link', () => {
  it('форум: топік у посиланні; плоска група — без; без id — null', () => {
    expect(buildTelegramMessageLink({ sourceChat: 'PoDoroguem', sourceTopicId: 6, sourceMessageId: 1234 })).toBe(
      'https://t.me/PoDoroguem/6/1234',
    );
    expect(buildTelegramMessageLink({ sourceChat: '@Korosten_Kyiv', sourceTopicId: null, sourceMessageId: 77 })).toBe(
      'https://t.me/Korosten_Kyiv/77',
    );
    expect(buildTelegramMessageLink({ sourceChat: 'PoDoroguem' })).toBeNull();
    expect(buildTelegramMessageLink({})).toBeNull();
  });
  it('опис: група/топік', () => {
    expect(describeListingOrigin({ sourceChat: 'PoDoroguem', sourceTopicId: 108 })).toBe('PoDoroguem/108');
    expect(describeListingOrigin({ sourceChat: 'poputka_zhitomir', sourceTopicId: null })).toBe('poputka_zhitomir');
    expect(describeListingOrigin({ sourceChat: null })).toBeNull();
  });
});
