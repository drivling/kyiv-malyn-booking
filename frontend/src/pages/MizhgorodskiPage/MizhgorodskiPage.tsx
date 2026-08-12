import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import { FaqAnswerText } from '@/components/FaqAnswerText';
import {
  useAnnounceDraft,
  usePageSeo,
  useRideShareRequest,
  useTelegramScenarios,
  TELEGRAM_BOT_USERNAME,
} from '@/hooks';
import type { Availability, Schedule, TripPoint, ViberListing, ViberListingType } from '@/types';
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
import { TrainTicketModal } from './TrainTicketModal';
import { CORRIDOR_LANDINGS, corridorPath } from './corridorLandings';
import {
  CORRIDORS,
  citiesFromCorridor,
  cityLabel,
  corridorFromCity,
  formatRouteLabel,
  formatTripDate,
  getTimeMinutes,
  isElektrichka,
  isMarshrutka,
  isScheduleActiveOnDate,
  listingMatchesCities,
  routeCityLabels,
  todayISO,
  tomorrowISO,
  type CorridorId,
  type TransportFilter,
} from './mizhUtils';
import './MizhgorodskiPage.css';

const VALID_CITIES: string[] = ['Kyiv', 'Malyn', 'Zhytomyr', 'Korosten', 'Irpin', 'Bucha'];

/** Короткий FAQ для головної (AEO); детальніше — коридорні лендінги та /support/travel */
const MIZH_HOME_FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Скільки коштує маршрутка Київ — Малин?',
    a: 'Локальна маршрутка Малин ↔ Київ (Академмістечко / Святошин) у базі malin.kiev.ua — 280 грн за місце. Не плутайте з квитками 450–600₴ з агрегаторів автобусів. Попутки — ціна водія в картці (часто ~200–250₴). Детально: /support/prices.',
  },
  {
    q: 'Як доїхати до Малина з Києва, Житомира чи Коростеня?',
    a: 'Оберіть міста в пошуку на malin.kiev.ua/mizhgorodski або відкрийте сторінку напрямку (наприклад Київ — Малин). Доступні попутки від водіїв і регулярні маршрутки з бронюванням.',
  },
  {
    q: 'Чим відрізняється попутка від маршрутки?',
    a: 'Попутка — оголошення приватного водія або пасажира на конкретну дату. Маршрутка — регулярний рейс з розкладом і онлайн-бронюванням місця.',
  },
  {
    q: 'Чи потрібен Telegram?',
    a: 'Шукати поїздки можна на сайті. Підтвердження бронювання маршрутки, нагадування й оголошення зручніше вести в боті @malin_kiev_ua_bot.',
  },
  {
    q: 'Які міста підтримуються?',
    a: 'Усі міжміські маршрути проходять через Малин: Київ, Житомир і Коростень — в обидва боки.',
  },
];

type ResultItem =
  | { kind: 'carpool'; id: string; listing: ViberListing; sortMinutes: number }
  | { kind: 'bus'; id: string; schedule: Schedule; sortMinutes: number }
  | { kind: 'train'; id: string; schedule: Schedule; sortMinutes: number };

function parseCity(value: string | null): BookingCity | '' {
  if (!value) return '';
  return VALID_CITIES.includes(value) ? (value as BookingCity) : '';
}

