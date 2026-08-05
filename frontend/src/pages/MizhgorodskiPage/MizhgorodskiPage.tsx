import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import type { Schedule, TelegramScenariosResponse, ViberListing, ViberListingType } from '@/types';
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

const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'malin_kiev_ua_bot';
const DEFAULT_TELEGRAM_SCENARIOS: TelegramScenariosResponse = {
  enabled: true,
  scenarios: {
    driver: {
      title: 'Запит на поїздку як водій',
      command: '/adddriverride',
      deepLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=driver`,
    },
    passenger: {
      title: 'Запит на поїздку як пасажир',
      command: '/addpassengerride',
      deepLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=passenger`,
    },
    view: {
      title: 'Вільний перегляд поїздок',
      command: '/poputky',
      deepLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=view`,
      webLink: 'https://malin.kiev.ua/poputky',
    },
  },
};

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
    (['all', 'carpool', 'bus'].includes(searchParams.get('type') || '')
      ? searchParams.get('type')
      : 'all') as TransportFilter
  );
  const [listingType, setListingType] = useState<ViberListingType | ''>('');
  const [hasSearched, setHasSearched] = useState(Boolean(searchParams.get('from') && searchParams.get('to')));

  const [listings, setListings] = useState<ViberListing[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requestError, setRequestError] = useState('');

  const [showOfferModal, setShowOfferModal] = useState(false);
  const [announceRole, setAnnounceRole] = useState<'driver' | 'passenger'>('driver');
  const [announceFrom, setAnnounceFrom] = useState<BookingCity | ''>('');
  const [announceTo, setAnnounceTo] = useState<BookingCity | ''>('');
  const [announceDate, setAnnounceDate] = useState('');
  const [announceTimeFrom, setAnnounceTimeFrom] = useState('');
  const [announceTimeTo, setAnnounceTimeTo] = useState('');
  const [announcePrice, setAnnouncePrice] = useState('');
  const [announceComment, setAnnounceComment] = useState('');
  const [announceSubmitting, setAnnounceSubmitting] = useState(false);

  const [requestingListingId, setRequestingListingId] = useState<number | null>(null);
  const [confirmRequestListing, setConfirmRequestListing] = useState<ViberListing | null>(null);
  const [showRequestStatusModal, setShowRequestStatusModal] = useState(false);
  const [requestStatusData, setRequestStatusData] = useState<{
    listing: ViberListing;
    driverNotified: boolean;
    message: string;
  } | null>(null);
  const [alreadyRequestedListing, setAlreadyRequestedListing] = useState<ViberListing | null>(null);
  const [telegramScenarios, setTelegramScenarios] = useState<TelegramScenariosResponse>(DEFAULT_TELEGRAM_SCENARIOS);

  const direction = getDirectionFromCities(fromCity, toCity);
  const telegramUser = userState.getTelegramUser();
  const isTelegramLoggedIn = userState.isTelegramUser() && !!telegramUser?.id;

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

  const announceToOptions = announceFrom
    ? BOOKING_FROM_TO.filter((p) => p.from === announceFrom).map((p) => ({
        value: p.to,
        label: BOOKING_CITY_LABELS[p.to],
      }))
    : [];

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    apiClient
      .getTelegramScenarios()
      .then((data) => {
        if (data?.scenarios?.driver?.deepLink && data?.scenarios?.passenger?.deepLink) {
          setTelegramScenarios(data);
        }
      })
      .catch(() => {});
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

  useEffect(() => {
    if (announceFrom && announceTo && !getDirectionFromCities(announceFrom, announceTo)) {
      setAnnounceTo('');
    }
  }, [announceFrom, announceTo]);

  const openOfferModal = (role: 'driver' | 'passenger' = 'driver') => {
    setAnnounceRole(role);
    setAnnounceFrom(fromCity);
    setAnnounceTo(toCity);
    setAnnounceDate(date || todayISO());
    setAnnounceTimeFrom('');
    setAnnounceTimeTo('');
    setAnnouncePrice('');
    setAnnounceComment('');
    setRequestError('');
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
    const stillValid = BOOKING_FROM_TO.some((p) => p.from === value && p.to === toCity);
    if (!stillValid) {
      const first = BOOKING_FROM_TO.find((p) => p.from === value);
      if (first) setToCity(first.to);
    }
  };

  const handlePublishAnnounce = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!announceFrom || !announceTo) {
      setRequestError('Оберіть звідки та куди. Маршрути лише з/до Малина.');
      return;
    }
    if (!announceDate) {
      setRequestError('Вкажіть дату поїздки');
      return;
    }
    const priceValue = announcePrice.trim();
    const priceUah = priceValue ? Number.parseInt(priceValue, 10) : undefined;
    setRequestError('');
    setAnnounceSubmitting(true);
    const timeFrom = announceTimeFrom.trim();
    const timeTo = announceTimeTo.trim();
    const timeValue = timeFrom && timeTo ? `${timeFrom}-${timeTo}` : timeFrom || timeTo || undefined;
    try {
      const { deepLink } = await apiClient.createAnnounceDraft({
        role: announceRole,
        from: announceFrom,
        to: announceTo,
        date: announceDate,
        time: timeValue,
        priceUah,
        notes: announceComment.trim() || undefined,
      });
      window.open(deepLink, '_blank', 'noopener,noreferrer');
      setShowOfferModal(false);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Не вдалося створити оголошення. Спробуйте пізніше.');
    } finally {
      setAnnounceSubmitting(false);
    }
  };

  const handleRequestRide = async (driverListingId: number) => {
    if (!telegramUser?.id) {
      navigate('/login');
      return;
    }
    setRequestError('');
    setRequestingListingId(driverListingId);
    try {
      const result = await apiClient.createRideShareRequestFromSite(driverListingId, telegramUser.id.toString());
      const selectedListing = listings.find((item) => item.id === driverListingId) || null;
      if (selectedListing) {
        setRequestStatusData({
          listing: selectedListing,
          driverNotified: result.driverNotified,
          message: result.message,
        });
        setShowRequestStatusModal(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не вдалося створити запит на попутку';
      if (message.includes('Ви вже надсилали запит')) {
        const listing = listings.find((item) => item.id === driverListingId) || null;
        if (listing) setAlreadyRequestedListing(listing);
      } else {
        setRequestError(message);
      }
    } finally {
      setRequestingListingId(null);
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

        {hasSearched && (
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
        )}

        {error && <Alert variant="error">{error}</Alert>}
        {requestError && !showOfferModal && <Alert variant="error">{requestError}</Alert>}
        {hasSearched && !isTelegramLoggedIn && (
          <Alert variant="info">Увійдіть через Telegram, щоб бронювати місце у водія прямо на сайті.</Alert>
        )}

        {!hasSearched ? (
          <section className="mizh-placeholder">
            <h2>Куди їдете?</h2>
            <p>Оберіть коридор згори або міста «звідки / куди», дату — і натисніть «Шукати».</p>
            <div className="mizh-placeholder-actions">
              <button type="button" className="mizh-card-cta mizh-card-cta--primary" onClick={() => openOfferModal('driver')}>
                Я їду як водій
              </button>
              <button type="button" className="mizh-card-cta mizh-card-cta--ghost" onClick={() => openOfferModal('passenger')}>
                Шукаю попутку
              </button>
            </div>
          </section>
        ) : loading ? (
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
                          <button
                            type="button"
                            className="mizh-card-cta mizh-card-cta--primary"
                            onClick={() => setConfirmRequestListing(item.listing)}
                            disabled={requestingListingId === item.listing.id}
                          >
                            {requestingListingId === item.listing.id ? 'Надсилаємо…' : 'Бронювання'}
                          </button>
                        ) : item.listing.listingType === 'driver' && !isTelegramLoggedIn ? (
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
                className={`mizh-role-btn ${announceRole === 'driver' ? 'mizh-role-btn--active' : ''}`}
                onClick={() => setAnnounceRole('driver')}
              >
                Я водій
              </button>
              <button
                type="button"
                className={`mizh-role-btn ${announceRole === 'passenger' ? 'mizh-role-btn--active' : ''}`}
                onClick={() => setAnnounceRole('passenger')}
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
                    value={announceFrom}
                    onChange={(e) => {
                      setAnnounceFrom((e.target.value || '') as BookingCity | '');
                      setAnnounceTo('');
                    }}
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
                    value={announceTo}
                    onChange={(e) => setAnnounceTo((e.target.value || '') as BookingCity | '')}
                    disabled={!announceFrom}
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
                  value={announceDate}
                  min={todayISO()}
                  onChange={(e) => setAnnounceDate(e.target.value)}
                  required
                />
              </label>

              <div className="mizh-offer-route">
                <label className="mizh-field">
                  <span className="mizh-field-label">Час від</span>
                  <input
                    type="time"
                    className="mizh-field-control"
                    value={announceTimeFrom}
                    onChange={(e) => setAnnounceTimeFrom(e.target.value)}
                  />
                </label>
                <label className="mizh-field">
                  <span className="mizh-field-label">До (опц.)</span>
                  <input
                    type="time"
                    className="mizh-field-control"
                    value={announceTimeTo}
                    onChange={(e) => setAnnounceTimeTo(e.target.value)}
                  />
                </label>
              </div>

              {announceRole === 'driver' && (
                <label className="mizh-field">
                  <span className="mizh-field-label">Ціна, грн (опц.)</span>
                  <input
                    type="number"
                    min={0}
                    className="mizh-field-control"
                    value={announcePrice}
                    onChange={(e) => setAnnouncePrice(e.target.value)}
                    placeholder="наприклад 150"
                  />
                </label>
              )}

              <label className="mizh-field">
                <span className="mizh-field-label">Коментар</span>
                <textarea
                  className="mizh-field-control mizh-field-textarea"
                  rows={3}
                  value={announceComment}
                  onChange={(e) => setAnnounceComment(e.target.value)}
                  placeholder="Додаткова інформація…"
                />
              </label>

              {requestError && <Alert variant="error">{requestError}</Alert>}

              <button type="submit" className="mizh-offer-submit" disabled={announceSubmitting}>
                {announceSubmitting ? 'Готуємо посилання…' : 'Опублікувати в Telegram'}
              </button>
              <p className="mizh-search-hint">
                Дані підуть у бота — залишиться підтвердити або вказати телефон. Посилання діє 15 хв.
              </p>
            </form>
          </div>
        </div>
      )}

      {confirmRequestListing && (
        <div className="mizh-modal-overlay">
          <div className="mizh-modal">
            <button type="button" className="mizh-modal-close" onClick={() => setConfirmRequestListing(null)} aria-label="Закрити">
              ×
            </button>
            <h3>Створити заявку на поїздку?</h3>
            <p className="mizh-modal-subtitle">Водію буде надіслано запит від вашого імені.</p>
            <div className="mizh-modal-details">
              <div>
                <strong>Маршрут:</strong> {formatRouteLabel(confirmRequestListing.route)}
              </div>
              <div>
                <strong>Дата:</strong> {formatTripDate(confirmRequestListing.date)}
              </div>
              {confirmRequestListing.departureTime && (
                <div>
                  <strong>Час:</strong> {confirmRequestListing.departureTime}
                </div>
              )}
              {confirmRequestListing.senderName && (
                <div>
                  <strong>Водій:</strong> {maskSenderNameForDisplay(confirmRequestListing.senderName)}
                </div>
              )}
            </div>
            <div className="mizh-modal-actions">
              <button
                type="button"
                className="mizh-offer-submit"
                onClick={async () => {
                  const id = confirmRequestListing.id;
                  setConfirmRequestListing(null);
                  await handleRequestRide(id);
                }}
              >
                Так, створити заявку
              </button>
              <button type="button" className="mizh-card-cta mizh-card-cta--ghost" onClick={() => setConfirmRequestListing(null)}>
                Скасувати
              </button>
            </div>
          </div>
        </div>
      )}

      {showRequestStatusModal && requestStatusData && (
        <div className="mizh-modal-overlay">
          <div className="mizh-modal">
            <button
              type="button"
              className="mizh-modal-close"
              onClick={() => {
                setShowRequestStatusModal(false);
                setRequestStatusData(null);
              }}
              aria-label="Закрити"
            >
              ×
            </button>
            <h3>{requestStatusData.driverNotified ? 'Запит надіслано водію' : 'Водій ще не підключений до Telegram'}</h3>
            <p className="mizh-modal-subtitle">{requestStatusData.message}</p>
            <div className="mizh-modal-details">
              <div>
                <strong>Маршрут:</strong> {formatRouteLabel(requestStatusData.listing.route)}
              </div>
              <div>
                <strong>Дата:</strong> {formatTripDate(requestStatusData.listing.date)}
              </div>
              {requestStatusData.listing.departureTime && (
                <div>
                  <strong>Час:</strong> {requestStatusData.listing.departureTime}
                </div>
              )}
            </div>
            {requestStatusData.driverNotified ? (
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
                href={listingContactHref(requestStatusData.listing.phone)}
                className="mizh-offer-submit mizh-offer-submit--link"
                {...(requestStatusData.listing.phone.trim().startsWith('@')
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                Зателефонувати: {formatListingContactDisplay(requestStatusData.listing.phone)}
              </a>
            )}
          </div>
        </div>
      )}

      {alreadyRequestedListing && (
        <div className="mizh-modal-overlay">
          <div className="mizh-modal">
            <button
              type="button"
              className="mizh-modal-close"
              onClick={() => setAlreadyRequestedListing(null)}
              aria-label="Закрити"
            >
              ×
            </button>
            <h3>Запит уже надіслано</h3>
            <p className="mizh-modal-subtitle">
              Ви вже надсилали запит цьому водію на цей маршрут і дату. Очікуйте підтвердження в Telegram.
            </p>
            <div className="mizh-modal-details">
              <div>
                <strong>Маршрут:</strong> {formatRouteLabel(alreadyRequestedListing.route)}
              </div>
              <div>
                <strong>Дата:</strong> {formatTripDate(alreadyRequestedListing.date)}
              </div>
            </div>
            <a
              href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mizh-offer-submit mizh-offer-submit--link"
            >
              Перевірити через Telegram
            </a>
            <a href={supportPhoneToTelLink(alreadyRequestedListing.phone)} className="mizh-card-cta mizh-card-cta--ghost">
              Зателефонувати
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
