import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UpdateBanner } from './UpdateBanner';
import { resetServiceWorkerForTests, setUpdateReady } from './serviceWorker';

function mount(path = '/transport', reload?: () => void) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <UpdateBanner reload={reload} />
    </MemoryRouter>
  );
}

describe('UpdateBanner (Docs/transport-pwa-2026-10.md, фаза 4)', () => {
  afterEach(() => resetServiceWorkerForTests());

  it('мовчить, поки нової збірки нема; показується, коли вона відома; «Пізніше» ховає', () => {
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    act(() => setUpdateReady('sw:abc'));
    expect(screen.getByRole('status')).toHaveTextContent('Доступна нова версія сайту');
    fireEvent.click(screen.getByRole('button', { name: 'Пізніше' }));
    expect(container).toBeEmptyDOMElement();
  });

  it('«Оновити» без воркера, що чекає — повне завантаження', () => {
    const reload = vi.fn();
    mount('/transport/stop/st_0001', reload);
    act(() => setUpdateReady('/assets/index-NEW.js'));
    fireEvent.click(screen.getByRole('button', { name: 'Оновити' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('на /admin не показується', () => {
    const { container } = mount('/admin/stickers');
    act(() => setUpdateReady('sw:abc'));
    expect(container).toBeEmptyDOMElement();
  });
});
