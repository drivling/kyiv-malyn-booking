import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import type { TelegramScenariosResponse, ViberListing, ViberListingType } from '@/types';
import {
  formatPhoneDisplay,
  supportPhoneToTelLink,
  BOOKING_CITY_LABELS,
  BOOKING_FROM_TO,
  getDirectionFromCities,
} from '@/utils/constants';
import type { BookingCity } from '@/utils/constants';
import { maskSenderNameForDisplay } from '@/utils/nameMask';
import { userState } from '@/utils/userState';
import './PoputkyPage.css';

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

type RouteTab = 'kyiv' | 'zhytomyr' | 'korosten';

const ROUTE_TABS: { id: RouteTab; label: string }[] = [
  { id: 'kyiv', label: 'Малин ↔ Київ' },
  { id: 'zhytomyr', label: 'Малин ↔ Житомир' },
  { id: 'korosten', label: 'Малин ↔ Коростень' },
];

const formatRouteLabel = (route: string): string =>
  route
    .replace('Kyiv-Malyn', 'Київ → Малин')
    .replace('Malyn-Kyiv', 'Малин → Київ')
    .replace('Malyn-Zhytomyr', 'Малин → Житомир')
    .replace('Zhytomyr-Malyn', 'Житомир → Малин')
    .replace('Korosten-Malyn', 'Коростень → Малин')
    .replace('Malyn-Korosten', 'Малин → Коростень')
    .replace('-Irpin', ' (через Ірпінь)')
    .replace('-Bucha', ' (через Бучу)');

const formatTripDate = (date: string): string => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
};

const getDateValue = (date: string): number | null => {
  const value = new Date(`${date.slice(0, 10)}T00:00:00`).getTime();
  return Number.isNaN(value) ? null : value;
};

