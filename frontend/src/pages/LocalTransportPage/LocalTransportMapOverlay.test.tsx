import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/utils';
import { LocalTransportMapOverlay } from './LocalTransportMapOverlay';

describe('LocalTransportMapOverlay', () => {
  it('renders nothing while closed', () => {
    renderWithProviders(
      <LocalTransportMapOverlay open={false} onClose={() => {}}>
        <div>map</div>
      </LocalTransportMapOverlay>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a modal dialog, locks the page scroll, focuses «Готово» and closes on Escape / «Готово»', () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = renderWithProviders(
      <LocalTransportMapOverlay open onClose={onClose} subtitle="Звідки: Центр · Куди: Вокзал">
        <div data-testid="map">map</div>
      </LocalTransportMapOverlay>
    );
    const dialog = screen.getByRole('dialog', { name: 'Карта' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('map')).toBeInTheDocument();
    expect(screen.getByText('Звідки: Центр · Куди: Вокзал')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('button', { name: 'Готово' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    rerender(
      <LocalTransportMapOverlay open={false} onClose={onClose}>
        <div data-testid="map">map</div>
      </LocalTransportMapOverlay>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
