import { describe, expect, it } from 'vitest';
import type { TelegramUserSendError } from '@/types';
import { errorKind, errorTiles, kindCounts, kindHint, lastLine } from './userSenderText';

const e = (id: number, errorText: string | null, createdAt = '2026-11-24T10:00:00Z', contact = '@a'): TelegramUserSendError => ({
  id, contact, contactType: 'username', errorCode: 2, errorText, createdAt,
});

describe('userSenderText', () => {
  it('вид помилки: код Telegram, клас, рядок або код виходу', () => {
    expect(errorKind(e(1, 'Traceback…\n  File x\ntelethon.errors.PeerFloodError: PEER_FLOOD\n'))).toBe('PEER_FLOOD');
    expect(errorKind(e(2, 'RPCError 420: FLOOD_WAIT_120'))).toBe('FLOOD_WAIT');
    expect(errorKind(e(3, 'ValueError: Could not find the input entity'))).toBe('ValueError');
    expect(errorKind(e(4, 'просто збій'))).toBe('просто збій');
    expect(errorKind(e(5, null))).toBe('код 2');
    expect(lastLine('a\n\n b \n')).toBe('b');
    expect(kindHint('PRIVACY_PREMIUM_REQUIRED')).toMatch(/Premium/);
  });

  it('групи від найчастішої й плитки', () => {
    const list = [
      e(1, 'PeerFloodError: PEER_FLOOD', '2026-11-24T09:00:00Z', '1'),
      e(2, 'PeerFloodError: PEER_FLOOD', '2026-11-20T09:00:00Z', '2'),
      e(3, 'RPCError: PRIVACY_PREMIUM_REQUIRED', '2026-10-01T09:00:00Z', '2'),
    ];
    expect(kindCounts(list)).toEqual([{ kind: 'PEER_FLOOD', count: 2 }, { kind: 'PRIVACY_PREMIUM_REQUIRED', count: 1 }]);
    expect(errorTiles(list, new Date('2026-11-24T12:00:00Z'))).toEqual({ total: 3, day: 1, week: 2, contacts: 2, top: { kind: 'PEER_FLOOD', count: 2 } });
  });
});
