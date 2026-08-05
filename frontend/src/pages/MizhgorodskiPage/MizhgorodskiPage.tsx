import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import type { Schedule, ViberListing, ViberListingType } from '@/types';
import type { BookingCity } from '@/utils/constants';
import {
  BOOKING_CITY_LABELS,
  BOOKING_FROM_TO,
  DIRECTION_ROUTES,
  formatListingContactDisplay,
  getDirectionFromCities,
  getRouteSuffix,
  listingContactHref,
} from '@/utils/constants';
import { maskSenderNameForDisplay } from '@/utils/nameMask';
import { userState } from '@/utils/userState';
import {
  CORRIDORS,
  citiesFromCorridor,
  cityLabel,
  corridorFromCity,
  formatRouteLabel,
  formatTripDate,
  getTimeMinutes,
  routeMatchesCities,
  todayISO,
  type CorridorId,
  type TransportFilter,
} from './mizhUtils';
import './MizhgorodskiPage.css';

const VALID_CITIES: BookingCity[] = ['Kyiv', 'Malyn', 'Zhytomyr', 'Korosten'];

type ResultItem =
  | { kind: 'carpool'; id: string; listing: ViberListing; sortMinutes: number }
  | { kind: 'bus'; id: string; schedule: Schedule; sortMinutes: number };

function parseCity(value: string | null): BookingCity | '' {
  if (!value) return '';
  return VALID_CITIES.includes(value as BookingCity) ? (value as BookingCity) : '';
}

