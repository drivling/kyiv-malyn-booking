/**
 * Спільний рядок дати/часу планувальника і табло: чіпи «Зараз» / «Завтра» / «Сьогодні о HH:MM»,
 * останній розгортає нативні поля дати й часу.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DateTimeControls } from './DateTimeControls';
import { todayDateUrl, tomorrowDateUrl } from './dateUrl';

afterEach(() => {
  Reflect.deleteProperty(window, 'gtag');
});

describe('DateTimeControls', () => {
  it('chips row «Зараз / Завтра / Сьогодні о HH:MM»; the last one opens native date/time with prefixed ids', async () => {
    const user = userEvent.setup();
    render(<DateTimeControls date={todayDateUrl()} time="09:12" page="board" idPrefix="lt-board" onChange={vi.fn()} />);
    const group = screen.getByRole('group', { name: 'Дата і час' });
    expect(group).toBeInTheDocument();
    expect(screen.queryByLabelText('Дата')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Зараз' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Завтра' })).toHaveAttribute('aria-pressed', 'false');

    const toggle = screen.getByRole('button', { name: 'Сьогодні о 09:12' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'lt-board-datetime-panel');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const date = screen.getByLabelText('Дата');
    expect(date).toHaveAttribute('type', 'date');
    expect(date).toHaveAttribute('id', 'lt-board-date');
    expect(screen.getByLabelText('Час')).toHaveAttribute('id', 'lt-board-time');
    await user.click(toggle);
    expect(screen.queryByLabelText('Дата')).not.toBeInTheDocument();
  });

  it('a far date shows as DD.MM.YY and maps to the ISO value of the picker', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateTimeControls date="01.03.26" time="07:00" page="planner" onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: '01.03.26 о 07:00' }));
    const date = screen.getByLabelText('Дата');
    expect(date).toHaveValue('2026-03-01');
    expect(date).toHaveAttribute('id', 'lt-search-date');
    fireEvent.change(date, { target: { value: '2026-03-02' } });
    expect(onChange).toHaveBeenLastCalledWith({ date: '02.03.26', time: '07:00' });
    fireEvent.change(screen.getByLabelText('Час'), { target: { value: '08:15' } });
    expect(onChange).toHaveBeenLastCalledWith({ date: '01.03.26', time: '08:15' });
  });

  it('chips: «Завтра» keeps the time, «Зараз» resets both; each reports transport_date_chip with the page', async () => {
    const user = userEvent.setup();
    const gtag = vi.fn();
    window.gtag = gtag;
    const onChange = vi.fn();
    render(<DateTimeControls date="01.03.26" time="07:00" page="board" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Завтра' }));
    expect(onChange).toHaveBeenLastCalledWith({ date: tomorrowDateUrl(), time: '07:00' });
    expect(gtag).toHaveBeenCalledWith('event', 'transport_date_chip', { chip: 'tomorrow', page: 'board' });

    await user.click(screen.getByRole('button', { name: 'Зараз' }));
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.date).toBe(todayDateUrl());
    expect(last.time).toMatch(/^\d{2}:\d{2}$/);
    expect(gtag).toHaveBeenCalledWith('event', 'transport_date_chip', { chip: 'now', page: 'board' });
  });
});
