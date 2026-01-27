import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { userState } from '@/utils/userState';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Alert } from '@/components/Alert';
import type { Route, BaseDirection, Schedule, Availability, BookingFormData } from '@/types';
import './BookingPage.css';

export const BookingPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  
  const [direction, setDirection] = useState<BaseDirection | ''>('');
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
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [warning, setWarning] = useState('');
  const [showTelegramInfo, setShowTelegramInfo] = useState(false);

  // Завантаження розкладу при зміні напрямку
  useEffect(() => {
    if (!direction) {
      setSchedules([]);
      setSelectedSchedule(null);
      return;
    }

    const loadSchedules = async () => {
      setLoadingSchedules(true);
      setError('');
      try {
        // Завантажуємо графіки для обох маршрутів (Ірпінь та Буча)
        const irpinRoute = `${direction}-Irpin` as Route;
        const buchaRoute = `${direction}-Bucha` as Route;
        
        const [irpinData, buchaData] = await Promise.all([
          apiClient.getSchedulesByRoute(irpinRoute).catch(() => []),
          apiClient.getSchedulesByRoute(buchaRoute).catch(() => []),
        ]);
        
        const allSchedules = [...irpinData, ...buchaData];
        // Сортуємо по часу
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

    loadSchedules();
  }, [direction]);

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
          setWarning(`⚠️ Місця закінчились! Доступно місць: 0 з ${data.maxSeats}`);
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
    if (!direction) {
      setError('Оберіть напрямок');
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
      setError('Введіть ім\'я');
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
      
      // Зберігаємо номер телефону для Telegram користувачів
      const shouldKeepPhone = userState.isTelegramUser();
      
      // Очищення форми через 1 секунду щоб користувач побачив повідомлення
      setTimeout(() => {
        setDirection('');
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

  const directionOptions = [
    { value: 'Kyiv-Malyn', label: 'Київ → Малин' },
    { value: 'Malyn-Kyiv', label: 'Малин → Київ' },
  ];

  const getRouteLabel = (route: Route) => {
    if (route.includes('Irpin')) return 'через Ірпінь';
    if (route.includes('Bucha')) return 'через Бучу';
    return '';
  };

  const timeOptions = schedules.map((s) => ({
    value: s.id.toString(),
    label: `${s.departureTime} (${getRouteLabel(s.route)})`,
    schedule: s,
  }));

  const handleTimeChange = (scheduleId: string) => {
    const schedule = schedules.find(s => s.id.toString() === scheduleId);
    setSelectedSchedule(schedule || null);
  };

  const isFormDisabled = loading || (availability !== null && !availability.isAvailable);

  return (
    <div className="booking-page">
      <div className="booking-container">
        <div className="booking-header">
          <h2>Бронювання маршрутки</h2>
          <p className="booking-subtitle">Київ ↔ Малин</p>
        </div>
        <form onSubmit={handleSubmit}>
          <Select
            label="Напрямок"
            options={[
              { value: '', label: 'Оберіть напрямок' },
              ...directionOptions,
            ]}
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value as BaseDirection | '');
              setSelectedSchedule(null);
            }}
            required
          />

          <div className="date-time-row">
            <Input
              label="Дата"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />

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
                    : [{ value: '', label: 'Спочатку оберіть напрямок' }]
                }
                value={selectedSchedule?.id.toString() || ''}
                onChange={(e) => handleTimeChange(e.target.value)}
                disabled={!direction || loadingSchedules || schedules.length === 0}
                required
              />
              {availability && (
                <div className="availability-info">
                  Доступно місць: {availability.availableSeats} з {availability.maxSeats}
                </div>
              )}
            </div>
          </div>

          <div className="phone-input-group">
            <Input
              label="Телефон"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0501234567"
              required
            />
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

          <Input
            label="Імʼя"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <Input
            label="Місця"
            type="number"
            value={seats}
            onChange={(e) => setSeats(Number(e.target.value))}
            min={1}
            max={8}
            required
          />

          <Button type="submit" disabled={isFormDisabled}>
            {loading ? 'Обробка...' : 'Забронювати'}
          </Button>
        </form>

        {success && <Alert variant="success">✅ Заявку прийнято</Alert>}
        {error && <Alert variant="error">{error}</Alert>}
        {warning && <Alert variant="warning">{warning}</Alert>}
        {availability && availability.availableSeats <= 5 && availability.isAvailable && (
          <Alert variant="info">ℹ️ Залишилось мало місць: {availability.availableSeats}</Alert>
        )}

        {/* Telegram нотифікації - інформаційний блок */}
        <div className="telegram-info-block">
          <div className="telegram-icon">📱</div>
          <div className="telegram-content">
            <h3>Отримуйте нотифікації в Telegram!</h3>
            <p>Підтвердження бронювання та нагадування за день до поїздки</p>
            <div className="telegram-steps">
              <div className="step">
                <span className="step-number">1</span>
                <span>Знайдіть бота: <strong>@malin_kiev_ua_bot</strong></span>
              </div>
              <div className="step">
                <span className="step-number">2</span>
                <span>Напишіть: <code>/subscribe {phone || 'ВАШ_НОМЕР'}</code></span>
              </div>
              <div className="step">
                <span className="step-number">3</span>
                <span>Готово! Отримуйте повідомлення автоматично ✅</span>
              </div>
            </div>
            <a 
              href={`https://t.me/malin_kiev_ua_bot?start=subscribe`}
              target="_blank"
              rel="noopener noreferrer"
              className="telegram-button"
            >
              <span className="telegram-button-icon">✈️</span>
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
                onClick={() => setShowTelegramInfo(false)}
              >
                ×
              </button>
              <div className="telegram-success-icon">🎉</div>
              <h3>Бронювання створено!</h3>
              <p className="telegram-success-text">
                Хочете отримувати автоматичні повідомлення про ваші поїздки?
              </p>
              <div className="telegram-success-steps">
                <p><strong>Підпишіться на нашого Telegram бота:</strong></p>
                <div className="telegram-command">
                  <code>/subscribe {phone}</code>
                  <button 
                    className="copy-button"
                    onClick={() => {
                      navigator.clipboard.writeText(`/subscribe ${phone}`);
                    }}
                  >
                    📋
                  </button>
                </div>
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
                onClick={() => setShowTelegramInfo(false)}
              >
                Пропустити
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
