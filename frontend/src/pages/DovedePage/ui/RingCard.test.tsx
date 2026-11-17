import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StoryLeg } from '../compose/types';
import { RING_SERVICE, laterRingDepartures, nextRingRide } from '../data/kyivRing';
import { RingCard } from './RingCard';

const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

function leg(fromId: string, toId: string, date: string, after: string, walk: [number, number] = [0, 0]): Extract<StoryLeg, { kind: 'ring' }> {
  const ride = nextRingRide(fromId, toId, date, hm(after))!;
  return { kind: 'ring', ride, depMins: ride.depMins, arrMins: ride.arrMins, walkBeforeMin: walk[0], walkAfterMin: walk[1], later: laterRingDepartures(ride, date), priceUah: RING_SERVICE.fareUah, mapsUrl: 'https://maps.example/x' };
}

describe('RingCard — міська електричка Києва', () => {
  it('додатковий рейс між берегами: номер, напрямок, строк дії, таблички з часом за розкладом, квиток і наступні рейси', () => {
    const { container } = render(<RingCard l={leg('kyiv.e.pochaina', 'kyiv.e.vydubychi', '2026-11-18', '16:50', [3, 3])} />);
    expect(container.querySelector('.dv-ring--extra')).not.toBeNull();
    expect(screen.getByText('Д10', { selector: 'b' })).toBeInTheDocument();
    expect(screen.getByText(/за годинниковою стрілкою/, { selector: '.dv-ring__dir' })).toBeInTheDocument();
    expect(screen.getByText('Додатковий рейс між берегами — курсує до 20 листопада')).toBeInTheDocument();
    const plates = [...container.querySelectorAll('.dv-ring__plate')].map((p) => p.textContent);
    expect(plates).toEqual(['посадкаПочайна16:59', 'вийтиВидубичі17:45']);
    expect(screen.getByText('8 станцій · 46 хв у дорозі · через Дніпро')).toBeInTheDocument();
    expect(screen.getByText('Від метро до платформи «Почайна» — ≈ 3 хв пішки')).toBeInTheDocument();
    expect(screen.getByText('Від платформи «Видубичі» до метро — ≈ 3 хв пішки')).toBeInTheDocument();
    expect(screen.getByLabelText('Квиток — 30 гривень')).toBeInTheDocument();
    expect(screen.getByText(/Наступні: 17:10 · 17:40 · 17:59/)).toBeInTheDocument();
    // усі зупинки рейсу з часом — під катом
    const stops = [...container.querySelectorAll('.dv-ring__stops li')].map((li) => li.textContent);
    expect(stops).toHaveLength(9);
    expect([stops[0], stops[6], stops[8]]).toEqual(['16:59 Почайна', '17:34 Дарниця', '17:45 Видубичі']);
    expect(screen.getByRole('link', { name: 'Google Maps ↗' })).toHaveAttribute('href', 'https://maps.example/x');
  });

  it('циферблат: дуга від посадки до виходу в бік руху, 20 поділок-станцій, на дузі — лише станції поїздки', () => {
    const { container } = render(<RingCard l={leg('kyiv.e.pochaina', 'kyiv.e.vydubychi', '2026-11-18', '16:50')} />);
    const dial = screen.getByRole('img', { name: 'Схема кільця: від «Почайна» до «Видубичі» за годинниковою стрілкою' });
    // Почайна — на «12 годині» (0°), Видубичі — через 8 станцій по 18°: 144°
    expect([dial.style.getPropertyValue('--dv-ring-a0'), dial.style.getPropertyValue('--dv-ring-a1')]).toEqual(['0deg', '144deg']);
    expect(container.querySelectorAll('.dv-ring__tick')).toHaveLength(20);
    expect(container.querySelectorAll('.dv-ring__tick.is-on')).toHaveLength(9);
    // дуга менша за півколо, за годинниковою: прапорці 0 1
    expect(container.querySelector('.dv-ring__arc')?.getAttribute('d')).toMatch(/A 88 88 0 0 1 /);
    expect(container.querySelector('.dv-ring__no')?.textContent).toBe('Д10');
  });

  it('звичайний рейс проти годинникової стрілки: без стрічки «додатковий», дуга в інший бік і довша за півколо', () => {
    const { container } = render(<RingCard l={leg('kyiv.e.sviatoshyn', 'kyiv.e.darnytsia', '2026-11-21', '15:00', [4, 0])} />);
    expect(container.querySelector('.dv-ring--extra')).toBeNull();
    expect(screen.queryByText(/Додатковий рейс/)).toBeNull();
    expect(screen.getByText(/проти годинникової стрілки/, { selector: '.dv-ring__dir' })).toBeInTheDocument();
    const dial = container.querySelector('.dv-ring__dial') as SVGElement;
    // Святошин — 270°, 9 станцій проти годинникової: 270 − 162 = 108° (Дарниця)
    expect([dial.style.getPropertyValue('--dv-ring-a0'), dial.style.getPropertyValue('--dv-ring-a1')]).toEqual(['270deg', '108deg']);
    expect(container.querySelector('.dv-ring__arc')?.getAttribute('d')).toMatch(/A 88 88 0 0 0 /);
    expect(screen.queryByText(/до метро —/)).toBeNull();
  });

  it('останній рейс дня — так і каже; одна станція — без списку зупинок', () => {
    const { container } = render(<RingCard l={leg('kyiv.e.vokzalna', 'kyiv.e.karavaievi-dachi', '2026-11-18', '23:00')} />);
    expect(screen.getByText(/Далі цього дня рейсів немає/)).toBeInTheDocument();
    expect(screen.getByText('1 станція · 6 хв у дорозі')).toBeInTheDocument();
    expect(container.querySelector('.dv-ring__stops')).toBeNull();
  });
});
