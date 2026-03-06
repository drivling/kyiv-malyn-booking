import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { userState } from '@/utils/userState';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Alert } from '@/components/Alert';
import type { Route, BaseDirection, Schedule, Availability, BookingFormData, ViberListing } from '@/types';
import { DIRECTION_ROUTES, supportPhoneToTelLink, formatPhoneDisplay, BOOKING_CITY_LABELS, BOOKING_FROM_TO, getDirectionFromCities, BOOKING_POPULAR_ROUTES } from '@/utils/constants';
import { maskSenderNameForDisplay } from '@/utils/nameMask';
import type { BookingCity } from '@/utils/constants';
import './BookingPage.css';

const VALID_CITIES: BookingCity[] = ['Kyiv', 'Malyn', 'Zhytomyr', 'Korosten'];

function parseFromToFromSearchParams(searchParams: URLSearchParams): { from: BookingCity; to: BookingCity } | null {
  const from = searchParams.get('from') as BookingCity | null;
  const to = searchParams.get('to') as BookingCity | null;
  if (!from || !to || !VALID_CITIES.includes(from) || !VALID_CITIES.includes(to)) return null;
  if (!getDirectionFromCities(from, to)) return null;
  return { from, to };
}

export const BookingPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialFromTo = useMemo(() => parseFromToFromSearchParams(searchParams), []);
  const [fromCity, setFromCity] = useState<BookingCity | ''>(() => initialFromTo?.from ?? '');
  const [toCity, setToCity] = useState<BookingCity | ''>(() => initialFromTo?.to ?? '');
  const direction: BaseDirection | '' = fromCity && toCity ? (getDirectionFromCities(fromCity, toCity) ?? '') : '';
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  // Встановлюємо сьогоднішню дату за замовчуванням
  const [date, setDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [seats, setSeats] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(() => {
    // Автоматично заповнюємо номер телефону з Telegram
    const savedPhone = userState.getTelegramPhone();
    const locationPhone = location.state?.telegramPhone;
    return locationPhone || savedPhone || '';
  });

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [viberListings, setViberListings] = useState<ViberListing[]>([]);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [warning, setWarning] = useState('');
  const [showTelegramInfo, setShowTelegramInfo] = useState(false);
  const [selectedViberListing, setSelectedViberListing] = useState<ViberListing | null>(null);
  const [showViberModal, setShowViberModal] = useState(false);
  const [supportPhone, setSupportPhone] = useState<string | null>(null);
  /** Телефон підтримки, зафіксований при відкритті модалки «Бронювання створено» (з БД, не хардкод) */
  const [successModalSupportPhone, setSuccessModalSupportPhone] = useState<string | null>(null);

  // Синхронізація from/to з URL (ділитися посиланням на маршрут)
  useEffect(() => {
    if (fromCity && toCity) {
      setSearchParams({ from: fromCity, to: toCity }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [fromCity, toCity, setSearchParams]);

  // Телефон підтримки з графіка (для напрямків з Києвом)
  useEffect(() => {
    apiClient.getSchedulesSupportPhone().then((r) => setSupportPhone(r.supportPhone)).catch(() => {});
  }, []);

  // Завантаження розкладу та Viber оголошень при зміні напрямку або дати
  useEffect(() => {
    if (!direction) {
      setSchedules([]);
      setSelectedSchedule(null);
      setViberListings([]);
      return;
    }

    const loadSchedules = async () => {
      setLoadingSchedules(true);
      setError('');
      try {
        const routes = DIRECTION_ROUTES[direction as BaseDirection] || [];
        const results = await Promise.all(
          routes.map((route) => apiClient.getSchedulesByRoute(route).catch(() => []))
        );
        const allSchedules = results.flat();
        allSchedules.sort((a, b) => a.departureTime.localeCompare(b.departureTime));
        setSchedules(allSchedules);
        if (allSchedules.length === 0) {
          setSelectedSchedule(null);
        }
      } catch (err) {
        setError('Не вдалося завантажити розклад');
      } finally {
        setLoadingSchedules(false);
      }
    };

    const loadViberListings = async () => {
      if (!date) return;
      
      try {
        const listings = await apiClient.searchViberListings(direction, date);
        setViberListings(listings);
      } catch (err) {
        console.error('Не вдалося завантажити Viber оголошення:', err);
        // Не показуємо помилку користувачу - це не критично
      }
    };

    loadSchedules();
    loadViberListings();
  }, [direction, date]);

  // Показати повідомлення якщо потрібен номер після Telegram Login
  useEffect(() => {
    if (location.state?.needPhone) {
      setWarning('Будь ласка, вкажіть ваш номер телефону нижче');
      // Очищаємо state щоб повідомлення не показувалося при наступному візиті
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Оновлення номера в userState при зміні
  useEffect(() => {
    const currentUser = userState.get();
    if (currentUser?.type === 'telegram' && phone && phone.length >= 10) {
      // Якщо користувач Telegram і ввів номер - оновлюємо
      if (currentUser.phone !== phone) {
        userState.loginTelegram(currentUser.user, phone);
        console.log('Оновлено номер телефону в userState:', phone);
      }
    }
  }, [phone]);

  // Пошук клієнта по телефону
  useEffect(() => {
    if (!phone || phone.length < 10) {
      return;
    }

    const searchCustomer = async () => {
      setLoadingCustomer(true);
      try {
        const lastBooking = await apiClient.findLastBookingByPhone(phone);
        if (lastBooking && lastBooking.name) {
          setName(lastBooking.name);
        }
      } catch (err) {
        // Якщо не вдалося знайти, просто ігноруємо
      } finally {
        setLoadingCustomer(false);
      }
    };

    // Затримка для уникнення занадто частих запитів
    const timeoutId = setTimeout(searchCustomer, 500);
    return () => clearTimeout(timeoutId);
  }, [phone]);

  // Перевірка доступності при зміні часу або дати
  useEffect(() => {
    if (!selectedSchedule || !date) {
      setAvailability(null);
      setWarning('');
      return;
    }

    const checkAvailability = async () => {
      try {
        const data = await apiClient.checkAvailability(
          selectedSchedule.route, 
          selectedSchedule.departureTime, 
          date
        );
        setAvailability(data);
        if (!data.isAvailable) {
          setWarning(`Місця закінчились. Доступно: 0 з ${data.maxSeats}`);
        } else {
          setWarning('');
        }
      } catch (err) {
        // Якщо не вдалося перевірити, все одно дозволяємо бронювання
        setAvailability(null);
      }
    };

    checkAvailability();
  }, [selectedSchedule, date]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    // Детальна валідація з конкретними повідомленнями
    if (!fromCity || !toCity || !direction) {
      setError('Оберіть звідки та куди (маршрути тільки через Малин)');
      return;
    }
    if (!selectedSchedule) {
      setError('Оберіть час відправлення');
      return;
    }
    if (!date) {
      setError('Оберіть дату');
      return;
    }
    if (!seats || seats < 1) {
      setError('Вкажіть кількість місць (мінімум 1)');
      return;
    }
    if (!phone || phone.trim() === '') {
      setError('Введіть телефон');
      return;
    }
    if (!name || name.trim() === '') {
      setError('Введіть ім\'я та прізвище');
      return;
    }
    // Перевірка що введено і ім'я, і прізвище (мінімум 2 слова)
    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length < 2) {
      setError('Будь ласка, введіть ім\'я та прізвище (наприклад: Іван Петренко)');
      return;
    }

    setLoading(true);
    try {
      // Якщо користувач Telegram і ввів номер - зберігаємо в userState перед відправкою
      const currentUser = userState.get();
      let telegramUserId: string | undefined;
      
      if (currentUser?.type === 'telegram' && phone) {
        userState.loginTelegram(currentUser.user, phone);
        telegramUserId = currentUser.user.id.toString();
        console.log('✅ Прив\'язано номер телефону до Telegram акаунту:', phone, 'userId:', telegramUserId);
      }

      const formData: BookingFormData = {
        route: selectedSchedule.route,
        date,
        departureTime: selectedSchedule.departureTime,
        seats,
        name,
        phone,
        telegramUserId, // Передаємо Telegram User ID для першого бронювання
      };

      await apiClient.createBooking(formData);
      setSuccess(true);
      setShowTelegramInfo(true);
      // Фіксуємо телефон підтримки з БД для модалки (обраний рейс або глобальний з графіка)
      setSuccessModalSupportPhone(selectedSchedule?.supportPhone ?? supportPhone ?? null);
      
      // Зберігаємо номер телефону для Telegram користувачів
      const shouldKeepPhone = userState.isTelegramUser();
      
      // Очищення форми через 1 секунду щоб користувач побачив повідомлення
      setTimeout(() => {
        setFromCity('');
        setToCity('');
        // Залишаємо дату встановленою на сьогодні
        const today = new Date();
        setDate(today.toISOString().split('T')[0]);
        setSelectedSchedule(null);
        setSeats(1);
        setName('');
        // НЕ очищаємо номер для Telegram користувачів
        if (!shouldKeepPhone) {
          setPhone('');
        }
        setAvailability(null);
        setWarning('');
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка при створенні бронювання');
    } finally {
      setLoading(false);
    }
  };

  const fromCityOptions = (Object.entries(BOOKING_CITY_LABELS) as [BookingCity, string][]).map(([value, label]) => ({
    value,
    label,
  }));

  const toCityOptions = fromCity
    ? BOOKING_FROM_TO.filter((p) => p.from === fromCity).map((p) => ({
        value: p.to,
        label: BOOKING_CITY_LABELS[p.to],
      }))
    : [];

  const getRouteLabel = (route: Route) => {
    if (route.includes('Irpin')) return 'через Ірпінь';
    if (route.includes('Bucha')) return 'через Бучу';
    return 'прямий маршрут';
  };

  const formatViberRoute = (route: string) =>
    route
      .replace('Kyiv-Malyn', 'Київ → Малин')
      .replace('Malyn-Kyiv', 'Малин → Київ')
      .replace('Malyn-Zhytomyr', 'Малин → Житомир')
      .replace('Zhytomyr-Malyn', 'Житомир → Малин')
      .replace('Korosten-Malyn', 'Коростень → Малин')
      .replace('Malyn-Korosten', 'Малин → Коростень');

  const timeOptions = schedules.map((s) => ({
    value: s.id.toString(),
    label: `${s.departureTime} (${getRouteLabel(s.route)})`,
    schedule: s,
  }));

  const handleTimeChange = (scheduleId: string) => {
    const schedule = schedules.find(s => s.id.toString() === scheduleId);
    setSelectedSchedule(schedule || null);
  };

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const isDateInPast = date && date < todayISO;
  const isFormDisabled = loading || (availability !== null && !availability.isAvailable) || !!isDateInPast;

  const currentStep = !fromCity || !toCity ? 1 : !selectedSchedule ? 2 : 3;

  const handlePopularRoute = (from: BookingCity, to: BookingCity) => {
    setFromCity(from);
    setToCity(to);
    setSelectedSchedule(null);
  };

  const handleViberListingClick = (listing: ViberListing) => {
    setSelectedViberListing(listing);
    setShowViberModal(true);
  };

  return (
    <div className="booking-page">
      <div className="booking-container">
        <div className="booking-header">
          <h2>Бронювання поїздки</h2>
          <p className="booking-subtitle">Маршрути тільки через Малин · Київ, Житомир, Коростень</p>
        </div>

        <nav className="booking-progress" aria-label="Прогрес бронювання">
          <div className={`booking-progress-step ${currentStep >= 1 ? 'active' : ''} ${currentStep > 1 ? 'done' : ''}`}>
            <span className="booking-progress-num">1</span>
            <span className="booking-progress-label">Маршрут</span>
          </div>
          <div className="booking-progress-line" aria-hidden />
          <div className={`booking-progress-step ${currentStep >= 2 ? 'active' : ''} ${currentStep > 2 ? 'done' : ''}`}>
            <span className="booking-progress-num">2</span>
            <span className="booking-progress-label">Дата і час</span>
          </div>
          <div className="booking-progress-line" aria-hidden />
          <div className={`booking-progress-step ${currentStep >= 3 ? 'active' : ''}`}>
            <span className="booking-progress-num">3</span>
            <span className="booking-progress-label">Контакти</span>
          </div>
        </nav>

        <form onSubmit={handleSubmit} className="booking-form">
          <section className={`booking-step ${currentStep === 1 ? 'current' : ''}`} aria-label="Крок 1: Маршрут">
            <h3 className="booking-step-title">Маршрут</h3>
            <div className="booking-quick-routes">
              <span className="booking-quick-label">Популярні:</span>
              {BOOKING_POPULAR_ROUTES.map(({ from, to, label }) => (
                <button
                  key={`${from}-${to}`}
                  type="button"
                  className={`booking-quick-btn ${fromCity === from && toCity === to ? 'active' : ''}`}
                  onClick={() => handlePopularRoute(from, to)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="booking-route-row">
              <Select
                label="Звідки"
                options={[{ value: '', label: 'Оберіть місто' }, ...fromCityOptions]}
                value={fromCity}
                onChange={(e) => {
                  const next = (e.target.value || '') as BookingCity | '';
                  setFromCity(next);
                  setToCity('');
                  setSelectedSchedule(null);
                }}
                required
              />
              <span className="booking-route-arrow" aria-hidden>→</span>
              <Select
                label="Куди"
                options={[{ value: '', label: 'Оберіть місто' }, ...toCityOptions]}
                value={toCity}
                onChange={(e) => {
                  setToCity((e.target.value || '') as BookingCity | '');
                  setSelectedSchedule(null);
                }}
                required
                disabled={!fromCity}
              />
            </div>
            <p className="booking-route-hint">Усі маршрути проходять через Малин</p>
          </section>

          <section className={`booking-step ${currentStep === 2 ? 'current' : ''}`} aria-label="Крок 2: Дата і час">
            <h3 className="booking-step-title">Дата і час</h3>
          <div className="date-time-row">
            <div className="booking-date-wrap">
              <Input
                label="Дата"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={todayISO}
                required
              />
              {isDateInPast && (
                <p className="booking-date-warning" role="alert">
                  Обрана дата в минулому. Оберіть сьогодні або пізнішу дату.
                </p>
              )}
            </div>

            <div className="select-wrapper">
              <span className="select-label">Час відправлення</span>
              {loadingSchedules && <span className="loading">Завантаження...</span>}
              <Select
                options={
                  timeOptions.length > 0
                    ? [
                        { value: '', label: 'Оберіть час' },
                        ...timeOptions
                      ]
                    : [{ value: '', label: fromCity && toCity ? 'Оберіть час' : 'Спочатку оберіть маршрут' }]
                }
                value={selectedSchedule?.id.toString() || ''}
                onChange={(e) => handleTimeChange(e.target.value)}
                disabled={!fromCity || !toCity || loadingSchedules || schedules.length === 0}
                required
              />
              {availability && (
                <div className="availability-info">
                  Доступно місць: {availability.availableSeats} з {availability.maxSeats}
                </div>
              )}
            </div>
          </div>
          </section>

          <section className={`booking-step ${currentStep === 3 ? 'current' : ''}`} aria-label="Крок 3: Контакти">
            <h3 className="booking-step-title">Контакти</h3>
          <div className="phone-name-row">
            <div className="phone-name-row__field phone-name-row__field--phone">
              <Input
                label="Телефон"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0501234567"
                required
              />
            </div>
            <div className="phone-name-row__field">
              <Input
                label="Ім'я та прізвище"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Іван Петренко"
                required
              />
            </div>
            <div className="phone-name-row__seats">
              <Input
                label="Місця"
                type="number"
                value={seats}
                onChange={(e) => setSeats(Number(e.target.value))}
                min={1}
                max={8}
                required
              />
            </div>
          </div>

          <div className="telegram-row">
            {userState.isTelegramUser() ? (
              phone ? (
                <div className="telegram-status-success">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  <span>Підключено до Telegram</span>
                </div>
              ) : (
                <div className="telegram-status-warning">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span>Введіть ваш номер телефону</span>
                </div>
              )
            ) : (
              <button
                type="button"
                className="telegram-login-hint"
                onClick={() => navigate('/login')}
                title="Увійти через Telegram для автозаповнення"
              >
                <svg width="20" height="20" viewBox="0 0 240 240" fill="currentColor">
                  <path d="M0,120 C0,53.726 53.726,0 120,0 S240,53.726 240,120 240,186.274 186.274,240 120,240 0,186.274 0,120 Z M98.997,126.324 L81.981,181.624 C81.981,181.624 79.326,189.274 86.726,181.624 L113.926,156.699 L145.026,179.024 Z M100.997,121.724 L151.926,89.324 C151.926,89.324 156.226,86.799 155.976,89.324 C155.976,89.324 156.726,89.824 153.976,92.324 L110.476,131.324 L108.851,155.699 Z"/>
                </svg>
                <span>Логін через Telegram</span>
              </button>
            )}
            {loadingCustomer && <span className="loading" style={{ fontSize: '12px', marginTop: '4px' }}>Пошук клієнта...</span>}
          </div>

          <Button type="submit" disabled={isFormDisabled} className="booking-submit-btn">
            {loading ? 'Обробка...' : 'Забронювати'}
          </Button>
          </section>
        </form>

        <div role="status" aria-live="polite" aria-atomic="true" className="booking-alerts">
          {success && (
            <Alert variant="success">
              Заявку прийнято
              {(supportPhone || selectedSchedule?.supportPhone) && (
                <p className="booking-confirm-hint">
                  Якщо ви не зареєструєтесь в Telegram, ви не дізнаєтесь, що бронювання підтверджене. Краще зателефонувати для уточнення: <a href={supportPhoneToTelLink(selectedSchedule?.supportPhone ?? supportPhone)}>{formatPhoneDisplay(selectedSchedule?.supportPhone ?? supportPhone)}</a>
                </p>
              )}
            </Alert>
          )}
          {error && <Alert variant="error">{error}</Alert>}
          {warning && <Alert variant="warning">{warning}</Alert>}
          {availability && availability.availableSeats <= 5 && availability.isAvailable && (
            <Alert variant="info">Залишилось мало місць: {availability.availableSeats}</Alert>
          )}
        </div>

        {/* Попутки з розділу Попутки */}
        {viberListings.length > 0 && (
          <div className="viber-listings-section">
            <h3>Також доступні поїздки в розділі <Link to="/poputky" className="booking-poputky-link">Попутки</Link></h3>
            <p className="viber-subtitle">Для бронювання зателефонуйте за вказаним номером. Інші оголошення — у <Link to="/poputky" className="booking-poputky-link">розділі Попутки</Link>.</p>
            <div className="viber-listings">
              {viberListings.map((listing) => (
                <div 
                  key={listing.id} 
                  className="viber-listing-card"
                  onClick={() => handleViberListingClick(listing)}
                >
                  <div className="viber-listing-header">
                    <span className={`viber-badge ${listing.listingType === 'driver' ? 'viber-badge-driver' : 'viber-badge-passenger'}`}>
                      {listing.listingType === 'driver' ? 'Водій' : 'Пасажир'}
                    </span>
                    {listing.senderName && (
                      <span className="viber-sender">{maskSenderNameForDisplay(listing.senderName)}</span>
                    )}
                  </div>
                  <div className="viber-listing-route">
                    {formatViberRoute(listing.route)}
                  </div>
                  <div className="viber-listing-details">
                    <div className="viber-detail">
                      <span className="viber-icon" aria-hidden>📅</span>
                      <span>{new Date(listing.date).toLocaleDateString('uk-UA')}</span>
                    </div>
                    {listing.departureTime && (
                      <div className="viber-detail">
                        <span className="viber-icon">🕐</span>
                        <span>{listing.departureTime}</span>
                      </div>
                    )}
                    {listing.seats && (
                      <div className="viber-detail">
                        <span className="viber-icon">👥</span>
                        <span>{listing.seats} {listing.listingType === 'driver' ? 'місць' : 'пасажирів'}</span>
                      </div>
                    )}
                  </div>
                  {listing.notes && (
                    <div className="viber-listing-notes">{listing.notes}</div>
                  )}
                  <div className="viber-listing-action">
                    <span className="viber-phone-hint">Натисніть щоб подивитись телефон</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Telegram нотифікації - інформаційний блок */}
        <div className="telegram-info-block">
          <div className="telegram-icon" aria-hidden>📱</div>
          <div className="telegram-content">
            <h3>Отримуйте нотифікації в Telegram!</h3>
            <p>Без Telegram ви не дізнаєтесь, що бронювання підтверджене{((selectedSchedule?.supportPhone ?? supportPhone) ? <> — краще зателефонувати для уточнення: <a href={supportPhoneToTelLink(selectedSchedule?.supportPhone ?? supportPhone)}>{formatPhoneDisplay(selectedSchedule?.supportPhone ?? supportPhone)}</a></> : null)}. У Telegram — підтвердження та нагадування за день до поїздки.</p>
            <div className="telegram-steps">
              <div className="step">
                <span className="step-number">1</span>
                <span>Знайдіть бота: <strong>@malin_kiev_ua_bot</strong></span>
              </div>
              <div className="step">
                <span className="step-number">2</span>
                <span>Напишіть: <code>/start</code></span>
              </div>
              <div className="step">
                <span className="step-number">3</span>
                <span>Натисніть кнопку «Поділитися номером телефону» в боті</span>
              </div>
            </div>
            <a 
              href={`https://t.me/malin_kiev_ua_bot?start=subscribe`}
              target="_blank"
              rel="noopener noreferrer"
              className="telegram-button"
            >
              Відкрити Telegram бота
            </a>
          </div>
        </div>

        {/* Спливаюче повідомлення після успішного бронювання */}
        {showTelegramInfo && (
          <div className="telegram-success-modal">
            <div className="telegram-success-content">
              <button 
                className="telegram-close"
                onClick={() => { setShowTelegramInfo(false); setSuccessModalSupportPhone(null); }}
              >
                ×
              </button>
              <div className="telegram-success-icon" aria-hidden>🎉</div>
              <h3>Бронювання створено!</h3>
              {successModalSupportPhone && (
                <p className="telegram-success-text">
                  Якщо ви не зареєструєтесь в Telegram, ви не дізнаєтесь, що бронювання підтверджене. Краще зателефонувати для уточнення: <a href={supportPhoneToTelLink(successModalSupportPhone)}>{formatPhoneDisplay(successModalSupportPhone)}</a>
                </p>
              )}
              <p className="telegram-success-text">
                Хочете отримувати повідомлення про ваші поїздки в Telegram?
              </p>
              <div className="telegram-success-steps">
                <p><strong>Підпишіться на нашого Telegram бота:</strong></p>
                <div className="telegram-command">
                  <code>/start</code>
                </div>
                <p style={{ marginTop: 8, color: '#4b5563' }}>Після цього натисніть кнопку «Поділитися номером телефону» в боті.</p>
              </div>
              <a 
                href={`https://t.me/malin_kiev_ua_bot?start=subscribe`}
                target="_blank"
                rel="noopener noreferrer"
                className="telegram-success-button"
              >
                Відкрити бота в Telegram
              </a>
              <button 
                className="telegram-skip"
                onClick={() => { setShowTelegramInfo(false); setSuccessModalSupportPhone(null); }}
              >
                Пропустити
              </button>
            </div>
          </div>
        )}

        {/* Модалка з контактом для попутки */}
        {showViberModal && selectedViberListing && (
          <div
            className="telegram-success-modal booking-listing-modal-overlay"
            onClick={(e) => { if (e.target === e.currentTarget) { setShowViberModal(false); setSelectedViberListing(null); } }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-modal-title"
          >
            <div className="telegram-success-content booking-listing-modal">
              <div className="booking-modal-close-bar">
                <button
                  className="telegram-close"
                  onClick={() => { setShowViberModal(false); setSelectedViberListing(null); }}
                  aria-label="Закрити"
                >
                  ×
                </button>
              </div>
              <div className="telegram-success-icon viber-modal-icon" aria-hidden>📱</div>
              <h3 id="booking-modal-title">Контакт для бронювання</h3>
              <div className="viber-modal-info">
                <div className="viber-modal-row">
                  <span className="viber-modal-label">Тип:</span>
                  <span className="viber-modal-value">
                    {selectedViberListing.listingType === 'driver' ? 'Водій' : 'Пасажир'}
                  </span>
                </div>
                <div className="viber-modal-row">
                  <span className="viber-modal-label">Маршрут:</span>
                  <span className="viber-modal-value">
                    {formatViberRoute(selectedViberListing.route)}
                  </span>
                </div>
                <div className="viber-modal-row">
                  <span className="viber-modal-label">Дата:</span>
                  <span className="viber-modal-value">
                    {new Date(selectedViberListing.date).toLocaleDateString('uk-UA')}
                  </span>
                </div>
                {selectedViberListing.departureTime && (
                  <div className="viber-modal-row">
                    <span className="viber-modal-label">Час:</span>
                    <span className="viber-modal-value">{selectedViberListing.departureTime}</span>
                  </div>
                )}
                {selectedViberListing.senderName && (
                  <div className="viber-modal-row">
                    <span className="viber-modal-label">Відправник:</span>
                    <span className="viber-modal-value">{selectedViberListing.senderName}</span>
                  </div>
                )}
              </div>
              <div className="viber-phone-display">
                {selectedViberListing.phone ? (
                  <>
                    <a href={supportPhoneToTelLink(selectedViberListing.phone)} className="viber-phone-link">
                      {formatPhoneDisplay(selectedViberListing.phone)}
                    </a>
                    <button
                      className="copy-button"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedViberListing.phone);
                        alert('Номер скопійовано!');
                      }}
                      title="Скопіювати номер"
                    >
                      Копіювати
                    </button>
                  </>
                ) : (
                  <a
                    href="https://invite.viber.com/?g2=AQAcZm49UP6l%2FEkN%2Flr3iMqCoDYkoJX12FW%2BZtE59xbiYc%2BnCUVsmjZ%2Fu5qn1l4l"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="viber-phone-link"
                  >
                    Відкрити Viber групу
                  </a>
                )}
              </div>
              <p className="viber-modal-note">
                {selectedViberListing.phone
                  ? 'Зателефонуйте за вказаним номером для бронювання.'
                  : <>В цьому оголошенні немає телефону. <Link to="/poputky" className="booking-poputky-link" onClick={() => { setShowViberModal(false); setSelectedViberListing(null); }}>Подивитись контакти можна в розділі Попутки</Link>.</>}
              </p>
              <button
                className="telegram-skip booking-modal-close-btn"
                onClick={() => { setShowViberModal(false); setSelectedViberListing(null); }}
              >
                Закрити
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