const getTimeMinutes = (time: string | null): number | null => {
  if (!time) return null;
  const normalized = time.trim().split('-')[0];
  const match = normalized.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const routeMatchesTab = (route: string, tab: RouteTab): boolean => {
  const r = route.toLowerCase();
  if (tab === 'kyiv') return r.includes('kyiv') || r.includes('kiev');
  if (tab === 'zhytomyr') return r.includes('zhytomyr');
  if (tab === 'korosten') return r.includes('korosten');
  return true;
};

export const PoputkyPage: React.FC = () => {
  const navigate = useNavigate();
  const [listings, setListings] = useState<ViberListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [requestingListingId, setRequestingListingId] = useState<number | null>(null);
  const [showRequestStatusModal, setShowRequestStatusModal] = useState(false);
  const [requestStatusData, setRequestStatusData] = useState<{
    listing: ViberListing;
    driverNotified: boolean;
    message: string;
  } | null>(null);
  const [alreadyRequestedListing, setAlreadyRequestedListing] = useState<ViberListing | null>(null);
  const [confirmRequestListing, setConfirmRequestListing] = useState<ViberListing | null>(null);
  const [telegramScenarios, setTelegramScenarios] = useState<TelegramScenariosResponse>(DEFAULT_TELEGRAM_SCENARIOS);
  const [routeTab, setRouteTab] = useState<RouteTab>('kyiv');
  const [query, setQuery] = useState('');
  const [announcePrice, setAnnouncePrice] = useState('');
  const [tripDate, setTripDate] = useState('');
  const [listingType, setListingType] = useState<ViberListingType | ''>('');
  const [sortByTime, setSortByTime] = useState<'asc' | 'desc'>('asc');
  const [announceRole, setAnnounceRole] = useState<'driver' | 'passenger'>('driver');
  const [announceFrom, setAnnounceFrom] = useState<BookingCity | ''>('');
  const [announceTo, setAnnounceTo] = useState<BookingCity | ''>('');
  const [announceDate, setAnnounceDate] = useState('');
  const [announceTimeFrom, setAnnounceTimeFrom] = useState('');
  const [announceTimeTo, setAnnounceTimeTo] = useState('');
  const [announceComment, setAnnounceComment] = useState('');
  const [announceSubmitting, setAnnounceSubmitting] = useState(false);
  const telegramUser = userState.getTelegramUser();
  const isTelegramLoggedIn = userState.isTelegramUser() && !!telegramUser?.id;

  const fromCityOptions = (Object.entries(BOOKING_CITY_LABELS) as [BookingCity, string][]).map(([value, label]) => ({
    value,
    label,
  }));

  const toCityOptions = announceFrom
    ? BOOKING_FROM_TO.filter((p) => p.from === announceFrom).map((p) => ({
        value: p.to,
        label: BOOKING_CITY_LABELS[p.to],
      }))
    : [];

  useEffect(() => {
    if (announceFrom && announceTo && !getDirectionFromCities(announceFrom, announceTo)) {
      setAnnounceTo('');
    }
  }, [announceFrom, announceTo]);

  const loadPoputky = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.getViberListings(true);
      setListings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося завантажити попутки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPoputky();
  }, []);

  useEffect(() => {
    const loadTelegramScenarios = async () => {
      try {
        const data = await apiClient.getTelegramScenarios();
        if (data?.scenarios?.driver?.deepLink && data?.scenarios?.passenger?.deepLink && data?.scenarios?.view?.deepLink) {
          setTelegramScenarios(data);
        }
      } catch {
        // Non-blocking
      }
    };
    loadTelegramScenarios();
  }, []);

  const filteredListings = useMemo(() => {
    return [...listings]
      .filter((listing) => {
        if (!listing.isActive) return false;
        if (!routeMatchesTab(listing.route, routeTab)) return false;
        if (listingType && listing.listingType !== listingType) return false;
        if (tripDate && listing.date.slice(0, 10) !== tripDate) return false;
        if (query) {
          const normalizedQuery = query.toLowerCase();
          const searchTarget = `${listing.route} ${listing.senderName ?? ''} ${listing.notes ?? ''} ${listing.phone}`.toLowerCase();
          if (!searchTarget.includes(normalizedQuery)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const dateA = getDateValue(a.date);
        const dateB = getDateValue(b.date);
        if (dateA !== null && dateB !== null && dateA !== dateB) {
          return sortByTime === 'asc' ? dateA - dateB : dateB - dateA;
        }
        const timeA = getTimeMinutes(a.departureTime);
        const timeB = getTimeMinutes(b.departureTime);
        if (timeA === null && timeB !== null) return 1;
        if (timeA !== null && timeB === null) return -1;
        if (timeA !== null && timeB !== null && timeA !== timeB) {
          return sortByTime === 'asc' ? timeA - timeB : timeB - timeA;
        }
        return 0;
      });
  }, [listings, routeTab, listingType, tripDate, query, sortByTime]);

  const driverCount = filteredListings.filter((item) => item.listingType === 'driver').length;
  const passengerCount = filteredListings.filter((item) => item.listingType === 'passenger').length;

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
    const timeValue = timeFrom && timeTo
      ? `${timeFrom}-${timeTo}`
      : timeFrom || timeTo || undefined;
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
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : 'Не вдалося створити оголошення. Спробуйте пізніше.');
    } finally {
      setAnnounceSubmitting(false);
    }
  };

  const listRef = React.useRef<HTMLDivElement>(null);
  const scrollToAllTrips = () => listRef.current?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="poputky-page">
      <header className="poputky-hero">
        <div className="poputky-hero-inner">
          <h1 className="poputky-hero-title">Попутки</h1>
          <p className="poputky-hero-subtitle">Малин · Київ · Житомир · Коростень</p>
        </div>
      </header>

      {/* Вкладки маршрутів */}
      <nav className="poputky-tabs" aria-label="Маршрути">
        {ROUTE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`poputky-tab ${routeTab === tab.id ? 'poputky-tab--active' : ''}`}
            onClick={() => setRouteTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="poputky-container">
        {/* Дві колонки: ліва — поїздки, права — форма оголошення */}
        <div className="poputky-main">
          <aside className="poputky-sidebar">
            <div className="poputky-hero-actions">
              <a
                href={telegramScenarios.scenarios.view.deepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="poputky-btn poputky-btn--green"
              >
                Знайти поїздку
              </a>
              <a
                href={telegramScenarios.scenarios.driver.deepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="poputky-btn poputky-btn--green"
              >
                Додати оголошення
              </a>
            </div>

            <section className="poputky-filters-card">
              <div className="poputky-filters-row">
                <select
                  value={listingType}
                  onChange={(e) => setListingType(e.target.value as ViberListingType | '')}
                  className="poputky-filter"
                  aria-label="Тип оголошення"
                >
                  <option value="">Всі</option>
                  <option value="driver">Водії</option>
                  <option value="passenger">Пасажири</option>
                </select>
                <input
                  type="date"
                  value={tripDate}
                  onChange={(e) => setTripDate(e.target.value)}
                  className="poputky-filter"
                  aria-label="Дата поїздки"
                />
                <input
                  type="text"
                  placeholder="Маршрут, ім'я, телефон..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="poputky-filter poputky-filter--search"
                />
                <select
                  value={sortByTime}
                  onChange={(e) => setSortByTime(e.target.value as 'asc' | 'desc')}
                  className="poputky-filter"
                  aria-label="Сортування"
                >
                  <option value="asc">Спочатку раніші</option>
                  <option value="desc">Спочатку пізніші</option>
                </select>
                <button type="button" onClick={loadPoputky} disabled={loading} className="poputky-filter-btn">
                  {loading ? 'Оновлення...' : 'Оновити'}
                </button>
              </div>
              <div className="poputky-stats-row">
                <span className="poputky-stat">Всього: <strong>{filteredListings.length}</strong></span>
                <span className="poputky-stat">Водії: <strong>{driverCount}</strong></span>
                <span className="poputky-stat">Пасажири: <strong>{passengerCount}</strong></span>
              </div>
            </section>

            <section className="poputky-last-trips" ref={listRef}>
              <h2 className="poputky-section-title">Останні поїздки</h2>

              {error && <Alert variant="error">{error}</Alert>}
              {requestError && <Alert variant="error">{requestError}</Alert>}
              {!isTelegramLoggedIn && (
                <Alert variant="info">
                  Увійдіть через Telegram, щоб бронювати місце у водія прямо на сайті.
                </Alert>
              )}

              {loading ? (
                <div className="poputky-state poputky-loading">Завантаження попуток...</div>
              ) : filteredListings.length === 0 ? (
                <div className="poputky-state poputky-empty">
                  Немає оголошень за вибраним маршрутом. Додайте поїздку в Telegram або змініть вкладку.
                </div>
              ) : (
                <ul className="poputky-trip-list" aria-label="Список попуток">
                  {filteredListings.map((listing) => (
                    <li key={listing.id} className="poputky-trip-card">
                      <div className="poputky-trip-card-main">
                        <div className="poputky-trip-card-top">
                          <div className="poputky-trip-avatar">
                            {listing.senderName ? listing.senderName.charAt(0).toUpperCase() : '?'}
                          </div>
                          <div className="poputky-trip-info">
                            <span className="poputky-trip-name">{maskSenderNameForDisplay(listing.senderName) || (listing.listingType === 'driver' ? 'Водій' : 'Пасажир')}</span>
                          </div>
                        </div>
                        <div className="poputky-trip-route" aria-label="Маршрут">
                          {listing.listingType === 'driver' ? 'Водій · ' : 'Пасажир · '}
                          {formatRouteLabel(listing.route)}
                        </div>
                        <div className="poputky-trip-meta">
                          {formatTripDate(listing.date)}
                          {listing.departureTime ? `, ${listing.departureTime}` : ''}
                        </div>
                        {listing.seats != null && (
                          <div className="poputky-trip-meta poputky-trip-seats">Місць: {listing.seats}</div>
                        )}
                      </div>
                      <div className="poputky-trip-card-aside">
                        <div className="poputky-trip-price">
                          Ціна: <strong>{listing.priceUah != null ? `${listing.priceUah} грн` : 'за домовленістю'}</strong>
                        </div>
                        {listing.notes && (
                          <div className="poputky-trip-notes">
                            {listing.notes}
                          </div>
                        )}
                        <div className="poputky-trip-card-actions">
                          {listing.listingType === 'driver' && isTelegramLoggedIn ? (
                            <button
                              type="button"
                              className="poputky-trip-detail poputky-trip-detail-btn"
                              onClick={() => setConfirmRequestListing(listing)}
                              disabled={requestingListingId === listing.id}
                            >
                              {requestingListingId === listing.id ? 'Надсилаємо...' : 'Бронювання'}
                            </button>
                          ) : listing.listingType === 'driver' && !isTelegramLoggedIn ? (
                            <>
                              <a
                                href={supportPhoneToTelLink(listing.phone)}
                                className="poputky-trip-detail"
                              >
                                Зателефонувати
                              </a>
                              <button
                                type="button"
                                className="poputky-trip-detail poputky-trip-detail-btn poputky-trip-login-btn"
                                onClick={() => navigate('/login')}
                              >
                                Залогінитись для бронювання
                              </button>
                            </>
                          ) : (
                            <a
                              href={supportPhoneToTelLink(listing.phone)}
                              className="poputky-trip-detail"
                            >
                              Зателефонувати
                            </a>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {filteredListings.length > 0 && (
                <button type="button" className="poputky-all-link" onClick={scrollToAllTrips}>
                  Всі поїздки &gt;
                </button>
              )}
            </section>
          </aside>

          <div className="poputky-form-column">
            <section className="poputky-announce-card">
              <h2 className="poputky-section-title">Ваше оголошення</h2>
              <div className="poputky-role-toggle">
                <button
                  type="button"
                  className={`poputky-role-btn ${announceRole === 'driver' ? 'poputky-role-btn--active' : ''}`}
                  onClick={() => setAnnounceRole('driver')}
                >
                  Я Водій
                </button>
                <button
                  type="button"
                  className={`poputky-role-btn ${announceRole === 'passenger' ? 'poputky-role-btn--active' : ''}`}
                  onClick={() => setAnnounceRole('passenger')}
                >
                  Я Пасажир
                </button>
              </div>
              <form className="poputky-announce-form" onSubmit={handlePublishAnnounce}>
                <div className="poputky-route-section">
                  <div className="poputky-route-row">
                    <label className="poputky-form-label">
                      Звідки:
                      <select
                        value={announceFrom}
                        onChange={(e) => {
                          const next = (e.target.value || '') as BookingCity | '';
                          setAnnounceFrom(next);
                          setAnnounceTo('');
                        }}
                        className="poputky-form-input"
                      >
                        <option value="">Оберіть</option>
                        {fromCityOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="poputky-route-arrow" aria-hidden>→</span>
                    <label className="poputky-form-label">
                      Куди:
                      <select
                        value={announceTo}
                        onChange={(e) => setAnnounceTo((e.target.value || '') as BookingCity | '')}
                        className="poputky-form-input"
                        disabled={!announceFrom}
                      >
                        <option value="">Оберіть</option>
                        {toCityOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p className="poputky-form-hint poputky-form-hint--inline">Усі маршрути проходять через Малин</p>
                </div>
                <label className="poputky-form-label">
                  Дата поїздки:
                  <input
                    type="date"
                    value={announceDate}
                    onChange={(e) => setAnnounceDate(e.target.value)}
                    className="poputky-form-input"
                  />
                </label>
                <label className="poputky-form-label">
                  Час відправлення:
                  <input
                    type="time"
                    value={announceTimeFrom}
                    onChange={(e) => setAnnounceTimeFrom(e.target.value)}
                    className="poputky-form-input"
                  />
                </label>
                <label className="poputky-form-label">
                  До (крайній час, опціонально):
                  <input
                    type="time"
                    value={announceTimeTo}
                    onChange={(e) => setAnnounceTimeTo(e.target.value)}
                    className="poputky-form-input"
                  />
                </label>
                {((announceTimeFrom && !announceTimeTo) || (!announceTimeFrom && announceTimeTo)) && (
                  <p className="poputky-form-hint poputky-form-hint--inline">Одне поле — точний час відправки</p>
                )}
                {announceTimeFrom && announceTimeTo && (
                  <p className="poputky-form-hint poputky-form-hint--inline">Обидва — проміжок {announceTimeFrom}–{announceTimeTo}</p>
                )}
                {announceRole === 'driver' && (
                  <label className="poputky-form-label">
                    Ціна (грн, опціонально):
                    <input
                      type="number"
                      min={0}
                      value={announcePrice}
                      onChange={(e) => setAnnouncePrice(e.target.value)}
                      className="poputky-form-input"
                      placeholder="наприклад 150"
                    />
                  </label>
                )}
                <label className="poputky-form-label">
                  Коментар:
                  <textarea
                    value={announceComment}
                    onChange={(e) => setAnnounceComment(e.target.value)}
                    className="poputky-form-input poputky-form-textarea"
                    rows={3}
                    placeholder="Додаткова інформація..."
                  />
                </label>
                <button type="submit" className="poputky-btn poputky-btn--green poputky-btn--block" disabled={announceSubmitting}>
                  {announceSubmitting ? 'Готуємо посилання...' : 'Опублікувати'}
                </button>
              </form>
              <p className="poputky-form-hint">
                Дані з форми передаються в Telegram — у боті залишиться лише підтвердити або вказати номер телефону. Посилання діє 15 хв.
              </p>
            </section>
          </div>
        </div>
      </div>

      <footer className="poputky-footer">
        <p className="poputky-footer-text">
          Користування безкоштовне. Створіть оголошення або оберіть поїздку серед опублікованих.
        </p>
        <p className="poputky-footer-text">
          Адміністратор{' '}
          <a href="https://t.me/sergmeo" target="_blank" rel="noopener noreferrer" className="poputky-footer-link">
            Serg Merenkov
          </a>
        </p>
      </footer>

      {confirmRequestListing && (
        <div className="poputky-modal-overlay">
          <div className="poputky-modal">
            <button
              type="button"
              className="poputky-modal-close"
              onClick={() => {
                setConfirmRequestListing(null);
                loadPoputky();
              }}
              aria-label="Закрити"
            >
              ×
            </button>
            <h3>Створити заявку на поїздку?</h3>
            <p className="poputky-modal-subtitle">
              Водію буде надіслано запит від вашого імені. Переконайтесь, що обрали потрібну поїздку.
            </p>
            <div className="poputky-modal-details">
              <div><strong>Маршрут:</strong> {formatRouteLabel(confirmRequestListing.route)}</div>
              <div><strong>Дата:</strong> {formatTripDate(confirmRequestListing.date)}</div>
              {confirmRequestListing.departureTime && (
                <div><strong>Час:</strong> {confirmRequestListing.departureTime}</div>
              )}
              {confirmRequestListing.senderName && (
                <div><strong>Водій:</strong> {maskSenderNameForDisplay(confirmRequestListing.senderName)}</div>
              )}
            </div>
            <div className="poputky-modal-actions">
              <button
                type="button"
                className="poputky-btn poputky-btn--green"
                onClick={async () => {
                  const id = confirmRequestListing.id;
                  setConfirmRequestListing(null);
                  await handleRequestRide(id);
                }}
              >
                Так, створити заявку
              </button>
              <button
                type="button"
                className="poputky-modal-cancel-btn"
                onClick={() => {
                  setConfirmRequestListing(null);
                  loadPoputky();
                }}
              >
                Скасувати
              </button>
            </div>
          </div>
        </div>
      )}

      {showRequestStatusModal && requestStatusData && (
        <div className="poputky-modal-overlay">
          <div className="poputky-modal">
            <button
              className="poputky-modal-close"
              onClick={() => {
                setShowRequestStatusModal(false);
                setRequestStatusData(null);
                loadPoputky();
              }}
            >
              ×
            </button>
            <h3>{requestStatusData.driverNotified ? 'Запит надіслано водію' : 'Водій ще не підключений до Telegram'}</h3>
            <p className="poputky-modal-subtitle">{requestStatusData.message}</p>
            <div className="poputky-modal-details">
              <div><strong>Маршрут:</strong> {formatRouteLabel(requestStatusData.listing.route)}</div>
              <div><strong>Дата:</strong> {formatTripDate(requestStatusData.listing.date)}</div>
              {requestStatusData.listing.departureTime && (
                <div><strong>Час:</strong> {requestStatusData.listing.departureTime}</div>
              )}
              {requestStatusData.listing.senderName && (
                <div><strong>Водій:</strong> {requestStatusData.listing.senderName}</div>
              )}
            </div>
            {requestStatusData.driverNotified ? (
              <a
                href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
                target="_blank"
                rel="noopener noreferrer"
                className="poputky-modal-call-button"
              >
                Відкрити Telegram та очікувати підтвердження
              </a>
            ) : (
              <a
                href={supportPhoneToTelLink(requestStatusData.listing.phone)}
                className="poputky-modal-call-button"
              >
                Зателефонувати: {formatPhoneDisplay(requestStatusData.listing.phone)}
              </a>
            )}
            <a
              href={supportPhoneToTelLink(requestStatusData.listing.phone)}
              className="poputky-modal-copy-button"
            >
              Подзвонити
            </a>
          </div>
        </div>
      )}

      {alreadyRequestedListing && (
        <div className="poputky-modal-overlay">
          <div className="poputky-modal">
            <button
              className="poputky-modal-close"
              onClick={() => {
                setAlreadyRequestedListing(null);
                loadPoputky();
              }}
              aria-label="Закрити"
            >
              ×
            </button>
            <h3>Запит уже надіслано</h3>
            <p className="poputky-modal-subtitle">
              Ви вже надсилали запит цьому водію на цей маршрут і дату. Очікуйте підтвердження або перегляньте /mybookings у Telegram.
            </p>
            <div className="poputky-modal-details">
              <div><strong>Маршрут:</strong> {formatRouteLabel(alreadyRequestedListing.route)}</div>
              <div><strong>Дата:</strong> {formatTripDate(alreadyRequestedListing.date)}</div>
              {alreadyRequestedListing.departureTime && (
                <div><strong>Час:</strong> {alreadyRequestedListing.departureTime}</div>
              )}
              {alreadyRequestedListing.senderName && (
                <div><strong>Водій:</strong> {maskSenderNameForDisplay(alreadyRequestedListing.senderName)}</div>
              )}
            </div>
            <a
              href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
              target="_blank"
              rel="noopener noreferrer"
              className="poputky-modal-call-button"
            >
              Перевірити через Telegram
            </a>
            <a
              href={supportPhoneToTelLink(alreadyRequestedListing.phone)}
              className="poputky-modal-copy-button"
            >
              Зателефонувати
            </a>
          </div>
        </div>
      )}
    </div>
  );
};