export const MizhgorodskiPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialFrom = parseCity(searchParams.get('from')) || 'Kyiv';
  const initialTo = parseCity(searchParams.get('to')) || 'Malyn';
  const initialDate = searchParams.get('date') || todayISO();
  const initialValid = Boolean(getDirectionFromCities(initialFrom as BookingCity, initialTo as BookingCity));

  const [fromCity, setFromCity] = useState<BookingCity>(initialValid ? (initialFrom as BookingCity) : 'Kyiv');
  const [toCity, setToCity] = useState<BookingCity>(initialValid ? (initialTo as BookingCity) : 'Malyn');
  const [date, setDate] = useState(initialDate);
  const [transport, setTransport] = useState<TransportFilter>(
    (searchParams.get('type') as TransportFilter) || 'all'
  );
  const [listingType, setListingType] = useState<ViberListingType | ''>('');
  const [hasSearched, setHasSearched] = useState(Boolean(searchParams.get('from') && searchParams.get('to')));

  const [listings, setListings] = useState<ViberListing[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const direction = getDirectionFromCities(fromCity, toCity);
  const isTelegramLoggedIn = userState.isTelegramUser() && !!userState.getTelegramUser()?.id;

  const activeCorridor: CorridorId | null = useMemo(() => {
    return corridorFromCity(fromCity === 'Malyn' ? toCity : fromCity);
  }, [fromCity, toCity]);

  const fromOptions = (Object.entries(BOOKING_CITY_LABELS) as [BookingCity, string][]).map(([value, label]) => ({
    value,
    label,
  }));

  const toOptions = BOOKING_FROM_TO.filter((p) => p.from === fromCity).map((p) => ({
    value: p.to,
    label: BOOKING_CITY_LABELS[p.to],
  }));

  const loadResults = useCallback(async (from: BookingCity, to: BookingCity, tripDate: string) => {
    const dir = getDirectionFromCities(from, to);
    if (!dir) return;
    setLoading(true);
    setError('');
    try {
      const routes = DIRECTION_ROUTES[dir] || [];
      const [allListings, scheduleBatches] = await Promise.all([
        apiClient.getViberListings(true),
        Promise.all(routes.map((route) => apiClient.getSchedulesByRoute(route).catch(() => [] as Schedule[]))),
      ]);
      const dateKey = tripDate.slice(0, 10);
      const filteredListings = allListings.filter(
        (item) =>
          item.isActive &&
          item.date.slice(0, 10) === dateKey &&
          routeMatchesCities(item.route, from, to)
      );
      const allSchedules = scheduleBatches.flat().sort((a, b) => a.departureTime.localeCompare(b.departureTime));
      setListings(filteredListings);
      setSchedules(allSchedules);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося завантажити результати');
      setListings([]);
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const applySearch = (nextFrom = fromCity, nextTo = toCity, nextDate = date, nextType = transport) => {
    if (!getDirectionFromCities(nextFrom, nextTo)) return;
    const params: Record<string, string> = {
      from: nextFrom,
      to: nextTo,
      date: nextDate,
    };
    if (nextType !== 'all') params.type = nextType;
    setSearchParams(params, { replace: true });
    setHasSearched(true);
    void loadResults(nextFrom, nextTo, nextDate);
  };

  useEffect(() => {
    if (hasSearched && direction) {
      void loadResults(fromCity, toCity, date);
    }
    // initial load from URL only once on mount when params present
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasSearched) return;
    const params: Record<string, string> = {
      from: fromCity,
      to: toCity,
      date,
    };
    if (transport !== 'all') params.type = transport;
    setSearchParams(params, { replace: true });
  }, [transport, hasSearched, fromCity, toCity, date, setSearchParams]);

  const handleCorridor = (corridor: CorridorId) => {
    const fromMalyn = fromCity === 'Malyn';
    const { from, to } = citiesFromCorridor(corridor, fromMalyn);
    setFromCity(from);
    setToCity(to);
    applySearch(from, to, date, transport);
  };

  const handleSwap = () => {
    const nextFrom = toCity;
    const nextTo = fromCity;
    if (!getDirectionFromCities(nextFrom, nextTo)) return;
    setFromCity(nextFrom);
    setToCity(nextTo);
    applySearch(nextFrom, nextTo, date, transport);
  };

  const handleFromChange = (value: BookingCity) => {
    setFromCity(value);
    const stillValid = BOOKING_FROM_TO.some((p) => p.from === value && p.to === toCity);
    if (!stillValid) {
      const first = BOOKING_FROM_TO.find((p) => p.from === value);
      if (first) setToCity(first.to);
    }
  };

  const results: ResultItem[] = useMemo(() => {
    const items: ResultItem[] = [];

    if (transport !== 'bus') {
      for (const listing of listings) {
        if (listingType && listing.listingType !== listingType) continue;
        items.push({
          kind: 'carpool',
          id: `carpool-${listing.id}`,
          listing,
          sortMinutes: getTimeMinutes(listing.departureTime) ?? 24 * 60,
        });
      }
    }

    if (transport !== 'carpool') {
      for (const schedule of schedules) {
        items.push({
          kind: 'bus',
          id: `bus-${schedule.id}`,
          schedule,
          sortMinutes: getTimeMinutes(schedule.departureTime) ?? 0,
        });
      }
    }

    items.sort((a, b) => a.sortMinutes - b.sortMinutes);
    return items;
  }, [listings, schedules, transport, listingType]);

  const carpoolCount = listings.filter((l) => !listingType || l.listingType === listingType).length;
  const busCount = schedules.length;

  return (
    <div className="mizh-page">
      <header className="mizh-hero">
        <div className="mizh-hero-inner">
          <div className="mizh-hero-top">
            <div>
              <h1 className="mizh-brand">Міжміські</h1>
              <p className="mizh-brand-sub">
                Попутки та маршрутки Малин — Київ, Житомир, Коростень в одному пошуку
              </p>
            </div>
            <button type="button" className="mizh-offer-btn" disabled title="Зʼявиться в наступній ітерації">
              Запропонувати поїздку
            </button>
          </div>

          <form
            className="mizh-search"
            onSubmit={(e) => {
              e.preventDefault();
              applySearch();
            }}
          >
            <div className="mizh-corridors" role="group" aria-label="Коридори">
              {CORRIDORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`mizh-corridor-chip ${activeCorridor === c.id ? 'mizh-corridor-chip--active' : ''}`}
                  onClick={() => handleCorridor(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="mizh-search-row">
              <label className="mizh-field">
                <span className="mizh-field-label">Звідки</span>
                <select
                  className="mizh-field-control"
                  value={fromCity}
                  onChange={(e) => handleFromChange(e.target.value as BookingCity)}
                >
                  {fromOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                className="mizh-swap-btn"
                onClick={handleSwap}
                aria-label="Поміняти місцями"
                title="Поміняти місцями"
              >
                ⇄
              </button>

              <label className="mizh-field">
                <span className="mizh-field-label">Куди</span>
                <select
                  className="mizh-field-control"
                  value={toCity}
                  onChange={(e) => setToCity(e.target.value as BookingCity)}
                >
                  {toOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="mizh-field">
                <span className="mizh-field-label">Коли</span>
                <input
                  type="date"
                  className="mizh-field-control"
                  value={date}
                  min={todayISO()}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>

              <button type="submit" className="mizh-search-submit" disabled={loading}>
                {loading ? 'Шукаємо…' : 'Шукати'}
              </button>
            </div>
            <p className="mizh-search-hint">Усі маршрути проходять через Малин — оберіть коридор чипом або міста вручну.</p>
          </form>
        </div>
      </header>

      <div className="mizh-body">
        <div className="mizh-toolbar">
          <div className="mizh-transport-tabs" role="tablist" aria-label="Тип транспорту">
            {(
              [
                { id: 'all', label: `Усі${hasSearched ? ` · ${carpoolCount + busCount}` : ''}` },
                { id: 'carpool', label: `Попутки${hasSearched ? ` · ${carpoolCount}` : ''}` },
                { id: 'bus', label: `Маршрутки${hasSearched ? ` · ${busCount}` : ''}` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={transport === tab.id}
                className={`mizh-transport-tab ${transport === tab.id ? 'mizh-transport-tab--active' : ''}`}
                onClick={() => setTransport(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="mizh-stats">
            {hasSearched ? (
              <>
                <strong>
                  {cityLabel(fromCity)} → {cityLabel(toCity)}
                </strong>
                {' · '}
                {formatTripDate(date)}
              </>
            ) : (
              'Оберіть маршрут і натисніть «Шукати»'
            )}
          </div>
        </div>

        {hasSearched && transport !== 'bus' && (
          <div className="mizh-side-filters">
            <select
              className="mizh-field-control"
              value={listingType}
              onChange={(e) => setListingType(e.target.value as ViberListingType | '')}
              aria-label="Тип оголошення"
            >
              <option value="">Водії і пасажири</option>
              <option value="driver">Лише водії</option>
              <option value="passenger">Лише пасажири</option>
            </select>
            <button
              type="button"
              className="mizh-filter-btn"
              onClick={() => applySearch()}
              disabled={loading}
            >
              Оновити
            </button>
          </div>
        )}

        {error && <Alert variant="error">{error}</Alert>}

        {!hasSearched ? (
          <section className="mizh-placeholder">
            <h2>Куди їдете?</h2>
            <p>Оберіть коридор згори або міста «звідки / куди», дату — і натисніть «Шукати».</p>
          </section>
        ) : loading ? (
          <div className="mizh-state">Завантаження поїздок…</div>
        ) : results.length === 0 ? (
          <div className="mizh-state">
            Нічого не знайдено на цю дату.
            {transport !== 'all' ? ' Спробуйте вкладку «Усі» або іншу дату.' : ' Спробуйте іншу дату або запропонуйте поїздку.'}
          </div>
        ) : (
          <ul className="mizh-results" aria-label="Результати пошуку">
            {results.map((item) =>
              item.kind === 'carpool' ? (
                <li key={item.id} className="mizh-card mizh-card--carpool">
                  <div className="mizh-card-badge mizh-card-badge--carpool">Попутка</div>
                  <div className="mizh-card-body">
                    <div className="mizh-card-timeline">
                      <div className="mizh-card-time">
                        {item.listing.departureTime || '—:—'}
                      </div>
                      <div className="mizh-card-rail" aria-hidden>
                        <span className="mizh-card-dot" />
                        <span className="mizh-card-line" />
                        <span className="mizh-card-dot" />
                      </div>
                      <div className="mizh-card-cities">
                        <span>{cityLabel(fromCity)}</span>
                        <span>{cityLabel(toCity)}</span>
                      </div>
                    </div>
                    <div className="mizh-card-meta">
                      <div className="mizh-card-person">
                        <span className="mizh-card-avatar">
                          {item.listing.senderName ? item.listing.senderName.charAt(0).toUpperCase() : '?'}
                        </span>
                        <div>
                          <div className="mizh-card-name">
                            {maskSenderNameForDisplay(item.listing.senderName) ||
                              (item.listing.listingType === 'driver' ? 'Водій' : 'Пасажир')}
                          </div>
                          <div className="mizh-card-role">
                            {item.listing.listingType === 'driver' ? 'Водій' : 'Шукає попутку'}
                            {item.listing.seats != null ? ` · ${item.listing.seats} місць` : ''}
                          </div>
                        </div>
                      </div>
                      {item.listing.notes && <p className="mizh-card-notes">{item.listing.notes}</p>}
                      <div className="mizh-card-route-hint">{formatRouteLabel(item.listing.route)}</div>
                    </div>
                    <div className="mizh-card-aside">
                      <div className="mizh-card-price">
                        {item.listing.priceUah != null ? (
                          <>
                            <strong>{item.listing.priceUah}</strong>
                            <span> грн</span>
                          </>
                        ) : (
                          <strong className="mizh-card-price--soft">за домовл.</strong>
                        )}
                      </div>
                      <div className="mizh-card-actions">
                        {item.listing.listingType === 'driver' && isTelegramLoggedIn ? (
                          <Link to="/poputky" className="mizh-card-cta mizh-card-cta--primary">
                            Бронювання
                          </Link>
                        ) : (
                          <a
                            href={listingContactHref(item.listing.phone)}
                            className="mizh-card-cta mizh-card-cta--primary"
                            {...(item.listing.phone.trim().startsWith('@')
                              ? { target: '_blank', rel: 'noopener noreferrer' }
                              : {})}
                          >
                            {item.listing.phone.trim().startsWith('@') ? 'Написати' : 'Зателефонувати'}
                          </a>
                        )}
                        {item.listing.listingType === 'driver' && !isTelegramLoggedIn && (
                          <button
                            type="button"
                            className="mizh-card-cta mizh-card-cta--ghost"
                            onClick={() => navigate('/login')}
                          >
                            Увійти для бронювання
                          </button>
                        )}
                      </div>
                      {item.listing.phone && (
                        <div className="mizh-card-contact">{formatListingContactDisplay(item.listing.phone)}</div>
                      )}
                    </div>
                  </div>
                </li>
              ) : (
                <li key={item.id} className="mizh-card mizh-card--bus">
                  <div className="mizh-card-badge mizh-card-badge--bus">Маршрутка</div>
                  <div className="mizh-card-body">
                    <div className="mizh-card-timeline">
                      <div className="mizh-card-time">{item.schedule.departureTime}</div>
                      <div className="mizh-card-rail" aria-hidden>
                        <span className="mizh-card-dot mizh-card-dot--bus" />
                        <span className="mizh-card-line mizh-card-line--bus" />
                        <span className="mizh-card-dot mizh-card-dot--bus" />
                      </div>
                      <div className="mizh-card-cities">
                        <span>{cityLabel(fromCity)}</span>
                        <span>{cityLabel(toCity)}</span>
                      </div>
                    </div>
                    <div className="mizh-card-meta">
                      <div className="mizh-card-bus-title">Регулярний рейс</div>
                      <div className="mizh-card-role">
                        До {item.schedule.maxSeats} місць
                        {getRouteSuffix(item.schedule.route) ? ` · ${getRouteSuffix(item.schedule.route)}` : ''}
                      </div>
                      <div className="mizh-card-route-hint">{formatRouteLabel(item.schedule.route)}</div>
                    </div>
                    <div className="mizh-card-aside">
                      <div className="mizh-card-price mizh-card-price--soft">
                        <strong>за розкладом</strong>
                      </div>
                      <div className="mizh-card-actions">
                        <Link
                          to={`/booking?from=${fromCity}&to=${toCity}`}
                          className="mizh-card-cta mizh-card-cta--bus"
                        >
                          Забронювати
                        </Link>
                      </div>
                    </div>
                  </div>
                </li>
              )
            )}
          </ul>
        )}
      </div>
    </div>
  );
};
