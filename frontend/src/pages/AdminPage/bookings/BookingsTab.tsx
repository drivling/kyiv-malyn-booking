import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { formatPhoneDisplay, getBookingRouteDisplayLabel, getRouteBadgeClass, supportPhoneToTelLink } from '@/utils/constants';
import type { Booking } from '@/types';
import { AdminSectionHeader, ChipGroup, EmptyState, StatTile, StatTiles } from '../kit';
import {
  bookingKind,
  bookingTiles,
  dayTitle,
  EMPTY_BOOKING_FILTER,
  filterBookings,
  groupByDay,
  isBookingWhen,
  kyivDate,
  seatsWord,
  whenCounts,
  type BookingWhen,
} from './bookingsText';
import '../SchedulesTab.css';
import './BookingsTab.css';

const createdText = (iso: string) =>
  new Date(iso).toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * Вкладка «Бронювання» (`/admin`, `/admin/bookings`): хто записався на маршрутки й попутки. Угорі — плитки (попереду,
 * сьогодні, завтра — з місцями; нових за 7 днів), далі фільтр «Попереду · Сьогодні · Минулі · Усі» (`?when=`), тип,
 * маршрут, дата й пошук; бронювання — за днями поїздки, одне — один рядок. Запити ті самі (список і видалення).
 */
