/** Розділ «Налаштування»: групи, типове й задане, збереження числа й вмикача, «Скинути до типового», вимкнене на сервері. */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { DovedePageDataItem, DovedeSettingView } from '@/types';
import { DovedeSettingsSection } from './DovedeSettingsSection';

const base = (over: Partial<DovedeSettingView> & Pick<DovedeSettingView, 'key' | 'group' | 'kind' | 'label'>): DovedeSettingView => ({
  help: 'пояснення',
  value: over.kind === 'bool' ? true : 10,
  default: over.kind === 'bool' ? true : 10,
  defaultSource: 'code',
  stored: null,
  updatedAt: null,
  lockedBy: null,
  ...over,
});

function mock() {
  const items: DovedeSettingView[] = [
    base({ key: 'ai.enabled', group: 'ai', kind: 'bool', label: 'Розбір питань через ШІ' }),
    base({ key: 'ai.dailyCap', group: 'ai', kind: 'int', label: 'Викликів ШІ на день', min: 0, max: 5000, value: 300, default: 300, defaultSource: 'env', unit: 'на день' }),
    base({ key: 'city.dailyCap', group: 'google', kind: 'int', label: 'Запитів до Google на день', min: 0, max: 5000, value: 2000, default: 2450, defaultSource: 'env', stored: 2000, updatedAt: '2026-11-19T08:00:00.000Z' }),
    base({ key: 'city.own', group: 'google', kind: 'bool', label: 'Власні дані Житомира', value: false, lockedBy: 'DOVEDE_CITY_OWN=0' }),
    base({ key: 'learn.sharePct', group: 'learning', kind: 'int', label: 'Навчанню — частка денного ліміту Google, %', min: 0, max: 100, value: 50, default: 50, unit: '%' }),
  ];
  const calls: string[] = [];
  pageData.splice(
    0,
    pageData.length,
    { key: 'metro.shuttle', label: 'Автобус замість метро', help: 'Дільниця лінії без поїздів.', changed: false, value: null, updatedAt: null },
    { key: 'metro.service', label: 'Години й тариф метро', help: 'Вхід, закриття, тариф.', changed: false, value: null, updatedAt: null },
  );
  server.use(
    http.get(`${TEST_API_URL}/admin/dovede/settings`, () => HttpResponse.json({ items, groups: { ai: 'ШІ (Claude)', google: 'Google', learning: 'Фонове навчання' } })),
    http.put(`${TEST_API_URL}/admin/dovede/settings`, async ({ request }) => {
      const body = (await request.json()) as { key: string; value: number | boolean | null };
      calls.push(`${body.key}=${body.value}`);
      const s = items.find((x) => x.key === body.key)!;
      Object.assign(s, body.value === null ? { value: s.default, stored: null, updatedAt: null } : { value: body.value, stored: body.value, updatedAt: '2026-11-19T09:00:00.000Z' });
      return HttpResponse.json(s);
    }),
    http.get(`${TEST_API_URL}/admin/dovede/page-data`, () => HttpResponse.json({ items: pageData })),
    http.put(`${TEST_API_URL}/admin/dovede/page-data`, async ({ request }) => {
      const body = (await request.json()) as { key: string; value?: unknown; reset?: boolean };
      calls.push(`page:${body.key}=${body.reset ? 'reset' : JSON.stringify(body.value)}`);
      const it = pageData.find((x) => x.key === body.key)!;
      Object.assign(it, body.reset ? { changed: false, value: null, updatedAt: null } : { changed: true, value: body.value, updatedAt: '2026-11-19T09:00:00.000Z' });
      return HttpResponse.json(it);
    }),
  );
  return { calls };
}

const pageData: DovedePageDataItem[] = [];

