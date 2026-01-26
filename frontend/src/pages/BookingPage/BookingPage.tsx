import React, { useState, useEffect } from 'react';
import { apiClient } from '@/api/client';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Alert } from '@/components/Alert';
import type { Route, Schedule, Availability, BookingFormData } from '@/types';
import { ROUTES } from '@/utils/constants';
import './BookingPage.css';

export const BookingPage: React.FC = () => {
  const [route, setRoute] = useState<Route | ''>('');
  const [date, setDate] = useState('');
  const [departureTime, setDepartureTime] = useState('');
  const [seats, setSeats] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSchedules, setLoadingSchedules] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [warning, setWarning] = useState('');

  // Завантаження розкладу при зміні маршруту
  useEffect(() => {
    if (!route) {
      setSchedules([]);
      setDepartureTime('');
      return;
    }

    const loadSchedules = async () => {
      setLoadingSchedules(true);
      setError('');
      try {
        const data = await apiClient.getSchedulesByRoute(route);
        setSchedules(data);
        if (data.length === 0) {
          setDepartureTime('');
        }
      } catch (err) {
        setError('Не вдалося завантажити розклад');
      } finally {
        setLoadingSchedules(false);
      }
    };

    loadSchedules();
  }, [route]);

  // Перевірка доступності при зміні часу або дати
  useEffect(() => {
    if (!route || !departureTime || !date) {
      setAvailability(null);
      setWarning('');
      return;
    }

    const checkAvailability = async () => {
      try {
        const data = await apiClient.checkAvailability(route, departureTime, date);
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
  }, [route, departureTime, date]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    // Детальна валідація з конкретними повідомленнями
    if (!route) {
      setError('Оберіть напрямок');
      return;
    }
    if (!departureTime) {
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
    if (!name || name.trim() === '') {
      setError('Введіть ім\'я');
      return;
    }
    if (!phone || phone.trim() === '') {
      setError('Введіть телефон');
      return;
    }

    setLoading(true);
    try {
      const formData: BookingFormData = {
        route: route as Route,
        date,
        departureTime,
        seats,
        name,
        phone,
      };

      await apiClient.createBooking(formData);
      setSuccess(true);
      
      // Очищення форми
      setRoute('');
      setDate('');
      setDepartureTime('');
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

  const routeOptions = Object.entries(ROUTES).map(([value, label]) => ({
    value,
    label,
  }));

  const timeOptions = schedules.map((s) => ({
    value: s.departureTime,
    label: s.departureTime,
  }));

  const isFormDisabled = loading || (availability !== null && !availability.isAvailable);

  return (
    <div className="booking-page">
      <div className="booking-container">
        <h2>Бронювання маршрутки</h2>
        <form onSubmit={handleSubmit}>
          <Select
            label="Напрямок"
            options={[
              { value: '', label: 'Оберіть напрямок' },
              ...routeOptions,
            ]}
            value={route}
            onChange={(e) => setRoute(e.target.value as Route | '')}
            required
          />

          <div className="select-wrapper">
            <span className="select-label">Час відправлення</span>
            {loadingSchedules && <span className="loading">Завантаження...</span>}
            <Select
              options={
                timeOptions.length > 0
                  ? timeOptions
                  : [{ value: '', label: 'Спочатку оберіть напрямок' }]
              }
              value={departureTime}
              onChange={(e) => setDepartureTime(e.target.value)}
              disabled={!route || loadingSchedules || schedules.length === 0}
              required
            />
            {availability && (
              <div className="availability-info">
                Доступно місць: {availability.availableSeats} з {availability.maxSeats}
              </div>
            )}
          </div>

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

          <Input
            label="Імʼя"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <Input
            label="Телефон"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
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
