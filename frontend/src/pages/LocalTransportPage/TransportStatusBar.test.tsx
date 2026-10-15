import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { captureInstallPrompt, resetInstallPromptForTests } from '@/pwa/installPrompt';
import { TransportStatusBar } from './TransportStatusBar';
import { formatDataAsOf } from './dataAsOf';

const prerenderWindow = window as Window & { __MALIN_PRERENDER__?: boolean };

describe('TransportStatusBar (Docs/transport-pwa-2026-10.md, фаза 2)', () => {
  afterEach(() => {
    delete prerenderWindow.__MALIN_PRERENDER__;
  });

  it('мовчить, коли мережа є, дані свіжі й помилок нема', () => {
    const { container } = render(<TransportStatusBar online source="network" dataAsOf="2026-10-14T13:17:49.327Z" error="" onRetry={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('без мережі каже, на яку дату розклад (за Києвом)', () => {
    render(<TransportStatusBar online={false} source="local" dataAsOf="2026-10-14T22:30:00.000Z" error="" onRetry={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('Без мережі — розклад станом на 15.10.2026');
    expect(screen.queryByRole('button', { name: 'Оновити' })).toBeNull();
  });

  it('сервер мовчить, а копія є — пояснює і дає «Оновити»', () => {
    const onRetry = vi.fn();
    render(<TransportStatusBar online source="snapshot" dataAsOf="2026-10-14T13:17:49.327Z" error="Failed to fetch" onRetry={onRetry} />);
    expect(screen.getByRole('status')).toHaveTextContent('Сервер не відповідає — показуємо збережений розклад станом на 14.10.2026');
    fireEvent.click(screen.getByRole('button', { name: 'Оновити' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('помилка зі свіжими даними з мережі — не наша справа (її показує сторінка)', () => {
    const { container } = render(<TransportStatusBar online source="network" dataAsOf={null} error="x" onRetry={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('під пререндером не рендериться', () => {
    prerenderWindow.__MALIN_PRERENDER__ = true;
    const { container } = render(<TransportStatusBar online={false} source="local" dataAsOf={null} error="" onRetry={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('formatDataAsOf: дата за Києвом або null', () => {
    expect(formatDataAsOf('2026-10-14T22:30:00.000Z')).toBe('15.10.2026');
    expect(formatDataAsOf('не дата')).toBeNull();
    expect(formatDataAsOf(null)).toBeNull();
  });
});

describe('TransportStatusBar: пропозиція встановити застосунок (фаза 3)', () => {
  it('з beforeinstallprompt показує «Встановити» і шле GA-подію з відповіддю діалогу', async () => {
    captureInstallPrompt();
    const gtag = vi.fn();
    window.gtag = gtag;
    render(<TransportStatusBar online source="network" dataAsOf={null} error="" onRetry={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Встановити' })).toBeNull();

    const ev = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' }> };
    ev.prompt = vi.fn(async () => undefined);
    ev.userChoice = Promise.resolve({ outcome: 'accepted' as const });
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(screen.getByText('Встановіть «Транспорт Малина» на телефон')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Встановити' }));
    });
    await waitFor(() => expect(gtag).toHaveBeenCalledWith('event', 'transport_pwa_install', { result: 'accepted' }));
    expect(screen.queryByRole('button', { name: 'Встановити' })).toBeNull();
    resetInstallPromptForTests();
    Reflect.deleteProperty(window, 'gtag');
  });
});
