/** Розділ «Налаштування»: групи, типове й задане, збереження числа й вмикача, «Скинути до типового», вимкнене на сервері. */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { DovedeSettingView } from '@/types';
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
  server.use(
    http.get(`${TEST_API_URL}/admin/dovede/settings`, () => HttpResponse.json({ items, groups: { ai: 'ШІ (Claude)', google: 'Google', learning: 'Фонове навчання' } })),
    http.put(`${TEST_API_URL}/admin/dovede/settings`, async ({ request }) => {
      const body = (await request.json()) as { key: string; value: number | boolean | null };
      calls.push(`${body.key}=${body.value}`);
      const s = items.find((x) => x.key === body.key)!;
      Object.assign(s, body.value === null ? { value: s.default, stored: null, updatedAt: null } : { value: body.value, stored: body.value, updatedAt: '2026-11-19T09:00:00.000Z' });
      return HttpResponse.json(s);
    }),
  );
  return { calls };
}

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
});
