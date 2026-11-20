/** «Попутки»: плитки по активних, фільтр вад з адреси, рядок оголошення, зняття, правка, створення. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AdminViberListing } from '@/types';
import { kyivDate } from './viberText';

const api = vi.hoisted(() => ({
  getViberListings: vi.fn(),
  getTripRoutes: vi.fn(),
  createViberListing: vi.fn(),
  createViberListingsBulk: vi.fn(),
  updateViberListing: vi.fn(),
  deactivateViberListing: vi.fn(),
  deleteViberListing: vi.fn(),
  cleanupOldViberListings: vi.fn(),
}));
vi.mock('@/api/client', () => ({ apiClient: api }));

import { ViberTab } from './ViberTab';

const today = kyivDate();
const base: AdminViberListing = {
  id: 10,
  rawMessage: 'Київ-Малин 18:00',
  senderName: 'Інна',
  listingType: 'driver',
  route: 'Kyiv-Malyn',
  tripRouteId: 1,
  date: `${today}T00:00:00.000Z`,
  departureTime: '18:00',
  seats: 3,
  priceUah: 200,
  phone: '380671112233',
  notes: 'заберу з Академмістечка',
  isActive: true,
  authorNotifiedAt: '2026-11-19T10:00:00Z',
  createdAt: '2026-11-19T10:00:00Z',
  updatedAt: '2026-11-19T10:00:00Z',
};
const LISTINGS: AdminViberListing[] = [
  base,
  { ...base, id: 11, listingType: 'passenger', departureTime: null, tripRouteId: null, authorNotifiedAt: null, source: 'telegram1', sourceChat: 'PoDoroguem', sourceUrl: 'https://t.me/c/1/2' },
  { ...base, id: 12, isActive: false },
];

function renderAt(path = '/admin/viber') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ViberTab />
    </MemoryRouter>
  );
}

const rows = () => within(screen.getByRole('list', { name: 'Оголошення' })).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
const tile = (label: string) => screen.getByText(label, { selector: '.admin-kit-tile-label' }).closest('.admin-kit-tile') as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  api.getViberListings.mockResolvedValue(LISTINGS);
  api.getTripRoutes.mockResolvedValue([{ id: 1, slug: 'Kyiv-Malyn', labelUk: 'Київ — Малин', startPointId: 1, endPointId: 2, corridorTripRouteId: null }]);
  api.deactivateViberListing.mockResolvedValue({});
  api.updateViberListing.mockResolvedValue({});
  api.createViberListing.mockResolvedValue({});
});

describe('ViberTab', () => {
  it('плитки по активних, вади ведуть на ?issue=, знятих не видно', async () => {
    renderAt();
    await screen.findByRole('list', { name: 'Оголошення' });
    expect(tile('На дошці')).toHaveTextContent('2 водіїв 1 · пасажирів 1');
    expect(tile('Сьогодні')).toHaveTextContent('2 Telegram 1 · Viber 1');
    expect(tile('Без часу')).toHaveAttribute('href', '/admin/viber?issue=notime');
    expect(tile('Без телефону')).not.toHaveAttribute('href');
    expect(rows()).toEqual(['Оголошення #11', 'Оголошення #10']);
    const row = screen.getByRole('listitem', { name: 'Оголошення #10' });
    expect(row).toHaveTextContent('сьогодні 18:00');
    expect(row).toHaveTextContent('Київ — Малин');
    expect(row).toHaveTextContent('місць 3');
    expect(row).toHaveTextContent('Інна');
    expect(row).toHaveTextContent('автору ✓');
    const tg = screen.getByRole('listitem', { name: 'Оголошення #11' });
    expect(tg).toHaveTextContent('без часу');
    expect(tg).toHaveTextContent('без маршруту');
    expect(within(tg).getByRole('link', { name: /PoDoroguem/ })).toHaveAttribute('href', 'https://t.me/c/1/2');
  });

  it('фільтр вади з адреси й «Усі» показують зняте', async () => {
    const user = userEvent.setup();
    renderAt('/admin/viber?issue=noroute');
    await screen.findByRole('list', { name: 'Оголошення' });
    expect(rows()).toEqual(['Оголошення #11']);
    expect(screen.getByRole('button', { name: 'Без маршруту' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Будь-які' }));
    await user.click(screen.getByRole('button', { name: 'Усі 3' }));
    expect(rows()).toEqual(['Оголошення #12', 'Оголошення #11', 'Оголошення #10']);
  });

  it('«Зняти» деактивує, «Редагувати» зберігає зміни', async () => {
    const user = userEvent.setup();
    renderAt();
    const row = await screen.findByRole('listitem', { name: 'Оголошення #10' });
    await user.click(within(row).getByRole('button', { name: 'Зняти' }));
    expect(api.deactivateViberListing).toHaveBeenCalledWith(10);
    expect(await screen.findByText('Оголошення #10 знято з дошки.')).toBeInTheDocument();

    await user.click(within(screen.getByRole('listitem', { name: 'Оголошення #10' })).getByRole('button', { name: 'Редагувати' }));
    const dialog = screen.getByRole('dialog', { name: 'Оголошення #10' });
    const time = within(dialog).getByLabelText('Час');
    await user.clear(time);
    await user.type(time, '19:00');
    await user.click(within(dialog).getByRole('button', { name: 'Зберегти' }));
    expect(api.updateViberListing).toHaveBeenCalledWith(10, expect.objectContaining({ departureTime: '19:00', tripRouteId: 1, seats: 3, priceUah: 200 }));
  });

  it('«Додати з Viber»: одне повідомлення — одне оголошення', async () => {
    const user = userEvent.setup();
    renderAt();
    await screen.findByRole('list', { name: 'Оголошення' });
    await user.click(screen.getByRole('button', { name: 'Додати з Viber' }));
    const dialog = screen.getByRole('dialog', { name: 'Додати з Viber' });
    await user.type(within(dialog).getByRole('textbox'), 'Київ-Малин 18:00 0730392680');
    await user.click(within(dialog).getByRole('button', { name: 'Створити' }));
    expect(api.createViberListing).toHaveBeenCalledWith({ rawMessage: 'Київ-Малин 18:00 0730392680' });
    expect(api.createViberListingsBulk).not.toHaveBeenCalled();
  });
});
