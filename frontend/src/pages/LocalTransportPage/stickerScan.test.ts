import { describe, it, expect } from 'vitest';
import { parseStickerCampaign, stripUtm } from './stickerScan';

describe('parseStickerCampaign', () => {
  it('код наклейки з utm_campaign лише для utm_source=sticker', () => {
    expect(parseStickerCampaign('?utm_source=sticker&utm_medium=qr&utm_campaign=st_0015-a')).toEqual({ stopId: 'st_0015', side: 'a' });
    expect(parseStickerCampaign('utm_source=sticker&utm_campaign=st_0019-s')).toEqual({ stopId: 'st_0019', side: 's' });
    expect(parseStickerCampaign('?utm_source=facebook&utm_campaign=st_0015-a')).toBeNull();
    expect(parseStickerCampaign('?utm_source=sticker&utm_campaign=st_0015-x')).toBeNull();
    expect(parseStickerCampaign('?utm_source=sticker&utm_medium=qr')).toBeNull();
    expect(parseStickerCampaign('')).toBeNull();
  });
});

describe('stripUtm', () => {
  it('прибирає лише utm_*, решта параметрів лишається', () => {
    expect(stripUtm('?utm_source=sticker&utm_medium=qr&utm_campaign=st_0015-a')).toBe('');
    expect(stripUtm('?d=10.10.26&utm_source=sticker&h=08%3A00&utm_campaign=st_0015-a')).toBe('?d=10.10.26&h=08%3A00');
    expect(stripUtm('')).toBe('');
  });
});
