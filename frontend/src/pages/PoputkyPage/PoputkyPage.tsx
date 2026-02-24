import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import type { TelegramScenariosResponse, ViberListing, ViberListingType } from '@/types';
import { formatPhoneDisplay, supportPhoneToTelLink } from '@/utils/constants';
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
  const [telegramScenarios, setTelegramScenarios] = useState<TelegramScenariosResponse>(DEFAULT_TELEGRAM_SCENARIOS);
  const [routeTab, setRouteTab] = useState<RouteTab>('kyiv');
  const [query, setQuery] = useState('');
  const [tripDate, setTripDate] = useState('');
  const [listingType, setListingType] = useState<ViberListingType | ''>('');
  const [sortByTime, setSortByTime] = useState<'asc' | 'desc'>('asc');
  const [announceRole, setAnnounceRole] = useState<'driver' | 'passenger'>('driver');
  const [announceFrom, setAnnounceFrom] = useState('');
  const [announceTo, setAnnounceTo] = useState('');
  const [announceDate, setAnnounceDate] = useState('');
  const [announceComment, setAnnounceComment] = useState('');
  const telegramUser = userState.getTelegramUser();
  const isTelegramLoggedIn = userState.isTelegramUser() && !!telegramUser?.id;

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
      setRequestError(err instanceof Error ? err.message : 'Не вдалося створити запит на попутку');
    } finally {
      setRequestingListingId(null);
    }
  };

  const handlePublishAnnounce = (e: React.FormEvent) => {
    e.preventDefault();
    const link = announceRole === 'driver'
      ? telegramScenarios.scenarios.driver.deepLink
      : telegramScenarios.scenarios.passenger.deepLink;
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  const listRef = React.useRef<HTMLDivElement>(null);
  const scrollToAllTrips = () => listRef.current?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="poputky-page">
      {/* Hero: банер з дорогою та заголовок */}
      <header className="poputky-hero">
        <div className="poputky-hero-inner">
          <Link to="/" className="poputky-logo">
            <span className="poputky-logo-icon">🏠</span>
            <span>malin.kiev.ua</span>
          </Link>
          <h1 className="poputky-hero-title">ПОПУТНИКИ Малин - Київ - Житомир - Коростень</h1>
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
                      <div className="poputky-trip-card-top">
                        <div className="poputky-trip-avatar">
                          {listing.senderName ? listing.senderName.charAt(0).toUpperCase() : '?'}
                        </div>
                        <div className="poputky-trip-info">
                          <span className="poputky-trip-name">{listing.senderName || 'Водій'}</span>
                        </div>
                      </div>
                      <div className="poputky-trip-route" aria-label="Маршрут">
                        {formatRouteLabel(listing.route)}
                      </div>
                      <div className="poputky-trip-meta">
                        {formatTripDate(listing.date)}
                        {listing.departureTime ? `, ${listing.departureTime}` : ''}
                      </div>
                      {listing.listingType === 'driver' && (
                        <div className="poputky-trip-car">🚗 Авто</div>
                      )}
                      <div className="poputky-trip-price">Ціна: <strong>за домовленістю</strong></div>
                      {listing.listingType === 'driver' && isTelegramLoggedIn ? (
                        <button
                          type="button"
                          className="poputky-trip-detail poputky-trip-detail-btn"
                          onClick={() => handleRequestRide(listing.id)}
                          disabled={requestingListingId === listing.id}
                        >
                          {requestingListingId === listing.id ? 'Надсилаємо...' : 'Деталі >'}
                        </button>
                      ) : (
                        <a
                          href={supportPhoneToTelLink(listing.phone)}
                          className="poputky-trip-detail"
                        >
                          Деталі &gt;
                        </a>
                      )}
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
                <label className="poputky-form-label">
                  Звідки:
                  <select
                    value={announceFrom}
                    onChange={(e) => setAnnounceFrom(e.target.value)}
                    className="poputky-form-input"
                  >
                    <option value="">Оберіть</option>
                    <option value="malyn">Малин</option>
                    <option value="kyiv">Київ</option>
                    <option value="zhytomyr">Житомир</option>
                    <option value="korosten">Коростень</option>
                  </select>
                </label>
                <label className="poputky-form-label">
                  Куди:
                  <select
                    value={announceTo}
                    onChange={(e) => setAnnounceTo(e.target.value)}
                    className="poputky-form-input"
                  >
                    <option value="">Оберіть</option>
                    <option value="malyn">Малин</option>
                    <option value="kyiv">Київ</option>
                    <option value="zhytomyr">Житомир</option>
                    <option value="korosten">Коростень</option>
                  </select>
                </label>
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
                  Коментар:
                  <textarea
                    value={announceComment}
                    onChange={(e) => setAnnounceComment(e.target.value)}
                    className="poputky-form-input poputky-form-textarea"
                    rows={3}
                    placeholder="Додаткова інформація..."
                  />
                </label>
                <button type="submit" className="poputky-btn poputky-btn--green poputky-btn--block">
                  Опублікувати
                </button>
              </form>
              <p className="poputky-form-hint">
                Оголошення публікується через Telegram-бота. Натисніть «Опублікувати» — відкриється діалог з ботом.
              </p>
            </section>
          </div>
        </div>

        {/* Фільтри (компактно під колонками) */}
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
      </div>

      {/* Футер: текст + карта */}
      <footer className="poputky-footer">
        <p className="poputky-footer-text">
          Користування сервісом є повністю безкоштовним. Для початку достатньо зареєструватись, створити своє оголошення
          або вибрати серед уже опублікованих поїздок.
          </p>
          <p className="poputky-footer-text">
          Адміністратор платформи{' '}
          <a href="https://t.me/sergmeo" target="_blank" rel="noopener noreferrer" className="poputky-footer-link">
            Serg Merenkov
          </a>{' '}
          .
        </p>
        <div className="poputky-map">
          <div className="poputky-map-inner" aria-hidden>
            <span className="poputky-map-city poputky-map-city--malyn">Малин</span>
            <span className="poputky-map-city poputky-map-city--kyiv">Київ</span>
            <span className="poputky-map-city poputky-map-city--zhytomyr">Житомир</span>
            <span className="poputky-map-city poputky-map-city--korosten">Коростень</span>
            <svg className="poputky-map-routes" viewBox="0 0 200 120" preserveAspectRatio="none">
              {/* Малин (100,60) → Київ (південь правіше), Коростень (зверху правіше), Житомир (зліва) */}
              <line x1="100" y1="60" x2="155" y2="95" stroke="var(--poputky-green)" strokeWidth="2" markerEnd="url(#arrow)" />
              <line x1="100" y1="60" x2="155" y2="22" stroke="var(--poputky-green)" strokeWidth="2" markerEnd="url(#arrow)" />
              <line x1="100" y1="60" x2="35" y2="60" stroke="var(--poputky-green)" strokeWidth="2" markerEnd="url(#arrow)" />
              <defs>
                <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="var(--poputky-green)" />
                </marker>
              </defs>
            </svg>
          </div>
        </div>
      </footer>

      {showRequestStatusModal && requestStatusData && (
        <div className="poputky-modal-overlay">
          <div className="poputky-modal">
            <button
              className="poputky-modal-close"
              onClick={() => {
                setShowRequestStatusModal(false);
                setRequestStatusData(null);
              }}
            >
              ×
            </button>
            <h3>{requestStatusData.driverNotified ? '✅ Запит надіслано водію' : '📞 Водій ще не підключений до Telegram'}</h3>
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
                📱 Відкрити Telegram та очікувати підтвердження
              </a>
            ) : (
              <a
                href={supportPhoneToTelLink(requestStatusData.listing.phone)}
                className="poputky-modal-call-button"
              >
                📲 Зателефонувати: {formatPhoneDisplay(requestStatusData.listing.phone)}
              </a>
            )}
            <button
              type="button"
              className="poputky-modal-copy-button"
              onClick={() => navigator.clipboard.writeText(requestStatusData.listing.phone)}
            >
              📋 Скопіювати номер
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
