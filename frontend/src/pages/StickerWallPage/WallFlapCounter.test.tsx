import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WallCelebration } from './WallCelebration';
import { FLAP_AT, FLAP_STEP, WallFlapCounter } from './WallFlapCounter';
import { passengerCountdown, type Celebration } from './stickerWall';

const delays = (board: Element) =>
  [...board.querySelectorAll<HTMLElement>('.wall-flap')].map((t) => t.style.getPropertyValue('--d') || null);

describe('табло-лічильник до тисячі на стіні', () => {
  it('останні 20 новеньких перед круглою тисячею — № 981…1000, далі знову крапка', () => {
    expect(passengerCountdown(980)).toBeNull();
    expect(passengerCountdown(981)).toEqual({ from: 980, to: 981, goal: 1000, left: 19 });
    expect(passengerCountdown(1000)).toEqual({ from: 999, to: 1000, goal: 1000, left: 0 });
    expect(passengerCountdown(1001)).toBeNull();
    expect(passengerCountdown(1999)).toMatchObject({ goal: 2000, left: 1 });
    for (const n of [null, undefined, 0, -3, 37, 990.5]) expect(passengerCountdown(n)).toBeNull();
  });

  it('перегортаються лише змінені пластинки: 0986 → 0987 — одна, на третьому приземленні крапки', () => {
    const { container } = render(<WallFlapCounter from={986} to={987} />);
    const board = container.querySelector('.wall-flap-board')!;
    expect(board).toHaveAttribute('aria-hidden', 'true');
    expect(board).toHaveAttribute('data-from', '0986');
    expect(board).toHaveAttribute('data-to', '0987');
    expect(delays(board)).toEqual([null, null, null, `${FLAP_AT.toFixed(2)}s`]);
    expect(board.querySelectorAll('.wall-flap-fold')).toHaveLength(1);
    expect(board.querySelector('.wall-flap-fold')).toHaveTextContent('6');
    expect(board.querySelector('.wall-flap-unfold')).toHaveTextContent('7');
    expect(board).not.toHaveClass('wall-flap-board--goal');
  });

  it('0999 → 1000: перенос через усі чотири справа наліво, і табло тисячі синіє', () => {
    const { container } = render(<WallFlapCounter from={999} to={1000} goal />);
    const board = container.querySelector('.wall-flap-board')!;
    const at = (k: number) => `${(FLAP_AT + FLAP_STEP * k).toFixed(2)}s`;
    expect(delays(board)).toEqual([at(3), at(2), at(1), at(0)]);
    expect(board).toHaveClass('wall-flap-board--goal');
    expect([...board.querySelectorAll('.wall-flap-unfold')].map((n) => n.textContent).join('')).toBe('1000');
  });

  it('святкування новенького № 987 — табло замість крапки на порожньому місці й «до тисячі — ще 13»', () => {
    const c: Celebration = {
      key: 'new-x', kind: 'newcomer', headline: 'Новий пасажир № 987!', passenger: 987, stopId: 'st_a', name: 'Базар',
      lines: [], color: '#00aff5', added: 1, stopToday: 0, rank: 0, totalAfter: 0, newToday: 4,
    };
    const { container, rerender } = render(<WallCelebration celebration={c} />);
    expect(container.querySelector('.wall-cele')).toHaveClass('wall-cele--countdown');
    expect(container.querySelector('.wall-cele-counter .wall-cele-dot')).toBeInTheDocument();
    expect(container.querySelector('.wall-cele-dot-stage')).not.toBeInTheDocument();
    expect(screen.getByText(/до тисячі — ще/)).toHaveTextContent('до тисячі — ще 13 · нових сьогодні 4');

    rerender(<WallCelebration celebration={{ ...c, key: 'new-y', headline: 'Тисячний пасажир!', passenger: 1000 }} />);
    expect(screen.getByText(/тисяча людей/)).toHaveTextContent('тисяча людей прийшли з наклейок · нових сьогодні 4');
    expect(container.querySelector('.wall-flap-board--goal')).toBeInTheDocument();

    // № 980 — звичайна крапка
    rerender(<WallCelebration celebration={{ ...c, key: 'new-z', passenger: 980 }} />);
    expect(container.querySelector('.wall-cele--countdown')).not.toBeInTheDocument();
    expect(container.querySelector('.wall-cele-dot-stage')).toBeInTheDocument();
  });
});
