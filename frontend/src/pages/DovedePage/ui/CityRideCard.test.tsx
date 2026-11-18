/** «Доведе» — картка однієї поїздки з відповіді сервера: вигляд за видом транспорту (справжні відповіді з фікстур). */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import fixtures from '../compose/fixtures/kyiv-city-modes.json';
import type { CityRoute, CityStep, StoryLeg } from '../compose/types';
import { CityRideCard } from './CityRideCard';

type Ride = Extract<StoryLeg, { kind: 'cityRide' }>;
const answers = fixtures.answers as unknown as Record<string, { route: CityRoute }>;
const stepOf = (key: string, n = 0): CityStep => answers[key].route.steps.filter((s) => s.kind === 'transit')[n];
const ride = (step: CityStep, last = false): Ride => ({ kind: 'cityRide', city: 'Kyiv', step, depMins: 720, arrMins: 720 + step.minutes, checkedAt: last ? new Date().toISOString() : null, mapsUrl: last ? 'https://maps.example/x' : null });
const cardOf = (c: HTMLElement) => c.querySelector('.dv-ride') as HTMLElement;

describe('CityRideCard', () => {
  it('автобус: табличка з видом і номером, зупинки, подробиці; «перевірено» й карта — лише в останній поїздці', () => {
    const { container } = render(<CityRideCard l={ride(stepOf('bus'), true)} />);
    expect(cardOf(container).className).toContain('dv-ride--bus');
    expect(screen.getByLabelText('автобус 820')).toBeInTheDocument();
    expect(container.textContent).toContain('узвіз Кудрявський');
    expect(screen.getByText(/перевірено сьогодні/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Google Maps/ })).toHaveAttribute('href', 'https://maps.example/x');
    const { container: mid } = render(<CityRideCard l={ride(stepOf('bus'))} />);
    expect(mid.querySelector('.dv-ride__foot')).toBeNull();
  });

  it('кожен вид — свій клас картки', () => {
    const look = (key: string, n = 0) => cardOf(render(<CityRideCard l={ride(stepOf(key, n))} />).container).className.replace('dv-ride ', '');
    expect(look('trolleybus')).toBe('dv-ride--trolleybus');
    expect(look('tram')).toBe('dv-ride--tram');
    expect(look('speed_tram')).toBe('dv-ride--speedTram');
    expect(look('share_taxi')).toBe('dv-ride--minibus');
    expect(look('rail', 1)).toBe('dv-ride--rail');
    expect(look('funicular')).toBe('dv-ride--funicular');
  });

  it('швидкісний трамвай: станції лінією, без слова «станція» й лапок', () => {
    const { container } = render(<CityRideCard l={ride(stepOf('speed_tram'))} />);
    const ends = [...container.querySelectorAll('.dv-ride__st')].map((n) => n.textContent);
    expect(ends).toHaveLength(2);
    expect(ends.every((n) => n && !/станці|"/.test(n))).toBe(true);
    expect(container.querySelectorAll('.dv-ride__line li').length).toBe(Math.min(stepOf('speed_tram').stops ?? 1, 14) + 1);
  });

  it('фунікулер: схил, вгору від «Поштова площа» до «Михайлівська площа» (а не «Нижняя станция» Google); униз — навпаки', () => {
    const { container } = render(<CityRideCard l={ride(stepOf('funicular'))} />);
    expect(screen.getByRole('img', { name: 'Фунікулер вгору: «Поштова площа» → «Михайлівська площа»' })).toBeInTheDocument();
    expect(container.textContent).not.toContain('Нижняя');
    const down = render(<CityRideCard l={ride(stepOf('funicular_down'))} />).container;
    expect(down.querySelector('.dv-ride__hill')?.className).toContain('is-down');
    expect(down.textContent).toContain('верхня станціяМихайлівська площа');
  });
});