describe('DovedeSettingsSection', () => {
  it('три групи; типове зі змінної сервера й задане власником видно; вимкнене на сервері не вмикається', async () => {
    mock();
    render(<DovedeSettingsSection />);
    const ai = await screen.findByRole('group', { name: 'ШІ (Claude)' });
    expect(within(ai).getByLabelText('Викликів ШІ на день')).toHaveValue(300);
    expect(within(ai).getByText('типове з сервера: 300')).toBeInTheDocument();
    const google = screen.getByRole('group', { name: 'Google' });
    expect(within(google).getByLabelText('Запитів до Google на день')).toHaveValue(2000);
    expect(within(google).getByText(/змінено 19 листопада, типове — 2450/)).toBeInTheDocument();
    const own = within(google).getByRole('switch', { name: 'Власні дані Житомира' });
    expect(own).toBeDisabled();
    expect(within(google).getByText('Вимкнено на сервері (DOVEDE_CITY_OWN=0) — тут не ввімкнути.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Фонове навчання' })).toBeInTheDocument();
  });

  it('число: поза межами зберегти не дає; зберігає; «Скинути до типового» шле null; вмикач зберігається одразу', async () => {
    const { calls } = mock();
    const user = userEvent.setup();
    render(<DovedeSettingsSection />);
    const share = (await screen.findByLabelText('Навчанню — частка денного ліміту Google, %')) as HTMLInputElement;
    const row = within(share.closest('.admin-kit-setting') as HTMLElement);
    expect(row.getByRole('button', { name: 'Зберегти' })).toBeDisabled();
    await user.clear(share);
    await user.type(share, '150');
    expect(row.getByText('Ціле число від 0 до 100.')).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Зберегти' })).toBeDisabled();
    await user.clear(share);
    await user.type(share, '30');
    await user.click(row.getByRole('button', { name: 'Зберегти' }));
    await screen.findByText('Збережено: «Навчанню — частка денного ліміту Google, %». Діє протягом хвилини.');
    await user.click(await row.findByRole('button', { name: 'Скинути до типового' }));
    await screen.findByText('«Навчанню — частка денного ліміту Google, %» — знову типове: 50.');
    expect(share.value).toBe('50');

    await user.click(screen.getByRole('switch', { name: 'Розбір питань через ШІ' }));
    await screen.findByText('Збережено: «Розбір питань через ШІ». Діє протягом хвилини.');
    expect(calls).toEqual(['learn.sharePct=30', 'learn.sharePct=null', 'ai.enabled=false']);
  });

  it('дані сторінки: автобус замість метро — вимкнути, увімкнути на іншій дільниці; години й тариф; назад до коду', async () => {
    const { calls } = mock();
    const user = userEvent.setup();
    render(<DovedeSettingsSection />);
    const group = await screen.findByRole('group', { name: 'Дані сторінки' });
    expect(within(group).getByText(/Зараз: М3: після «Видубичі» до «Червоний хутір» — автобус №318 \(станцій 7\)/)).toBeInTheDocument();
    expect(within(group).getAllByText('типове з коду')).toHaveLength(2);

    // поїзди знову їздять усюди
    await user.click(within(group).getByLabelText('автобус замість метро'));
    const [saveShuttle] = within(group).getAllByRole('button', { name: 'Зберегти' });
    await user.click(saveShuttle);
    expect(calls[calls.length - 1]).toBe('page:metro.shuttle=null');
    expect(await within(group).findByText(/Зараз: метро їздить усюди/)).toBeInTheDocument();

    // автобус лише до Позняків, №777
    await user.click(within(group).getByLabelText('автобус замість метро'));
    await user.selectOptions(within(group).getByLabelText('Автобус їде до'), 'kyiv.m.pozniaky');
    const bus = within(group).getByLabelText('Автобус №');
    await user.clear(bus);
    await user.type(bus, '777');
    expect(within(group).getByText('Автобусом: Славутич, Осокорки, Позняки.')).toBeInTheDocument();
    await user.click(within(group).getAllByRole('button', { name: 'Зберегти' })[0]);
    const sent = JSON.parse(calls[calls.length - 1]!.replace('page:metro.shuttle=', ''));
    expect(sent).toMatchObject({ line: 'M3', after: 'kyiv.m.vydubychi', stations: ['kyiv.m.slavutych', 'kyiv.m.osokorky', 'kyiv.m.pozniaky'], bus: '777', hopSeconds: 200, waitSeconds: 300 });

    // години й тариф
    const fare = within(group).getByLabelText('Тариф, грн');
    await user.clear(fare);
    await user.type(fare, '35');
    await user.click(within(group).getAllByRole('button', { name: 'Зберегти' })[1]);
    expect(calls[calls.length - 1]).toBe('page:metro.service={"openMins":330,"closeMins":1380,"fareUah":35}');

    await user.click(within(group).getAllByRole('button', { name: 'Скинути до типового з коду' })[0]);
    expect(calls[calls.length - 1]).toBe('page:metro.shuttle=reset');
    expect(await within(group).findByText('«Автобус замість метро» — знову типове з коду.')).toBeInTheDocument();
  });
});
