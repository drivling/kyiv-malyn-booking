/**
 * Блок «Джерела розкладу» в редакторі графіка: список із сервера, позначка зміни, «Переглянуто»,
 * «Перевірити зараз». API — через MSW.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { BoardSourceSnapshot, WatchedSource } from '@/types';
import { SourceWatchPanel } from './SourceWatchPanel';

const SOURCES_URL = `${TEST_API_URL}/admin/transport/sources`;

const source = (over: Partial<WatchedSource>): WatchedSource => ({
  key: 'korosten-rada-timetable',
  kind: 'html-tables',
  cityCode: 'Korosten',
  label: 'Коростень: розклад автобусів на сайті ради',
  url: 'https://example.org/rozklad',
  modified: '2026-07-13T10:44:39+00:00',
  lastCheckedAt: '2026-11-09T10:00:00.000Z',
  lastChangedAt: null,
  acknowledgedAt: null,
  pending: false,
  changed: [],
  parts: 9,
  failCount: 0,
  lastError: null,
  ...over,
});

describe('SourceWatchPanel', () => {
  it('без джерел нічого не показує', async () => {
    const { container } = render(<SourceWatchPanel />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('показує зміну з переліком маршрутів; «Переглянуто» знімає позначку', async () => {
    const changed = source({
      pending: true,
      lastChangedAt: '2026-11-09T09:00:00.000Z',
      changed: ['№2', '№6'],
      changeLines: ['№6: − 07:00–07:25 Цегельний завод → Станція Житомирська', '№6: + 07:05–07:30 Цегельний завод → Станція Житомирська'],
    });
    let acked = '';
    server.use(
      http.get(SOURCES_URL, () => HttpResponse.json({ sources: [changed, source({ key: 'korosten-stops', label: 'Коростень: зупинки (data.gov.ua)' })] })),
      http.post(`${SOURCES_URL}/:key/ack`, ({ params }) => {
        acked = String(params.key);
        return HttpResponse.json({ sources: [source({})] });
      }),
    );
    render(<SourceWatchPanel />);

    expect(await screen.findByText('змінилось: 1')).toBeInTheDocument();
    expect(screen.getByText(/№2, №6/)).toBeInTheDocument();
    expect(screen.getByText('№6: + 07:05–07:30 Цегельний завод → Станція Житомирська')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Коростень: розклад автобусів на сайті ради' })).toHaveAttribute('href', 'https://example.org/rozklad');
    expect(screen.getAllByText('13.07.2026, 13:44')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Переглянуто' }));
    await waitFor(() => expect(acked).toBe('korosten-rada-timetable'));
    expect(await screen.findByText('без змін', { selector: '.source-watch-badge' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Переглянуто' })).not.toBeInTheDocument();
  });

  it('«Перевірити зараз» оновлює список; джерело, що не відповідає, видно з помилкою', async () => {
    let checks = 0;
    server.use(
      http.get(SOURCES_URL, () => HttpResponse.json({ sources: [source({ lastCheckedAt: null })] })),
      http.post(`${SOURCES_URL}/check`, () => {
        checks += 1;
        return HttpResponse.json({ results: [], sources: [source({ failCount: 2, lastError: 'HTTP 503' })] });
      }),
    );
    render(<SourceWatchPanel />);
    expect(await screen.findByText('ще не перевірялось')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Перевірити зараз' }));
    expect(await screen.findByText('не відповідає (2): HTTP 503')).toBeInTheDocument();
    expect(screen.getByText('не відповідає: 1')).toBeInTheDocument();
    expect(checks).toBe(1);
  });

  it('табло автовокзалу: кнопка «Табло» показує рейси проти цін у базі, розходження підсвічено, атрибуція є', async () => {
    const board = source({
      key: 'zhytomyr-board-malyn',
      kind: 'bus-board',
      cityCode: 'Malyn',
      label: 'Табло АС Житомир-1: рейси через Малин',
      url: 'http://tablo.example/zhytomyr',
      group: 'board',
      attribution: 'за даними табло автовокзалу Житомир-1 (МПП «ВПІ»)',
      modified: null,
    });
    const snapshot: BoardSourceSnapshot = {
      key: board.key,
      label: board.label,
      url: board.url,
      attribution: board.attribution ?? null,
      boardDate: '17 листопада 2026 р. (Вівторок)',
      lastCheckedAt: '2026-11-17T03:00:00.000Z',
      scheduleRoute: 'Zhytomyr-Malyn',
      trips: [
        { time: '06:20', from: 'Житомир', to: 'Малин', arrival: '08:30', priceUah: 334.8, carrier: 'ПП "РІМ-БОГДАН"', bus: 'ФОЛЬКСВАГЕН18', status: 'В продажі', seats: 18 },
        { time: '07:00', from: 'Житомир', to: 'Малин', arrival: '08:25', priceUah: 334.8, carrier: 'ПП "РІМ-БОГДАН"', bus: null, status: null, seats: null },
        { time: '07:40', from: 'Малин', to: 'Хмільник', arrival: '10:30', priceUah: 357.2, carrier: 'ПП "РІМ-БОГДАН"', bus: null, status: null, seats: null },
      ],
      comparison: [
        { time: '06:20', from: 'Житомир', to: 'Малин', arrival: '08:30', boardPriceUah: 334.8, carrier: 'ПП "РІМ-БОГДАН"', dbPriceUah: 335, scheduleId: 78, verdict: 'same' },
        { time: '07:00', from: 'Житомир', to: 'Малин', arrival: '08:25', boardPriceUah: 334.8, carrier: 'ПП "РІМ-БОГДАН"', dbPriceUah: null, scheduleId: null, verdict: 'missing' },
        { time: '23:30', from: null, to: 'Малин', arrival: null, boardPriceUah: null, carrier: null, dbPriceUah: 300, scheduleId: 99, verdict: 'only-db' },
      ],
    };
    let boardRequests = 0;
    server.use(
      http.get(SOURCES_URL, () => HttpResponse.json({ sources: [board] })),
      http.get(`${SOURCES_URL}/:key/board`, ({ params }) => {
        boardRequests += 1;
        expect(params.key).toBe('zhytomyr-board-malyn');
        return HttpResponse.json(snapshot);
      }),
    );
    render(<SourceWatchPanel />);

    expect(await screen.findByRole('link', { name: 'Табло АС Житомир-1: рейси через Малин' })).toBeInTheDocument();
    expect(screen.getByText('за даними табло автовокзалу Житомир-1 (МПП «ВПІ»)')).toBeInTheDocument();
    expect(boardRequests).toBe(0);

    await userEvent.click(screen.getByRole('button', { name: 'Табло' }));
    expect(await screen.findByText(/розходжень: 2/)).toBeInTheDocument();
    expect(screen.getAllByText('334,80')).toHaveLength(2); // 06:20 і 07:00 на табло
    expect(screen.getByText('збігається')).toBeInTheDocument();
    expect(screen.getByText('нема в базі')).toBeInTheDocument();
    expect(screen.getByText('лише в базі')).toBeInTheDocument();
    expect(screen.getByText(/07:40 Малин → Хмільник · 357,20 грн/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'за даними табло автовокзалу Житомир-1 (МПП «ВПІ»)' })).toHaveAttribute('href', 'http://tablo.example/zhytomyr');
    expect(boardRequests).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: 'Сховати табло' }));
    expect(screen.queryByText('збігається')).not.toBeInTheDocument();
  });
});