export const MizhgorodskiPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  usePageSeo({
    title: 'Попутки та маршрутки Малин ↔ Київ, Житомир, Коростень | malin.kiev.ua',
    canonicalUrl: 'https://malin.kiev.ua/mizhgorodski',
    description:
      'Як доїхати до Малина: попутки та маршрутки Малин ↔ Київ, Житомир, Коростень. Ціни, живий пошук і онлайн бронювання.',
    jsonLdId: 'mizh-home-faq-jsonld',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: MIZH_HOME_FAQ.map((item) => ({
        '@type': 'Question',
        name: item.q,
        acceptedAnswer: { '@type': 'Answer', text: item.a },
      })),
    },
  });

  const initialFrom = parseCity(searchParams.get('from')) || 'Kyiv';
  const initialTo = parseCity(searchParams.get('to')) || 'Malyn';
  const initialDate = searchParams.get('date') || todayISO();
  const initialValid = Boolean(initialFrom && initialTo && initialFrom !== initialTo);

  const [fromCity, setFromCity] = useState<BookingCity>(initialValid ? (initialFrom as BookingCity) : 'Kyiv');
  const [toCity, setToCity] = useState<BookingCity>(initialValid ? (initialTo as BookingCity) : 'Malyn');
  const [date, setDate] = useState(initialDate);
  const [transport, setTransport] = useState<TransportFilter>(
    (['all', 'carpool', 'bus', 'train'].includes(searchParams.get('type') || '')
      ? searchParams.get('type')
      : 'all') as TransportFilter
  );
  /** Не підставляти ?from=&to=&date= на чистий /mizhgorodski — Google бачить це як редірект. */
  const [persistSearchInUrl, setPersistSearchInUrl] = useState(
    () =>
      searchParams.has('from') ||
      searchParams.has('to') ||
      searchParams.has('date') ||
      searchParams.has('type')
  );
  const [listingType, setListingType] = useState<ViberListingType | ''>('');
  const [listings, setListings] = useState<ViberListing[]>([]);
  const [poputkyPoints, setPoputkyPoints] = useState<TripPoint[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [availabilityById, setAvailabilityById] = useState<Record<number, Availability>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [bookingSchedule, setBookingSchedule] = useState<Schedule | null>(null);
  const [trainSchedule, setTrainSchedule] = useState<Schedule | null>(null);

  const telegramScenarios = useTelegramScenarios();
  const announce = useAnnounceDraft();
  const rideshare = useRideShareRequest({
    listings,
    onNeedLogin: () => navigate('/login'),
  });

  useEffect(() => {
    apiClient.getTripPoints({ appearInPoputky: true }).then(setPoputkyPoints).catch(() => setPoputkyPoints([]));
  }, []);

  const activeCorridor: CorridorId | null = useMemo(() => {
    return corridorFromCity(fromCity === 'Malyn' ? toCity : fromCity);
  }, [fromCity, toCity]);

  const fromOptions = (poputkyPoints.length
    ? poputkyPoints.map((p) => ({ value: p.code as BookingCity, label: p.nameUk }))
    : (Object.entries(BOOKING_CITY_LABELS) as [BookingCity, string][]).map(([value, label]) => ({ value, label }))
  );

  const toOptions = (poputkyPoints.length
    ? poputkyPoints.filter((p) => p.code !== fromCity).map((p) => ({ value: p.code as BookingCity, label: p.nameUk }))
    : BOOKING_FROM_TO.filter((p) => p.from === fromCity).map((p) => ({
        value: p.to,
        label: BOOKING_CITY_LABELS[p.to],
      }))
  );

  const announceToOptions = announce.fields.from
    ? (poputkyPoints.length
        ? poputkyPoints
            .filter((p) => p.code !== announce.fields.from)
            .map((p) => ({ value: p.code, label: p.nameUk }))
        : BOOKING_FROM_TO.filter((p) => p.from === announce.fields.from).map((p) => ({
            value: p.to,
            label: BOOKING_CITY_LABELS[p.to],
          })))
    : [];

  const loadResults = useCallback(async (from: BookingCity, to: BookingCity, tripDate: string) => {
    if (!from || !to || from === to) return;
    const dir = getDirectionFromCities(from, to);
    setLoading(true);
    setError('');
    setAvailabilityById({});
    try {
      const routes = dir ? DIRECTION_ROUTES[dir] || [] : [];
      const [allListings, scheduleBatches, corridors, points] = await Promise.all([
        apiClient.getViberListings(true),
        Promise.all(routes.map((route) => apiClient.getSchedulesByRoute(route).catch(() => [] as Schedule[]))),
        apiClient.getTripRoutes({ corridors: true }).catch(() => []),
        apiClient.getTripPoints({ appearInPoputky: true }).catch(() => [] as TripPoint[]),
      ]);
      if (points.length) setPoputkyPoints(points);
      const corridorById = new Map(corridors.map((c) => [c.id, c]));
      const pointIdByCode = new Map(points.map((p) => [p.code, p.id]));
      const dateKey = tripDate.slice(0, 10);
      const filteredListings = allListings.filter(
        (item) =>
          item.isActive &&
          item.date.slice(0, 10) === dateKey &&
          listingMatchesCities(item, from, to, corridorById, pointIdByCode)
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

  const writeSearchParams = (params: Record<string, string>) => {
    setPersistSearchInUrl(true);
    // Пошуковий state живе лише під /mizhgorodski — не плодимо /?from=
    if (location.pathname === '/') {
      const qs = new URLSearchParams(params).toString();
      navigate(qs ? `/mizhgorodski?${qs}` : '/mizhgorodski', { replace: true });
      return;
    }
    setSearchParams(params, { replace: true });
  };

  const applySearch = (
    nextFrom = fromCity,
    nextTo = toCity,
    nextDate = date,
    nextType = transport,
    options?: { updateUrl?: boolean }
  ) => {
    if (!nextFrom || !nextTo || nextFrom === nextTo) return;
    const updateUrl = options?.updateUrl ?? true;
    if (updateUrl) {
      const params: Record<string, string> = {
        from: nextFrom,
        to: nextTo,
        date: nextDate,
      };
      if (nextType !== 'all') params.type = nextType;
      writeSearchParams(params);
    }
    void loadResults(nextFrom, nextTo, nextDate);
  };

  useEffect(() => {
    // Перший захід на чистий /mizhgorodski — без rewrite URL (інакше GSC: «сторінка з переадресацією»).
    applySearch(fromCity, toCity, date, transport, { updateUrl: persistSearchInUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!persistSearchInUrl) return;
    const params: Record<string, string> = {
      from: fromCity,
      to: toCity,
      date,
    };
    if (transport !== 'all') params.type = transport;
    writeSearchParams(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, fromCity, toCity, date, persistSearchInUrl]);

  useEffect(() => {
    if (!schedules.length || !date) {
      setAvailabilityById({});
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        schedules
          .filter((schedule) => isMarshrutka(schedule))
          .map(async (schedule) => {
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
    !!bookingSchedule ||
    !!trainSchedule ||
    !!rideshare.confirmRequestListing ||
    rideshare.showRequestStatusModal ||
    !!rideshare.alreadyRequestedListing;

  useEffect(() => {
    if (!anyModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setShowOfferModal(false);
      setBookingSchedule(null);
      setTrainSchedule(null);
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
    if (!nextFrom || !nextTo || nextFrom === nextTo) return;
    setFromCity(nextFrom);
    setToCity(nextTo);
    applySearch(nextFrom, nextTo, date, transport);
  };

  const handleFromChange = (value: BookingCity) => {
    setFromCity(value);
    let nextTo = toCity;
    if (value === toCity) {
      const alt = (poputkyPoints.find((p) => p.code !== value)?.code ||
        BOOKING_FROM_TO.find((p) => p.from === value)?.to ||
        'Malyn') as BookingCity;
      nextTo = alt;
      setToCity(nextTo);
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
    const activeSchedules = schedules.filter((s) => isScheduleActiveOnDate(s.activeWeekdays, date));
    if (transport !== 'bus' && transport !== 'train') {
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
    if (transport === 'all' || transport === 'bus') {
      for (const schedule of activeSchedules.filter(isMarshrutka)) {
        items.push({
          kind: 'bus',
          id: `bus-${schedule.id}`,
          schedule,
          sortMinutes: getTimeMinutes(schedule.departureTime) ?? 0,
        });
      }
    }
    if (transport === 'all' || transport === 'train') {
      for (const schedule of activeSchedules.filter(isElektrichka)) {
        items.push({
          kind: 'train',
          id: `train-${schedule.id}`,
          schedule,
          sortMinutes: getTimeMinutes(schedule.departureTime) ?? 0,
        });
      }
    }
    items.sort((a, b) => a.sortMinutes - b.sortMinutes);
    return items;
  }, [listings, schedules, transport, listingType, date]);

  const carpoolCount = listings.filter((l) => !listingType || l.listingType === listingType).length;
  const activeSchedules = schedules.filter((s) => isScheduleActiveOnDate(s.activeWeekdays, date));
  const busCount = activeSchedules.filter(isMarshrutka).length;
  const trainCount = activeSchedules.filter(isElektrichka).length;

  return (
    <div className="mizh-page">
      <header className="mizh-hero">
        <div className="mizh-hero-inner">
          <div className="mizh-hero-top">
            <div>
              <h1 className="mizh-brand">Міжміські</h1>
              <p className="mizh-brand-sub">
                Як доїхати до Малина: попутки та маршрутки ↔ Київ, Житомир, Коростень — актуальний пошук
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
                { id: 'all', label: `Усі · ${carpoolCount + busCount + trainCount}` },
                { id: 'carpool', label: `Попутки · ${carpoolCount}` },
                { id: 'bus', label: `Маршрутки · ${busCount}` },
                { id: 'train', label: `Електрички · ${trainCount}` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={transport === tab.id}
                className={`mizh-transport-tab ${transport === tab.id ? 'mizh-transport-tab--active' : ''}`}
                onClick={() => {
                  setPersistSearchInUrl(true);
                  setTransport(tab.id);
                }}
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
          {transport !== 'bus' && transport !== 'train' && (
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
                  <div className="mizh-card-badge mizh-card-badge--carpool">
                    {item.listing.listingType === 'driver' ? 'Попутка' : 'Пасажир'}
                  </div>
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
              ) : item.kind === 'train' ? (
                <li key={item.id} className="mizh-card mizh-card--bus">
                  <div className="mizh-card-badge mizh-card-badge--bus">Електричка</div>
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
                      <div className="mizh-card-bus-title">
                        {item.schedule.tripNumber ? `Рейс №${item.schedule.tripNumber}` : 'Залізничний рейс'}
                      </div>
                      <div className="mizh-card-role">
                        {[item.schedule.boardingPlace, item.schedule.alightingPlace].filter(Boolean).join(' · ') ||
                          'Квиток у перевізника'}
                      </div>
                      <div className="mizh-card-route-hint">{formatRouteLabel(item.schedule.route)}</div>
                    </div>
                    <div className="mizh-card-aside">
                      <div className="mizh-card-price">
                        <strong className="mizh-card-price--soft">квиток онлайн</strong>
                      </div>
                      <div className="mizh-card-actions">
                        <button
                          type="button"
                          className="mizh-card-cta mizh-card-cta--bus"
                          onClick={() => setTrainSchedule(item.schedule)}
                        >
                          Купити квиток
                        </button>
                      </div>
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
                        {item.schedule.boardingPlace ? ` · ${item.schedule.boardingPlace}` : ''}
                      </div>
                      <div className="mizh-card-route-hint">{formatRouteLabel(item.schedule.route)}</div>
                    </div>
                    <div className="mizh-card-aside">
                      <div className="mizh-card-price">
                        {availabilityById[item.schedule.id] && !availabilityById[item.schedule.id].isAvailable ? (
                          <strong>немає місць</strong>
                        ) : item.schedule.priceUah != null ? (
                          <>
                            <strong>{item.schedule.priceUah}</strong>
                            <span> грн</span>
                          </>
                        ) : (
                          <strong className="mizh-card-price--soft">за розкладом</strong>
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

        <section className="mizh-aeo" aria-labelledby="mizh-aeo-title">
          <h2 id="mizh-aeo-title" className="mizh-aeo__title">
            Як доїхати до Малина
          </h2>
          <p className="mizh-aeo__lead">
            Три способи: попутка від водія, регулярна маршрутка з бронюванням, або Telegram-бот @
            {TELEGRAM_BOT_USERNAME}. Усі міжміські маршрути проходять через Малин.
          </p>
          <ol className="mizh-aeo__ways">
            <li>
              <strong>Попутка</strong> — оберіть оголошення водія або опублікуйте «шукаю поїздку».
            </li>
            <li>
              <strong>Маршрутка</strong> — фільтр «Маршрутки» у пошуку вище, потім «Забронювати».
            </li>
            <li>
              <strong>Бот</strong> — підтвердження й нагадування в чаті з ботом.
            </li>
          </ol>
          <p className="mizh-aeo__more">
            Детальний гід:{' '}
            <Link to="/support/travel">Як доїхати до Малина</Link>
            {' · '}
            <Link to="/support/prices">Скільки коштує</Link>
            {' · '}
            <Link to="/support">центр допомоги</Link>.
          </p>
        </section>

        <nav className="mizh-seo-dirs" aria-labelledby="mizh-seo-dirs-title">
          <h2 id="mizh-seo-dirs-title" className="mizh-seo-dirs__title">
            Напрямки
          </h2>
          <p className="mizh-seo-dirs__lead">
            Попутки й маршрутки по кожному місту — окрема сторінка з підказками, як доїхати.
          </p>
          <ul className="mizh-seo-dirs__list">
            {CORRIDOR_LANDINGS.map((c) => (
              <li key={c.slug}>
                <Link to={corridorPath(c.slug)}>
                  {c.fromLabel} → {c.toLabel}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <section className="mizh-home-faq" aria-labelledby="mizh-home-faq-title">
          <h2 id="mizh-home-faq-title" className="mizh-home-faq__title">
            Часті питання
          </h2>
          <dl className="mizh-home-faq__list">
            {MIZH_HOME_FAQ.map((item) => (
              <div key={item.q} className="mizh-home-faq__item">
                <dt>{item.q}</dt>
                <dd>
                  <FaqAnswerText text={item.a} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
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

      {trainSchedule && (
        <TrainTicketModal schedule={trainSchedule} onClose={() => setTrainSchedule(null)} />
      )}
    </div>
  );
};
