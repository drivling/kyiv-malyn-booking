import { expect, test, vi } from 'vitest';
import { runListingMatchJob, type ListingMatchDeps } from './listing-match-jobs';

const base = {
  id: 7,
  route: 'Kyiv-Malyn',
  date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  departureTime: '18:00',
  seats: 3,
  phone: '380501112233',
  senderName: null,
  notes: null,
  fromPointId: 1,
  toPointId: 2,
  tripRouteId: 10,
  isActive: true,
};
const job = (payload: unknown) => ({ id: 1, kind: 'listing_match', payload, status: 'running', attempts: 1, runAfter: new Date(), lockedAt: null });

function deps(listing: unknown): ListingMatchDeps & { notifyForDriver: ReturnType<typeof vi.fn>; notifyForPassenger: ReturnType<typeof vi.fn>; chatIdByPhone: ReturnType<typeof vi.fn> } {
  return {
    findListing: async () => listing as never,
    notifyForDriver: vi.fn(async () => {}),
    notifyForPassenger: vi.fn(async () => {}),
    chatIdByPhone: vi.fn(async () => '555'),
  };
}

test('водій: розсилка з authorChatId із payload, без пошуку по телефону', async () => {
  const d = deps({ ...base, listingType: 'driver' });
  expect(await runListingMatchJob(job({ listingId: 7, authorChatId: '999' }), d)).toBe('sent');
  expect(d.notifyForDriver).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), '999');
  expect(d.chatIdByPhone).not.toHaveBeenCalled();
});

test('пасажир без authorChatId: chatId по телефону', async () => {
  const d = deps({ ...base, listingType: 'passenger' });
  expect(await runListingMatchJob(job({ listingId: 7, authorChatId: null }), d)).toBe('sent');
  expect(d.chatIdByPhone).toHaveBeenCalledWith('380501112233');
  expect(d.notifyForPassenger).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), '555');
});

test('зняте, минуле або видалене оголошення — пропуск без розсилки', async () => {
  const inactive = deps({ ...base, listingType: 'driver', isActive: false });
  expect(await runListingMatchJob(job({ listingId: 7 }), inactive)).toBe('skipped_inactive');
  const past = deps({ ...base, listingType: 'driver', date: new Date('2020-01-01') });
  expect(await runListingMatchJob(job({ listingId: 7 }), past)).toBe('skipped_past');
  const missing = deps(null);
  expect(await runListingMatchJob(job({ listingId: 7 }), missing)).toBe('skipped_missing');
  expect(inactive.notifyForDriver).not.toHaveBeenCalled();
  await expect(runListingMatchJob(job({}), missing)).rejects.toThrow('listingId');
});
