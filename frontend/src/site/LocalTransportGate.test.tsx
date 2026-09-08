import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useSiteLocalTransport = vi.fn();
vi.mock('./useSiteLocalTransport', () => ({ useSiteLocalTransport: () => useSiteLocalTransport() }));

import { LocalTransportGate } from './LocalTransportGate';

function renderGate() {
  return render(
    <MemoryRouter>
      <LocalTransportGate>
        <p>Планувальник З → До</p>
      </LocalTransportGate>
    </MemoryRouter>,
  );
}

describe('LocalTransportGate', () => {
  beforeEach(() => {
    useSiteLocalTransport.mockReset();
  });

  test('місто з локальним транспортом бачить сторінку', () => {
    useSiteLocalTransport.mockReturnValue({ enabled: true, loading: false });
    renderGate();
    expect(screen.getByText('Планувальник З → До')).toBeTruthy();
  });

  test('місто без локального транспорту бачить заглушку «скоро»', () => {
    useSiteLocalTransport.mockReturnValue({ enabled: false, loading: false });
    renderGate();
    expect(screen.queryByText('Планувальник З → До')).toBeNull();
    expect(screen.getByText('Скоро')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Перейти до міжміських' }).getAttribute('href')).toBe(
      '/mizhgorodski',
    );
  });

  test('до відповіді API показує завантаження', () => {
    useSiteLocalTransport.mockReturnValue({ enabled: true, loading: true });
    renderGate();
    expect(screen.getByText('Завантаження...')).toBeTruthy();
  });
});
