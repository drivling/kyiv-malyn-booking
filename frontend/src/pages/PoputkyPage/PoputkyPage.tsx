import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import type { TelegramScenariosResponse, ViberListing, ViberListingType } from '@/types';
import { formatPhoneDisplay, supportPhoneToTelLink } from '@/utils/constants';
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
  return parsed.toLocaleDateString('uk-UA');
};

export const PoputkyPage: React.FC = () => {
  const [listings, setListings] = useState<ViberListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [telegramScenarios, setTelegramScenarios] = useState<TelegramScenariosResponse>(DEFAULT_TELEGRAM_SCENARIOS);
  const [query, setQuery] = useState('');
  const [tripDate, setTripDate] = useState('');
  const [listingType, setListingType] = useState<ViberListingType | ''>('');

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
        // Non-blocking: залишаємо fallback сценарії
      }
    };

    loadTelegramScenarios();
  }, []);

  const filteredListings = useMemo(() => {
    return [...listings]
      .filter((listing) => {
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
        const dateTimeA = `${a.date.slice(0, 10)} ${a.departureTime || '23:59'}`;
        const dateTimeB = `${b.date.slice(0, 10)} ${b.departureTime || '23:59'}`;
        return dateTimeA.localeCompare(dateTimeB);
      });
  }, [listings, listingType, tripDate, query]);

  const driverCount = filteredListings.filter((item) => item.listingType === 'driver').length;
  const passengerCount = filteredListings.filter((item) => item.listingType === 'passenger').length;

  return (
    <div className="poputky-page">
      <div className="poputky-container">
        <div className="poputky-header">
          <h1>🚗 Попутки</h1>
          <p>Окрема сторінка для пошуку поїздок: водії, пасажири та Telegram-інтеграція.</p>
        </div>

        <div className="telegram-features-grid">
          <article className="feature-card">
            <h3>🚗 Запит на поїздку як водій</h3>
            <p>Увійдіть через Telegram, відкрийте бота та опишіть рейс: маршрут, дату, час і кількість місць.</p>
          </article>
          <article className="feature-card">
            <h3>👤 Запит на поїздку як пасажир</h3>
            <p>Через Telegram залишайте запит із маршрутом і бажаним часом, щоб знайти вільного водія.</p>
          </article>
          <article className="feature-card">
            <h3>🌐 Вільний перегляд без логіну</h3>
            <p>Нижче доступний відкритий список актуальних попуток без авторизації на сайті.</p>
          </article>
        </div>

        <div className="telegram-actions">
          <a
            href={telegramScenarios.scenarios.driver.deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="telegram-action-button"
          >
            🚗 Я водій
          </a>
          <a
            href={telegramScenarios.scenarios.passenger.deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="telegram-action-button"
          >
            👤 Я пасажир
          </a>
          <a
            href={telegramScenarios.scenarios.view.webLink || 'https://malin.kiev.ua/poputky'}
            target="_blank"
            rel="noopener noreferrer"
            className="telegram-action-button telegram-action-button--secondary"
          >
            🌐 Вільний перегляд
          </a>
          <div className="telegram-commands">
            <span>Доступні команди:</span>
            <code>{telegramScenarios.scenarios.driver.command}</code>
            <code>{telegramScenarios.scenarios.passenger.command}</code>
            <code>{telegramScenarios.scenarios.view.command}</code>
          </div>
        </div>

        <div className="poputky-controls">
          <select
            value={listingType}
            onChange={(e) => setListingType(e.target.value as ViberListingType | '')}
          >
            <option value="">Всі типи</option>
            <option value="driver">🚗 Водії</option>
            <option value="passenger">👤 Пасажири</option>
          </select>
          <input
            type="date"
            value={tripDate}
            onChange={(e) => setTripDate(e.target.value)}
          />
          <input
            type="text"
            placeholder="Пошук: маршрут, ім'я, телефон..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" onClick={loadPoputky} disabled={loading}>
            {loading ? 'Оновлення...' : 'Оновити'}
          </button>
        </div>

        <div className="poputky-stats">
          <div className="stat-card">
            <span>Всього</span>
            <strong>{filteredListings.length}</strong>
          </div>
          <div className="stat-card">
            <span>Водії</span>
            <strong>{driverCount}</strong>
          </div>
          <div className="stat-card">
            <span>Пасажири</span>
            <strong>{passengerCount}</strong>
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {loading ? (
          <div className="poputky-loading">Завантаження попуток...</div>
        ) : filteredListings.length === 0 ? (
          <div className="poputky-empty">
            Зараз немає активних попуток за вибраними фільтрами.
          </div>
        ) : (
          <div className="poputky-list">
            {filteredListings.map((listing) => (
              <article key={listing.id} className="poputky-item">
                <div className="poputky-item-header">
                  <span className={`poputky-badge ${listing.listingType === 'driver' ? 'driver' : 'passenger'}`}>
                    {listing.listingType === 'driver' ? '🚗 Водій' : '👤 Пасажир'}
                  </span>
                  <span className="poputky-date">
                    {formatTripDate(listing.date)}
                    {listing.departureTime ? `, ${listing.departureTime}` : ''}
                  </span>
                </div>

                <h3>{formatRouteLabel(listing.route)}</h3>

                <div className="poputky-meta">
                  {listing.senderName && <span>👤 {listing.senderName}</span>}
                  {listing.seats != null && (
                    <span>👥 {listing.seats} {listing.listingType === 'driver' ? 'місць' : 'пасажирів'}</span>
                  )}
                </div>

                {listing.notes && <p className="poputky-notes">{listing.notes}</p>}

                <a href={supportPhoneToTelLink(listing.phone)} className="poputky-phone">
                  📞 {formatPhoneDisplay(listing.phone)}
                </a>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
