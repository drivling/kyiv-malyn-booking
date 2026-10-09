import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { ListingContactReveal } from './ListingContactReveal';
import { apiClient } from '@/api/client';

// Підміняємо рівно один метод на справжньому клієнті. Повний мок модуля не годиться:
// test/setup.ts теж користується apiClient (setAuthToken).
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>();
  (actual.apiClient as unknown as Record<string, unknown>).getViberListingContact = vi.fn();
  return actual;
});

const mockGet = vi.mocked(apiClient.getViberListingContact);

/** Очищення робимо в тілі тесту, а не в beforeEach: із хуком vitest 4 рахує
 *  відхилення з mockImplementation як unhandled ще до того, як компонент його спіймає. */
function arrange(impl: () => Promise<{ contact: string }>) {
  mockGet.mockClear();
  mockGet.mockImplementation(impl);
}

describe('ListingContactReveal', () => {
  it('до кліку номера немає ні в тексті, ні в розмітці', () => {
    arrange(async () => ({ contact: '380679551952' }));
    const { container } = renderWithProviders(<ListingContactReveal listingId={1} />);

    expect(container.innerHTML).not.toMatch(/380/);
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByRole('button', { name: 'Показати номер' })).toBeInTheDocument();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('по кліку тягне контакт з бекенда і підставляє tel-посилання', async () => {
    arrange(async () => ({ contact: '380679551952' }));
    renderWithProviders(<ListingContactReveal listingId={42} />);

    await userEvent.click(screen.getByRole('button'));

    const link = await screen.findByRole('link');
    expect(mockGet).toHaveBeenCalledWith(42);
    expect(link).toHaveAttribute('href', 'tel:380679551952');
    expect(link).toHaveTextContent('380');
  });

  it('@username відкривається в Telegram у новій вкладці', async () => {
    arrange(async () => ({ contact: '@driver_ua' }));
    renderWithProviders(<ListingContactReveal listingId={7} />);

    await userEvent.click(screen.getByRole('button'));

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', 'https://t.me/driver_ua');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('після помилки пропонує спробувати ще раз і не показує номер', async () => {
    arrange(async () => {
      throw new Error('offline');
    });
    const { container } = renderWithProviders(<ListingContactReveal listingId={9} />);

    await userEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('Спробувати ще раз'));
    expect(container.innerHTML).not.toMatch(/380/);
    expect(container.querySelector('a')).toBeNull();
  });

  it('повторні кліки не роблять зайвих запитів', async () => {
    arrange(async () => ({ contact: '380679551952' }));
    renderWithProviders(<ListingContactReveal listingId={3} />);

    await userEvent.click(screen.getByRole('button'));
    await screen.findByRole('link');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