export const BookingsTab: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const whenParam = params.get('when');
  const when: BookingWhen = isBookingWhen(whenParam) ? whenParam : 'upcoming';
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState(EMPTY_BOOKING_FILTER);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setBookings(await apiClient.getBookings());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const today = kyivDate();
  const tiles = useMemo(() => bookingTiles(bookings, today), [bookings, today]);
  const counts = useMemo(() => whenCounts(bookings, today), [bookings, today]);
  const shown = useMemo(() => filterBookings(bookings, { ...filter, when }, today), [bookings, filter, when, today]);
  const days = useMemo(() => groupByDay(shown), [shown]);
  const routes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of bookings) if (!seen.has(b.route)) seen.set(b.route, getBookingRouteDisplayLabel(b.route));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], 'uk'));
  }, [bookings]);
  const filtered = Boolean(filter.kind || filter.route || filter.date || filter.query);

  const setWhen = (next: BookingWhen) => {
    const p = new URLSearchParams(params);
    if (next === 'upcoming') p.delete('when');
    else p.set('when', next);
    setParams(p, { replace: true });
  };
  const patch = (p: Partial<typeof filter>) => setFilter((f) => ({ ...f, ...p }));

  const remove = async (b: Booking) => {
    if (!window.confirm(`Видалити бронювання #${b.id} (${b.name}, ${b.seats} ${seatsWord(b.seats)})?`)) return;
    setError('');
    setSuccess('');
    try {
      await apiClient.deleteBooking(b.id);
      setSuccess(`Бронювання #${b.id} видалено.`);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка видалення');
    }
  };

  return (
    <div className="tab-content bookings-tab">
      <AdminSectionHeader
        title="Бронювання"
        purpose="Хто записався на маршрутки й попутки: поїздки по днях, скільки місць, як звʼязатись."
        actions={
          <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void load()} disabled={loading}>
            Оновити
          </button>
        }
      />

      <StatTiles label="Бронювання">
        <StatTile label="Попереду" value={tiles.upcoming} sub={`${tiles.upcomingSeats} ${seatsWord(tiles.upcomingSeats)} · попуток ${tiles.upcomingRides}`} />
        <StatTile label="Сьогодні" value={tiles.today} sub={`${tiles.todaySeats} ${seatsWord(tiles.todaySeats)}`} to={when !== 'today' && tiles.today ? '/admin/bookings?when=today' : undefined} />
        <StatTile label="Завтра" value={tiles.tomorrow} sub={`${tiles.tomorrowSeats} ${seatsWord(tiles.tomorrowSeats)}`} />
        <StatTile label="Нових за 7 днів" value={tiles.week} sub={`з них попуток ${tiles.weekRides}`} />
      </StatTiles>

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <div className="bookings-toolbar" role="group" aria-label="Фільтри">
        <ChipGroup
          label="Коли"
          value={when}
          onChange={setWhen}
          options={[
            { value: 'upcoming', label: `Попереду ${counts.upcoming}` },
            { value: 'today', label: `Сьогодні ${counts.today}` },
            { value: 'past', label: `Минулі ${counts.past}` },
            { value: 'all', label: `Усі ${counts.all}` },
          ]}
        />
        <ChipGroup
          label="Тип"
          value={filter.kind}
          onChange={(kind) => patch({ kind })}
          options={[
            { value: '', label: 'Усі' },
            { value: 'schedule', label: 'Маршрутки' },
            { value: 'viber_match', label: 'Попутки' },
          ]}
        />
      </div>
      <div className="bookings-toolbar">
        <input
          type="search"
          className="bookings-input bookings-input--grow"
          placeholder="Імʼя або телефон"
          value={filter.query}
          onChange={(e) => patch({ query: e.target.value })}
          aria-label="Пошук по імені або телефону"
        />
        <select className="bookings-input" value={filter.route} onChange={(e) => patch({ route: e.target.value })} aria-label="Маршрут">
          <option value="">Усі маршрути</option>
          {routes.map(([slug, label]) => (
            <option key={slug} value={slug}>
              {label}
            </option>
          ))}
        </select>
        <input type="date" className="bookings-input" value={filter.date} onChange={(e) => patch({ date: e.target.value })} aria-label="Дата" />
        {filtered && (
          <button type="button" className="admin-kit-linkbtn" onClick={() => setFilter(EMPTY_BOOKING_FILTER)}>
            Скинути фільтри
          </button>
        )}
      </div>

      {loading && !bookings.length ? (
        <p className="bookings-muted" aria-live="polite">
          Завантаження…
        </p>
      ) : days.length === 0 ? (
        <EmptyState
          action={
            when === 'upcoming' && counts.past > 0 ? (
              <button type="button" className="admin-kit-linkbtn" onClick={() => setWhen('past')}>
                Показати минулі
              </button>
            ) : undefined
          }
        >
          {when === 'upcoming' && !filtered ? 'Попереду бронювань немає.' : 'Бронювань за цими фільтрами немає.'}
        </EmptyState>
      ) : (
        days.map((d) => (
          <section key={d.date} className="bookings-day" aria-label={dayTitle(d.date, today)}>
            <h3 className="bookings-day__title">
              {dayTitle(d.date, today)}
              <span className="bookings-muted">
                {' '}
                · бронювань {d.bookings.length} · {d.seats} {seatsWord(d.seats)}
              </span>
            </h3>
            <ul className="bookings-rows">
              {d.bookings.map((b) => {
                const ride = bookingKind(b) === 'viber_match';
                const tel = supportPhoneToTelLink(b.phone);
                return (
                  <li key={b.id} className="bookings-row" aria-label={`Бронювання #${b.id}`}>
                    <strong className="bookings-time">{b.departureTime}</strong>
                    <span className={`badge ${getRouteBadgeClass(b.route)} bookings-route`}>{getBookingRouteDisplayLabel(b.route)}</span>
                    <span className="bookings-seats">
                      {b.seats} {seatsWord(b.seats)}
                    </span>
                    <span className="bookings-who">
                      <strong>{b.name}</strong>
                      {tel ? (
                        <a href={tel} className="bookings-phone">
                          {formatPhoneDisplay(b.phone)}
                        </a>
                      ) : (
                        <span className="bookings-phone">{formatPhoneDisplay(b.phone)}</span>
                      )}
                    </span>
                    <span className="sched-tags">
                      <span className={`sched-tag${ride ? ' bookings-tag--ride' : ''}`}>
                        {ride ? `попутка${b.viberListingId ? ` · оголошення #${b.viberListingId}` : ''}` : 'маршрутка'}
                      </span>
                    </span>
                    <span className="bookings-muted bookings-created">
                      #{b.id} · створено {createdText(b.createdAt)}
                    </span>
                    <button type="button" className="admin-kit-linkbtn bookings-danger" onClick={() => void remove(b)}>
                      Видалити
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
};
