/**
 * «Доведе» — картка метро: табличка станції з напрямком, схема з крапкою на кожну станцію, пересадка,
 * автобус замість метро, жетон з ціною, «не працює».
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StoryLeg } from '../compose/types';
import { mapsTransitUrl, metroTrip } from '../data/kyiv';
import { MetroCard } from './MetroCard';

function leg(from: string, to: string, at = { mins: 12 * 60, date: '2026-11-17' }): Extract<StoryLeg, { kind: 'metro' }> {
  const t = metroTrip(from, to, at)!;
  return { kind: 'metro', segments: t.segments, transfers: t.transfers, minutes: t.minutes, depMins: at.mins, arrMins: at.mins + t.minutes, headwayMin: t.headwayMin, priceUah: t.priceUah, closed: t.closed, mapsUrl: mapsTransitUrl('a', 'b') };
}

describe('картка метро', () => {
  it('одна лінія: табличка зі станцією посадки й напрямком, крапка на кожну станцію, жетон 30 грн', () => {
    const { container } = render(<MetroCard l={leg('kyiv.sviatoshyn', 'kyiv.pas')} />);
    const plate = container.querySelector('.dv-metro__plate')!;
    expect(plate.textContent).toContain('Святошин');
    expect(plate.textContent).toContain('М1 у бік «Лісова»');
    const strip = screen.getByRole('list', { name: 'М1: від «Святошин» до «Вокзальна», 5 станцій' });
    expect(within(strip).getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByText('5 станцій · вийти на «Вокзальна»')).toBeInTheDocument();
    expect(screen.getByLabelText('Одна поїздка — 30 гривень')).toBeInTheDocument();
    expect(screen.getByText(/Разом ≈ 20 хв/)).toBeInTheDocument();
    expect(screen.getByText(/поїзди кожні ≈ 6 хв/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Google Maps ↗' })).toHaveAttribute('target', '_blank');
    expect(container.querySelector('.dv-metro__change')).toBeNull();
  });

  it('пересадка: дві таблички різних ліній і рядок «Пересадка» між ними', () => {
    const { container } = render(<MetroCard l={leg('kyiv.akadem', 'kyiv.obolon')} />);
    expect(container.querySelectorAll('.dv-metro__plate')).toHaveLength(2);
    expect(screen.getByText(/Пересадка: «Хрещатик» → «Майдан Незалежності»/)).toBeInTheDocument();
    expect(container.querySelectorAll('.dv-metro__plate')[1].textContent).toContain('М2 у бік «Героїв Дніпра»');
  });

  it('автобус замість метро: окрема табличка «А №318» і рядок про те, що далі поїзди не ходять', () => {
    const { container } = render(<MetroCard l={leg('kyiv.m.zoloti-vorota', 'kyiv.m.pozniaky')} />);
    expect(screen.getByText('Далі поїзди не ходять — автобус №318 від «Видубичі»')).toBeInTheDocument();
    const bus = container.querySelector('.dv-metro__seg--bus')!;
    expect(bus.textContent).toContain('№318 автобус замість метро, у бік «Червоний хутір»');
    expect(bus.querySelector('.dv-metro__m')!.textContent?.trim()).toBe('А');
  });

  it('поза годинами роботи: каже, що метро не працює, шлях лишається для довідки', () => {
    const { container } = render(<MetroCard l={leg('kyiv.sviatoshyn', 'kyiv.pas', { mins: 23 * 60 + 20, date: '2026-11-17' })} />);
    expect(screen.getByText(/Метро о цій порі не працює: вхід 05:30–23:00/)).toBeInTheDocument();
    expect(container.querySelector('.dv-metro--closed')).not.toBeNull();
    expect(screen.getByText(/У дорозі ≈/)).toBeInTheDocument();
  });
});
