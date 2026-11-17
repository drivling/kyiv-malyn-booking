/**
 * «Доведе» — картка дороги містом: табличка маршруту, зупинки, пішки, звідки відповідь; без відповіді — Google Maps.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CityRoute, StoryLeg } from '../compose/types';
import { CityLegCard } from './CityLegCard';
import { checkedAgo } from './format';

type CityLeg = Extract<StoryLeg, { kind: 'city' }>;

const route = (over: Partial<CityRoute> = {}): CityRoute => ({
  source: 'google',
  fromLabel: 'автовокзал Житомир-1',
  toLabel: 'вулиця Покровська',
  minutes: 21,
  fetchedAt: new Date().toISOString(),
  steps: [
    { kind: 'walk', minutes: 3, meters: 190 },
    { kind: 'transit', minutes: 14, mode: 'BUS', line: '110', agency: 'ЖТТУ', color: '#1a73e8', headsign: 'Крошня', fromStop: 'Автовокзал', toStop: 'Агротехнічний коледж', stops: 6, headwayMin: 12 },
    { kind: 'walk', minutes: 1, meters: 50 },
  ],
  ...over,
});

const leg = (r: CityRoute | null): CityLeg => ({
  kind: 'city',
  city: 'Zhytomyr',
  cityName: 'Житомир',
  ask: { city: 'Zhytomyr', from: 'zhytomyr.avtovokzal', to: 'вулиця Покровська', date: '2026-11-17', time: '10:00' },
  fromLabel: 'автовокзал Житомир-1',
  toLabel: 'вулиця Покровська',
  route: r,
  depMins: r ? 600 : null,
  arrMins: r ? 621 : null,
  mapsUrl: 'https://www.google.com/maps/dir/?api=1',
});

describe('картка дороги містом', () => {
  it('щойно від Google: табличка з номером і видом транспорту, зупинки, пішки, підпис «за даними Google»', () => {
    const { container } = render(<CityLegCard l={leg(route())} />);
    expect(screen.getByLabelText('автобус 110')).toBeInTheDocument();
    expect(container.querySelector('.dv-city__stops')!.textContent).toContain('Автовокзал');
    expect(container.querySelector('.dv-city__stops')!.textContent).toContain('Агротехнічний коледж');
    expect(screen.getByText('у бік «Крошня» · 6 зупинок · ≈ 14 хв · кожні ≈ 12 хв')).toBeInTheDocument();
    expect(screen.getByText('ЖТТУ')).toBeInTheDocument();
    expect(screen.getAllByText(/^Пішки/)).toHaveLength(2);
    expect(screen.getByText(/Разом ≈ 21 хв/)).toBeInTheDocument();
    expect(screen.getByText(/за даними Google/)).toBeInTheDocument();
    expect(container.querySelector<HTMLElement>('.dv-city__ride')!.style.getPropertyValue('--dv-cc')).toBe('#1a73e8');
    expect(screen.getByRole('link', { name: 'Google Maps ↗' })).toHaveAttribute('target', '_blank');
  });

  it('з нашої бази: без «за даними Google», з рядком, коли перевірено', () => {
    const fetchedAt = new Date(Date.now() - 3 * 24 * 3600_000 - 60_000).toISOString();
    render(<CityLegCard l={leg(route({ source: 'stored', fetchedAt }))} />);
    expect(screen.queryByText(/за даними Google/)).toBeNull();
    expect(screen.getByText(/перевірено 3 дні тому/)).toBeInTheDocument();
  });

  it('власний розклад Житомира: час відправлення з розкладу, джерело з датою знімка, посилання на сайт розкладу', () => {
    const own = route({ source: 'own', fetchedAt: '2026-11-17T00:00:00.000Z', steps: [{ kind: 'transit', minutes: 14, mode: 'BUS', line: '58', fromStop: 'Автовокзал', toStop: 'Обласна лікарня', stops: 7, departs: '09:10' }] });
    render(<CityLegCard l={leg(own)} />);
    expect(screen.getByText('7 зупинок · ≈ 14 хв · за розкладом о 09:10')).toBeInTheDocument();
    expect(screen.getByText(/розклад zt\.rozklad\.in\.ua від 17\.11, звірено з Google/)).toBeInTheDocument();
    expect(screen.queryByText(/за даними Google/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Розклад ↗' })).toHaveAttribute('href', 'https://zt.rozklad.in.ua/');
  });

  it('лише пішки — «Пішки ≈ …», таблички немає; чужий колір не потрапляє у стиль', () => {
    const { container } = render(<CityLegCard l={leg(route({ minutes: 9, steps: [{ kind: 'walk', minutes: 9, meters: 590 }] }))} />);
    expect(container.querySelector('.dv-city__plate')).toBeNull();
    expect(container.querySelector('.dv-city__sum')!.textContent).toContain('Пішки ≈ 9 хв');
    const bad = render(<CityLegCard l={leg(route({ steps: [{ kind: 'transit', minutes: 5, mode: 'TRAM', line: '1', color: 'red; background:url(x)' }] }))} />);
    expect(bad.container.querySelector<HTMLElement>('.dv-city__ride')!.style.getPropertyValue('--dv-cc')).toBe('');
    expect(bad.getByLabelText('трамвай 1')).toBeInTheDocument();
  });

  it('відповіді немає — місто, «звідки → куди» і кнопка Google Maps', () => {
    render(<CityLegCard l={leg(null)} />);
    expect(screen.getByText('Житомир')).toBeInTheDocument();
    expect(screen.getByText('Далі містом: автовокзал Житомир-1 → вулиця Покровська')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Маршрут у Google Maps ↗' })).toBeInTheDocument();
  });

  it('«перевірено»: сьогодні, вчора, N днів тому', () => {
    const now = Date.parse('2026-11-17T12:00:00Z');
    expect(checkedAgo('2026-11-17T08:00:00Z', now)).toBe('сьогодні');
    expect(checkedAgo('2026-11-16T08:00:00Z', now)).toBe('вчора');
    expect(checkedAgo('2026-11-12T08:00:00Z', now)).toBe('5 днів тому');
    expect(checkedAgo('2026-10-27T08:00:00Z', now)).toBe('21 день тому');
    expect(checkedAgo('', now)).toBe('сьогодні');
  });
});
