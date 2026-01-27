import React, { useState, useEffect } from 'react';
import { apiClient } from '@/api/client';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Alert } from '@/components/Alert';
import type { Route, BaseDirection, Schedule, Availability, BookingFormData } from '@/types';
import './BookingPage.css';

export const BookingPage: React.FC = () => {
  const [direction, setDirection] = useState<BaseDirection | ''>('');
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [date, setDate] = useState('');
  const [seats, setSeats] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [warning, setWarning] = useState('');

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
      const formData: BookingFormData = {
        route: selectedSchedule.route,
        date,
        departureTime: selectedSchedule.departureTime,
        seats,
        name,
        phone,
      };

      await apiClient.createBooking(formData);
      setSuccess(true);
      
      // Очищення форми
      setDirection('');
      setDate('');
      setSelectedSchedule(null);
      setSeats(1);
      setName('');
      setPhone('');
      setAvailability(null);
      setWarning('');
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

          <Input
            label="Телефон"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0501234567"
            required
          />
          {loadingCustomer && <span className="loading" style={{ fontSize: '12px', marginTop: '4px' }}>Пошук клієнта...</span>}

          <Input
            label="Імʼя"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <Input
            label="Дата"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
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
      </div>
    </div>
  );
};
