/**
 * Юніт-тести inline-роутера (@бот у чатах).
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  INLINE_QUERY_PREFIX,
  matchInlineQueryPrefix,
  isInlineMenuQuery,
  buildInlineHelpMessageText,
  buildListingShareMessageText,
} from './telegram-inline';
import { parseInlineRidesQueryPayload, startOfLocalDay, addLocalDays } from './inline-listings';
import { REFERRAL_INLINE_QUERY_PREFIX } from './referral';

describe('inline query routing', () => {
  it('empty query → menu', () => {
    assert.equal(isInlineMenuQuery(''), true);
    assert.equal(matchInlineQueryPrefix('').kind, 'menu');
  });

  it('known prefixes', () => {
    assert.equal(matchInlineQueryPrefix('ref_share').kind, 'ref_share');
    assert.equal(matchInlineQueryPrefix('rides_today').kind, 'rides_today');
    assert.equal(matchInlineQueryPrefix('rides завтра київ').kind, 'rides');
    assert.equal(matchInlineQueryPrefix('rides завтра київ').payload, 'завтра київ');
    assert.equal(matchInlineQueryPrefix('help').kind, 'help');
    assert.equal(matchInlineQueryPrefix('book').kind, 'book');
    assert.equal(matchInlineQueryPrefix('share_listing_42').kind, 'share_listing');
    assert.equal(matchInlineQueryPrefix('share_listing_42').payload, '42');
    assert.equal(matchInlineQueryPrefix('setup_phone').kind, 'setup_phone');
    assert.equal(matchInlineQueryPrefix('unknown_stuff').kind, 'unknown');
  });

  it('referral prefix constant aligned', () => {
    assert.equal(INLINE_QUERY_PREFIX.REF_SHARE, REFERRAL_INLINE_QUERY_PREFIX);
  });
});

describe('inline rides query parse', () => {
  it('today and tomorrow', () => {
    const today = startOfLocalDay(new Date());
    const t = parseInlineRidesQueryPayload('');
    assert.equal(t.dateFrom?.getTime(), today.getTime());
    assert.equal(t.dateTo?.getTime(), addLocalDays(today, 1).getTime());

    const tm = parseInlineRidesQueryPayload('завтра');
    assert.equal(tm.dateFrom?.getTime(), addLocalDays(today, 1).getTime());
  });

  it('route hints', () => {
    const k = parseInlineRidesQueryPayload('київ');
    assert.equal(k.routeHint, 'Kyiv');
    assert.equal(k.futureFromToday, true);
  });
});

describe('inline message builders', () => {
  it('help text mentions bot', () => {
    const text = buildInlineHelpMessageText('test_bot');
    assert.ok(text.includes('@test_bot'));
    assert.ok(text.includes('/allrides'));
  });

  it('listing share includes book link', () => {
    const listing = {
      id: 7,
      listingType: 'driver',
      route: 'Kyiv-Malyn',
      date: new Date('2026-08-10T12:00:00.000Z'),
      departureTime: '09:00',
      seats: 3,
      phone: '380671234567',
      senderName: 'Тест',
      notes: null,
      priceUah: 200,
      personId: 1,
    };
    const text = buildListingShareMessageText(
      listing,
      'test_bot',
      (d) => d.toISOString().slice(0, 10),
      (r) => r
    );
    assert.ok(text.includes('book_viber_7'));
    assert.ok(text.includes('test_bot'));
  });
});
