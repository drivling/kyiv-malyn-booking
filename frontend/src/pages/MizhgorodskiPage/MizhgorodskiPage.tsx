import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import {
  useAnnounceDraft,
  usePageSeo,
  useRideShareRequest,
  useTelegramScenarios,
  TELEGRAM_BOT_USERNAME,
} from '@/hooks';
import type { Availability, Schedule, ViberListing, ViberListingType } from '@/types';
import type { BookingCity } from '@/utils/constants';
import {
  BOOKING_CITY_LABELS,
  BOOKING_FROM_TO,
  DIRECTION_ROUTES,
  formatListingContactDisplay,
  getDirectionFromCities,
  getRouteSuffix,
  listingContactHref,
  supportPhoneToTelLink,
} from '@/utils/constants';
import { maskSenderNameForDisplay } from '@/utils/nameMask';
import { BusBookingModal } from './BusBookingModal';
import {
  CORRIDORS,
  citiesFromCorridor,
  cityLabel,
  corridorFromCity,
  formatRouteLabel,
  formatTripDate,
  getTimeMinutes,
  routeCityLabels,
  routeMatchesCities,
  todayISO,
  tomorrowISO,
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
  usePageSeo({
    title: 'Попутки та маршрутки Малин ↔ Київ, Житомир, Коростень | malin.kiev.ua',
    canonicalUrl: 'https://malin.kiev.ua/mizhgorodski',
    description:
      'Як доїхати до Малина: попутки та маршрутки Малин ↔ Київ, Житомир, Коростень. Живий пошук поїздок і онлайн бронювання.',
  });

  const initialFrom = parseCity(searchParams.get('from')) || 'Kyiv';
  const initialTo = parseCity(searchParams.get('to')) || 'Malyn';
  const initialDate = searchParams.get('date') || todayISO();
  const initialValid = Boolean(getDirectionFromCities(initialFrom as BookingCity, initialTo as BookingCity));

  const [fromCity, setFromCity] = useState<BookingCity>(initialValid ? (initialFrom as BookingCity) : 'Kyiv');
  const [toCity, setToCity] = useState<BookingCity>(initialValid ? (initialTo as BookingCity) : 'Malyn');
  const [date, setDate] = useState(initialDate);
  const [transport, setTransport] = useState<TransportFilter>(
    (['all', 'carpool', 'bus'].includes(searchParams.get('type') || '')
      ? searchParams.get('type')
      : 'all') as TransportFilter
  );
  const [listingType, setListingType] = useState<ViberListingType | ''>('');
  const [listings, setListings] = useState<ViberListing[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [availabilityById, setAvailabilityById] = useState<Record<number, Availability>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [bookingSchedule, setBookingSchedule] = useState<Schedule | null>(null);

  const telegramScenarios = useTelegramScenarios();
  const announce = useAnnounceDraft();
  const rideshare = useRideShareRequest({
    listings,
    onNeedLogin: () => navigate('/login'),
  });

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

  const announceToOptions = announce.fields.from
    ? BOOKING_FROM_TO.filter((p) => p.from === announce.fields.from).map((p) => ({
        value: p.to,
        label: BOOKING_CITY_LABELS[p.to],
      }))
    : [];

  const loadResults = useCallback(async (from: BookingCity, to: BookingCity, tripDate: string) => {
    const dir = getDirectionFromCities(from, to);
    if (!dir) return;
    setLoading(true);
    setError('');
    setAvailabilityById({});
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
    void loadResults(nextFrom, nextTo, nextDate);
  };

  useEffect(() => {
    applySearch(fromCity, toCity, date, transport);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const params: Record<string, string> = {
      from: fromCity,
      to: toCity,
      date,
    };
    if (transport !== 'all') params.type = transport;
    setSearchParams(params, { replace: true });
  }, [transport, fromCity, toCity, date, setSearchParams]);

  useEffect(() => {
    if (!schedules.length || !date) {
      setAvailabilityById({});
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        schedules.map(async (schedule) => {
          try {
            const availability = await apiClient.checkAvailability(
              schedule.route,
              schedule.departureTime,
              date
            );
            return [schedule.id, availability] as const;
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      const map: Record<number, Availability> = {};
      for (const entry of entries) {
        if (entry) map[entry[0]] = entry[1];
      }
      setAvailabilityById(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [schedules, date]);

  const anyModalOpen =
    showOfferModal ||
    !!rideshare.confirmRequestListing ||
    rideshare.showRequestStatusModal ||
    !!rideshare.alreadyRequestedListing;

  useEffect(() => {
    if (!anyModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setShowOfferModal(false);
      rideshare.setConfirmRequestListing(null);
      rideshare.setShowRequestStatusModal(false);
      rideshare.setRequestStatusData(null);
      rideshare.setAlreadyRequestedListing(null);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyModalOpen]);

  const openOfferModal = (role: 'driver' | 'passenger' = 'driver') => {
    announce.reset({
      role,
      from: fromCity,
      to: toCity,
      date: date || todayISO(),
    });
    rideshare.setRequestError('');
    setShowOfferModal(true);
  };

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
    let nextTo = toCity;
    const stillValid = BOOKING_FROM_TO.some((p) => p.from === value && p.to === toCity);
    if (!stillValid) {
      const first = BOOKING_FROM_TO.find((p) => p.from === value);
      if (first) {
        nextTo = first.to;
        setToCity(nextTo);
      }
    }
    applySearch(value, nextTo, date, transport);
  };

  const handleToChange = (value: BookingCity) => {
    setToCity(value);
    applySearch(fromCity, value, date, transport);
  };

  const handleDateChange = (value: string) => {
    setDate(value);
    applySearch(fromCity, toCity, value, transport);
  };

  const handlePublishAnnounce = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await announce.publish();
    if (ok) setShowOfferModal(false);
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
            <button type="button" className="mizh-offer-btn" onClick={() => openOfferModal('driver')}>
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

              <button type="button" className="mizh-swap-btn" onClick={handleSwap} aria-label="Поміняти місцями">
                ⇄
              </button>

              <label className="mizh-field">
                <span className="mizh-field-label">Куди</span>
                <select
                  className="mizh-field-control"
                  value={toCity}
                  onChange={(e) => handleToChange(e.target.value as BookingCity)}
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
                  onChange={(e) => handleDateChange(e.target.value)}
                />
              </label>

              <button type="submit" className="mizh-search-submit" disabled={loading}>
                {loading ? 'Шукаємо…' : 'Шукати'}
              </button>
            </div>

            <div className="mizh-date-chips" role="group" aria-label="Швидка дата">
              <button
                type="button"
                className={`mizh-date-chip ${date === todayISO() ? 'mizh-date-chip--active' : ''}`}
                onClick={() => {
                  const next = todayISO();
                  setDate(next);
                  applySearch(fromCity, toCity, next, transport);
                }}
              >
                Сьогодні
              </button>
              <button
                type="button"
                className={`mizh-date-chip ${date === tomorrowISO() ? 'mizh-date-chip--active' : ''}`}
                onClick={() => {
                  const next = tomorrowISO();
                  setDate(next);
                  applySearch(fromCity, toCity, next, transport);
                }}
              >
                Завтра
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
                { id: 'all', label: `Усі · ${carpoolCount + busCount}` },
                { id: 'carpool', label: `Попутки · ${carpoolCount}` },
                { id: 'bus', label: `Маршрутки · ${busCount}` },
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
            <strong>
              {cityLabel(fromCity)} → {cityLabel(toCity)}
            </strong>
            {' · '}
            {formatTripDate(date)}
          </div>
        </div>

        <div className="mizh-side-filters">
          {transport !== 'bus' && (
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
          )}
          <button type="button" className="mizh-filter-btn" onClick={() => applySearch()} disabled={loading}>
            Оновити
          </button>
          <button type="button" className="mizh-filter-btn" onClick={() => openOfferModal('passenger')}>
            Шукаю попутку
          </button>
          <a
            href={telegramScenarios.scenarios.view.deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mizh-filter-btn mizh-filter-btn--link"
          >
            У Telegram
          </a>
        </div>

        {error && <Alert variant="error">{error}</Alert>}
        {rideshare.requestError && !showOfferModal && <Alert variant="error">{rideshare.requestError}</Alert>}
        {!rideshare.isTelegramLoggedIn && (
          <Alert variant="info">Увійдіть через Telegram, щоб бронювати місце у водія прямо на сайті.</Alert>
        )}

        {loading ? (
          <div className="mizh-state">Завантаження поїздок…</div>
        ) : results.length === 0 ? (
          <div className="mizh-state">
            <p>
              Нічого не знайдено на цю дату.
              {transport !== 'all' ? ' Спробуйте вкладку «Усі» або іншу дату.' : ''}
            </p>
            <button type="button" className="mizh-card-cta mizh-card-cta--primary" onClick={() => openOfferModal('driver')}>
              Запропонувати поїздку
            </button>
          </div>
        ) : (
          <ul className="mizh-results" aria-label="Результати пошуку">
            {results.map((item) =>
              item.kind === 'carpool' ? (
                <li key={item.id} className="mizh-card mizh-card--carpool">
                  <div className="mizh-card-badge mizh-card-badge--carpool">Попутка</div>
                  <div className="mizh-card-body">
                    <div className="mizh-card-timeline">
                      <div className="mizh-card-time">{item.listing.departureTime || '—:—'}</div>
                      <div className="mizh-card-rail" aria-hidden>
                        <span className="mizh-card-dot" />
                        <span className="mizh-card-line" />
                        <span className="mizh-card-dot" />
                      </div>
                      <div className="mizh-card-cities">
                        <span>{routeCityLabels(item.listing.route)?.from ?? cityLabel(fromCity)}</span>
                        <span>{routeCityLabels(item.listing.route)?.to ?? cityLabel(toCity)}</span>
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
                        {item.listing.listingType === 'driver' && rideshare.isTelegramLoggedIn ? (
                          <button
                            type="button"
                            className="mizh-card-cta mizh-card-cta--primary"
                            onClick={() => rideshare.setConfirmRequestListing(item.listing)}
                            disabled={rideshare.requestingListingId === item.listing.id}
                          >
                            {rideshare.requestingListingId === item.listing.id ? 'Надсилаємо…' : 'Бронювання'}
                          </button>
                        ) : item.listing.listingType === 'driver' && !rideshare.isTelegramLoggedIn ? (
                          <>
                            <a
                              href={listingContactHref(item.listing.phone)}
                              className="mizh-card-cta mizh-card-cta--primary"
                              {...(item.listing.phone.trim().startsWith('@')
                                ? { target: '_blank', rel: 'noopener noreferrer' }
                                : {})}
                            >
                              Зателефонувати
                            </a>
                            <button
                              type="button"
                              className="mizh-card-cta mizh-card-cta--ghost"
                              onClick={() => navigate('/login')}
                            >
                              Увійти для бронювання
                            </button>
                          </>
                        ) : (
                          <a
                            href={listingContactHref(item.listing.phone)}
                            className="mizh-card-cta mizh-card-cta--primary"
                            {...(item.listing.phone.trim().startsWith('@')
                              ? { target: '_blank', rel: 'noopener noreferrer' }
                              : {})}
                          >
                            Зателефонувати
                          </a>
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
                        <span>{routeCityLabels(item.schedule.route)?.from ?? cityLabel(fromCity)}</span>
                        <span>{routeCityLabels(item.schedule.route)?.to ?? cityLabel(toCity)}</span>
                      </div>
                    </div>
                    <div className="mizh-card-meta">
                      <div className="mizh-card-bus-title">Регулярний рейс</div>
                      <div className="mizh-card-role">
                        {availabilityById[item.schedule.id] ? (
                          <>
                            Вільних: {availabilityById[item.schedule.id].availableSeats} з{' '}
                            {availabilityById[item.schedule.id].maxSeats}
                          </>
                        ) : (
                          <>До {item.schedule.maxSeats} місць</>
                        )}
                        {getRouteSuffix(item.schedule.route) ? ` · ${getRouteSuffix(item.schedule.route)}` : ''}
                      </div>
                      <div className="mizh-card-route-hint">{formatRouteLabel(item.schedule.route)}</div>
                    </div>
                    <div className="mizh-card-aside">
                      <div className="mizh-card-price mizh-card-price--soft">
                        {availabilityById[item.schedule.id] && !availabilityById[item.schedule.id].isAvailable ? (
                          <strong>немає місць</strong>
                        ) : (
                          <strong>за розкладом</strong>
                        )}
                      </div>
                      <div className="mizh-card-actions">
                        <button
                          type="button"
                          className="mizh-card-cta mizh-card-cta--bus"
                          onClick={() => setBookingSchedule(item.schedule)}
                          disabled={
                            availabilityById[item.schedule.id] != null &&
                            !availabilityById[item.schedule.id].isAvailable
                          }
                        >
                          Забронювати
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              )
            )}
          </ul>
        )}
      </div>

      {showOfferModal && (
        <div className="mizh-modal-overlay" role="presentation" onClick={() => setShowOfferModal(false)}>
          <div
            className="mizh-modal mizh-modal--offer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mizh-offer-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="mizh-modal-close" onClick={() => setShowOfferModal(false)} aria-label="Закрити">
              ×
            </button>
            <h2 id="mizh-offer-title">Запропонувати поїздку</h2>
            <p className="mizh-modal-subtitle">Опублікуйте оголошення як водій або пасажир — підтвердження в Telegram.</p>

            <div className="mizh-role-toggle">
              <button
                type="button"
                className={`mizh-role-btn ${announce.fields.role === 'driver' ? 'mizh-role-btn--active' : ''}`}
                onClick={() => announce.patch({ role: 'driver' })}
              >
                Я водій
              </button>
              <button
                type="button"
                className={`mizh-role-btn ${announce.fields.role === 'passenger' ? 'mizh-role-btn--active' : ''}`}
                onClick={() => announce.patch({ role: 'passenger' })}
              >
                Я пасажир
              </button>
            </div>

            <form className="mizh-offer-form" onSubmit={handlePublishAnnounce}>
              <div className="mizh-offer-route">
                <label className="mizh-field">
                  <span className="mizh-field-label">Звідки</span>
                  <select
                    className="mizh-field-control"
                    value={announce.fields.from}
                    onChange={(e) =>
                      announce.patch({
                        from: (e.target.value || '') as BookingCity | '',
                        to: '',
                      })
                    }
                    required
                  >
                    <option value="">Оберіть</option>
                    {fromOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mizh-field">
                  <span className="mizh-field-label">Куди</span>
                  <select
                    className="mizh-field-control"
                    value={announce.fields.to}
                    onChange={(e) => announce.patch({ to: (e.target.value || '') as BookingCity | '' })}
                    disabled={!announce.fields.from}
                    required
                  >
                    <option value="">Оберіть</option>
                    {announceToOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="mizh-field">
                <span className="mizh-field-label">Дата</span>
                <input
                  type="date"
                  className="mizh-field-control"
                  value={announce.fields.date}
                  min={todayISO()}
                  onChange={(e) => announce.patch({ date: e.target.value })}
                  required
                />
              </label>

              <div className="mizh-offer-route">
                <label className="mizh-field">
                  <span className="mizh-field-label">Час від</span>
                  <input
                    type="time"
                    className="mizh-field-control"
                    value={announce.fields.timeFrom}
                    onChange={(e) => announce.patch({ timeFrom: e.target.value })}
                  />
                </label>
                <label className="mizh-field">
                  <span className="mizh-field-label">До (опц.)</span>
                  <input
                    type="time"
                    className="mizh-field-control"
                    value={announce.fields.timeTo}
                    onChange={(e) => announce.patch({ timeTo: e.target.value })}
                  />
                </label>
              </div>

              {announce.fields.role === 'driver' && (
                <label className="mizh-field">
                  <span className="mizh-field-label">Ціна, грн (опц.)</span>
                  <input
                    type="number"
                    min={0}
                    className="mizh-field-control"
                    value={announce.fields.price}
                    onChange={(e) => announce.patch({ price: e.target.value })}
                    placeholder="наприклад 150"
                  />
                </label>
              )}

              <label className="mizh-field">
                <span className="mizh-field-label">Коментар</span>
                <textarea
                  className="mizh-field-control mizh-field-textarea"
                  rows={3}
                  value={announce.fields.comment}
                  onChange={(e) => announce.patch({ comment: e.target.value })}
                  placeholder="Додаткова інформація…"
                />
              </label>

              {announce.error && <Alert variant="error">{announce.error}</Alert>}

              <button type="submit" className="mizh-offer-submit" disabled={announce.submitting}>
                {announce.submitting ? 'Готуємо посилання…' : 'Опублікувати в Telegram'}
              </button>
              <p className="mizh-search-hint">
                Дані підуть у бота — залишиться підтвердити або вказати телефон. Посилання діє 15 хв.
              </p>
            </form>
          </div>
        </div>
      )}

      {rideshare.confirmRequestListing && (
        <div className="mizh-modal-overlay">
          <div className="mizh-modal">
            <button
              type="button"
              className="mizh-modal-close"
              onClick={() => rideshare.setConfirmRequestListing(null)}
              aria-label="Закрити"
            >
              ×
            </button>
            <h3>Створити заявку на поїздку?</h3>
            <p className="mizh-modal-subtitle">Водію буде надіслано запит від вашого імені.</p>
            <div className="mizh-modal-details">
              <div>
                <strong>Маршрут:</strong> {formatRouteLabel(rideshare.confirmRequestListing.route)}
              </div>
              <div>
                <strong>Дата:</strong> {formatTripDate(rideshare.confirmRequestListing.date)}
              </div>
              {rideshare.confirmRequestListing.departureTime && (
                <div>
                  <strong>Час:</strong> {rideshare.confirmRequestListing.departureTime}
                </div>
              )}
              {rideshare.confirmRequestListing.senderName && (
                <div>
                  <strong>Водій:</strong> {maskSenderNameForDisplay(rideshare.confirmRequestListing.senderName)}
                </div>
              )}
            </div>
            <div className="mizh-modal-actions">
              <button
                type="button"
                className="mizh-offer-submit"
                onClick={async () => {
                  const id = rideshare.confirmRequestListing!.id;
                  rideshare.setConfirmRequestListing(null);
                  await rideshare.requestRide(id);
                }}
              >
                Так, створити заявку
              </button>
              <button
                type="button"
                className="mizh-card-cta mizh-card-cta--ghost"
                onClick={() => rideshare.setConfirmRequestListing(null)}
              >
                Скасувати
              </button>
            </div>
          </div>
        </div>
      )}

      {rideshare.showRequestStatusModal && rideshare.requestStatusData && (
        <div className="mizh-modal-overlay">
          <div className="mizh-modal">
            <button type="button" className="mizh-modal-close" onClick={rideshare.closeStatusModals} aria-label="Закрити">
              ×
            </button>
            <h3>
              {rideshare.requestStatusData.driverNotified
                ? 'Запит надіслано водію'
                : 'Водій ще не підключений до Telegram'}
            </h3>
            <p className="mizh-modal-subtitle">{rideshare.requestStatusData.message}</p>
            <div className="mizh-modal-details">
              <div>
                <strong>Маршрут:</strong> {formatRouteLabel(rideshare.requestStatusData.listing.route)}
              </div>
              <div>
                <strong>Дата:</strong> {formatTripDate(rideshare.requestStatusData.listing.date)}
              </div>
            </div>
            {rideshare.requestStatusData.driverNotified ? (
              <a
                href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mizh-offer-submit mizh-offer-submit--link"
              >
                Відкрити Telegram
              </a>
            ) : (
              <a
                href={listingContactHref(rideshare.requestStatusData.listing.phone)}
                className="mizh-offer-submit mizh-offer-submit--link"
                {...(rideshare.requestStatusData.listing.phone.trim().startsWith('@')
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                Зателефонувати:{' '}
                {formatListingContactDisplay(rideshare.requestStatusData.listing.phone)}
              </a>
            )}
          </div>
        </div>
      )}

      {rideshare.alreadyRequestedListing && (
        <div className="mizh-modal-overlay">
          <div className="mizh-modal">
            <button
              type="button"
              className="mizh-modal-close"
              onClick={() => rideshare.setAlreadyRequestedListing(null)}
              aria-label="Закрити"
            >
              ×
            </button>
            <h3>Запит уже надіслано</h3>
            <p className="mizh-modal-subtitle">
              Ви вже надсилали запит цьому водію на цей маршрут і дату. Очікуйте підтвердження в Telegram.
            </p>
            <a
              href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mizh-offer-submit mizh-offer-submit--link"
            >
              Перевірити через Telegram
            </a>
            <a
              href={supportPhoneToTelLink(rideshare.alreadyRequestedListing.phone)}
              className="mizh-card-cta mizh-card-cta--ghost"
            >
              Зателефонувати
            </a>
          </div>
        </div>
      )}

      {bookingSchedule && (
        <BusBookingModal
          schedule={bookingSchedule}
          date={date}
          fromCity={fromCity}
          toCity={toCity}
          initialAvailability={availabilityById[bookingSchedule.id] ?? null}
          onClose={() => {
            setBookingSchedule(null);
            void loadResults(fromCity, toCity, date);
          }}
        />
      )}
    </div>
  );
};
