import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const useSiteLocalTransport = vi.fn();
vi.mock('./useSiteLocalTransport', () => ({ useSiteLocalTransport: () => useSiteLocalTransport() }));

import { LocalTransportGate } from './LocalTransportGate';
import { siteTransportCity, transportPreviewCity } from './transportCity';

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

  describe('перегляд міста адміном до запуску (?transportCity=)', () => {
    const at = (search: string) => window.history.replaceState({}, '', `/transport${search}`);
    afterEach(() => {
      localStorage.removeItem('adminToken');
      sessionStorage.clear();
      at('');
      vi.restoreAllMocks();
    });

    test('без адмін-токена параметр нічого не змінює — заглушка «скоро»', () => {
      useSiteLocalTransport.mockReturnValue({ enabled: false, loading: false });
      at('?transportCity=Korosten');
      expect(transportPreviewCity()).toBeNull();
      expect(siteTransportCity()).toBe('Malyn');
      renderGate();
      expect(screen.getByText('Скоро')).toBeTruthy();
    });

    test('з адмін-токеном: сторінка зі смугою перегляду, місто липке в межах вкладки, вихід чистить', () => {
      useSiteLocalTransport.mockReturnValue({ enabled: false, loading: false });
      localStorage.setItem('adminToken', 'token');
      at('?transportCity=korosten');
      expect(siteTransportCity()).toBe('Korosten');
      renderGate();
      expect(screen.getByText('Планувальник З → До')).toBeTruthy();
      expect(screen.getByRole('status').textContent).toContain('Коростень');

      // перехід усередині /transport без параметра — перегляд лишається
      at('');
      expect(transportPreviewCity()).toBe('Korosten');

      const assign = vi.fn();
      vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, pathname: '/transport', search: '', assign } as Location);
      fireEvent.click(screen.getByRole('button', { name: 'Вийти з перегляду' }));
      expect(assign).toHaveBeenCalledWith('/transport');
      vi.restoreAllMocks();
      expect(transportPreviewCity()).toBeNull();
      expect(siteTransportCity()).toBe('Malyn');
    });

    test('місто сайту чи невідоме місто — не перегляд', () => {
      localStorage.setItem('adminToken', 'token');
      at('?transportCity=Malyn');
      expect(transportPreviewCity()).toBeNull();
      at('?transportCity=Atlantis');
      expect(transportPreviewCity()).toBeNull();
    });
  });
});
