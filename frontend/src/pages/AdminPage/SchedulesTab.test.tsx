/** «Графіки»: плитки, рейси за напрямками (варіанти «через …» — в одному напрямку), фільтри, дії рейсу. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Schedule } from '@/types';
import { SchedulesTab, type SchedulesTabProps } from './SchedulesTab';

const sch = (over: Partial<Schedule> & Pick<Schedule, 'id' | 'departureTime'>): Schedule =>
  ({ route: 'Kyiv-Malyn-Irpin', maxSeats: 18, supportPhone: null, priceUah: 310, vehicleType: 'marshrutka', activeWeekdays: [1, 2, 3, 4, 5, 6, 7], tripRoute: { slug: 'Kyiv-Malyn-Irpin', labelUk: 'Київ → Малин (через Ірпінь)' }, ...over }) as Schedule;

const ROWS: Schedule[] = [
  sch({ id: 1, departureTime: '10:30', boardingPlace: 'метро «Академмістечко»', alightingPlace: 'Малин, автостанція' }),
  sch({ id: 2, departureTime: '07:00', route: 'Kyiv-Malyn-Bucha', tripRoute: { slug: 'Kyiv-Malyn-Bucha', labelUk: 'Київ → Малин (через Бучу)' } as Schedule['tripRoute'], activeWeekdays: [1, 2, 3, 4, 5] }),
  sch({ id: 3, departureTime: '05:35', route: 'Kyiv-Malyn', vehicleType: 'elektrichka', priceUah: null, tripNumber: '6601', arrivalTime: '08:01', timetableSourceUrl: 'https://swrailway.gov.ua/x', tripRoute: { slug: 'Kyiv-Malyn', labelUk: 'Київ → Малин' } as Schedule['tripRoute'] }),
  sch({ id: 4, departureTime: '06:00', route: 'Zhytomyr-Malyn', priceUah: 120, tripRoute: { slug: 'Zhytomyr-Malyn', labelUk: 'Житомир → Малин' } as Schedule['tripRoute'] }),
];

function renderTab(over: Partial<SchedulesTabProps> = {}) {
  const props: SchedulesTabProps = {
    schedules: ROWS,
    loading: false,
    routeOptions: [{ value: 'Kyiv-Malyn', label: 'Київ → Малин' }],
    routeFilter: '',
    onRouteFilter: vi.fn(),
    onReload: vi.fn(),
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onRebind: vi.fn(),
    onParse: vi.fn(),
    parsing: false,
    ...over,
  };
  render(<SchedulesTab {...props} />);
  return props;
}

describe('SchedulesTab', () => {
  it('плитки; напрямок «Київ → Малин» збирає варіанти «через …» і електрички; рейси за часом', () => {
    renderTab();
    const tiles = screen.getByRole('group', { name: 'Рейси' });
    expect(within(tiles).getByText('Рейсів').parentElement).toHaveTextContent('4');
    expect(within(tiles).getByText('Напрямків').parentElement).toHaveTextContent('2');
    expect(within(tiles).getByText('Без ціни').closest('.admin-kit-tile')).toHaveClass('admin-kit-tile--warn');
    expect(within(tiles).getByText('Не щодня').parentElement).toHaveTextContent('1');

    const kyiv = screen.getByRole('region', { name: 'Київ → Малин' });
    expect(within(kyiv).getByText('маршрутки 2 · електрички 1 · 310 грн')).toBeInTheDocument();
    expect(within(kyiv).getByText('без ціни 1')).toBeInTheDocument();
    const rows = within(kyiv).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('.sched-time strong')?.textContent)).toEqual(['05:35', '07:00', '10:30']);
    expect(rows[0]).toHaveTextContent('Е05:35 → 08:01№6601 🔗');
    expect(within(rows[0]).getByText('без ціни')).toBeInTheDocument();
    expect(within(rows[1]).getByText('через Бучу')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Пн–Пт')).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('метро «Академмістечко» → Малин, автостанція');
    expect(rows[2]).toHaveTextContent('18 місць');
    expect(rows[2]).toHaveTextContent('310 грн');
    // більший напрямок — першим
    expect(screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Київ → Малин', 'Житомир → Малин']);
  });

  it('фільтри: електрички, без ціни, нічого — одне речення', async () => {
    const user = userEvent.setup();
    renderTab({ schedules: ROWS.filter((r) => r.id !== 3) });
    const show = screen.getByRole('group', { name: 'Показати' });
    await user.click(within(show).getByRole('button', { name: 'Електрички' }));
    expect(screen.getByText('Таких рейсів немає.')).toBeInTheDocument();
    await user.click(within(show).getByRole('button', { name: 'Маршрутки' }));
    expect(screen.getAllByRole('region')).toHaveLength(2);
  });

  it('дії: змінити, видалити, додати, маршрут, парсер', async () => {
    const user = userEvent.setup();
    const p = renderTab();
    await user.click(screen.getByRole('button', { name: 'Змінити рейс 10:30 Київ → Малин' }));
    expect(p.onEdit).toHaveBeenCalledWith(ROWS[0]);
    await user.click(screen.getByRole('button', { name: 'Видалити рейс 06:00 Житомир → Малин' }));
    expect(p.onDelete).toHaveBeenCalledWith(4);
    await user.click(screen.getByRole('button', { name: 'Додати рейс' }));
    expect(p.onAdd).toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText('Маршрут'), 'Kyiv-Malyn');
    expect(p.onRouteFilter).toHaveBeenCalledWith('Kyiv-Malyn');
    await user.click(screen.getByRole('button', { name: 'Оновити графіки через парсер' }));
    expect(p.onParse).toHaveBeenCalled();
  });

  it('порожньо — «Додати перший рейс»', () => {
    renderTab({ schedules: [] });
    expect(screen.getByText('Ще немає рейсів у графіку.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Додати перший рейс' })).toBeInTheDocument();
  });
});
