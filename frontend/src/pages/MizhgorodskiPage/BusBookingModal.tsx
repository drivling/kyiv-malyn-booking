import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { Alert } from '@/components/Alert';
import type { Availability, Schedule } from '@/types';
import type { BookingCity } from '@/utils/constants';
import { formatPhoneDisplay, supportPhoneToTelLink } from '@/utils/constants';
import { userState } from '@/utils/userState';
import { cityLabel, formatRouteLabel, formatTripDate } from './mizhUtils';

type Props = {
  schedule: Schedule;
  date: string;
  fromCity: BookingCity;
  toCity: BookingCity;
  initialAvailability?: Availability | null;
  onClose: () => void;
};

export const BusBookingModal: React.FC<Props> = ({
  schedule,
  date,
  fromCity,
  toCity,
  initialAvailability = null,
  onClose,
}) => {
  const navigate = useNavigate();
  const [seats, setSeats] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState(() => userState.getTelegramPhone() || '');
  const [availability, setAvailability] = useState<Availability | null>(initialAvailability);
  const [loadingAvailability, setLoadingAvailability] = useState(!initialAvailability);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [supportPhone, setSupportPhone] = useState<string | null>(schedule.supportPhone);

  useEffect(() => {
    let cancelled = false;
    setLoadingAvailability(true);
    apiClient
      .checkAvailabilityByScheduleId(schedule.id, date)
      .then((data) => {
        if (!cancelled) setAvailability(data);
      })
      .catch(() => {
        if (!cancelled) setAvailability(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingAvailability(false);
      });
    return () => {
      cancelled = true;
    };
  }, [schedule.id, date]);

  useEffect(() => {
    if (schedule.supportPhone) {
      setSupportPhone(schedule.supportPhone);
      return;
    }
    apiClient
      .getSchedulesSupportPhone()
      .then((r) => setSupportPhone(r.supportPhone))
      .catch(() => {});
  }, [schedule.supportPhone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const availableSeats = availability?.availableSeats;
  const isSoldOut = availability != null && !availability.isAvailable;
  const maxSeats = availability?.availableSeats ?? schedule.maxSeats;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!phone.trim()) {
      setError('Введіть телефон');
      return;
    }
    if (!name.trim()) {
      setError("Введіть ім'я та прізвище");
      return;
    }
    const nameParts = name.trim().split(/\s+/);
    if (nameParts.length < 2) {
      setError('Будь ласка, введіть ім\'я та прізвище (наприклад: Іван Петренко)');
      return;
    }
    if (seats < 1) {
      setError('Вкажіть кількість місць');
      return;
    }
    if (isSoldOut) {
      setError('Місця закінчились на цей рейс');
      return;
    }

    setSubmitting(true);
    try {
      const currentUser = userState.get();
      let telegramUserId: string | undefined;
      if (currentUser?.type === 'telegram' && phone) {
        userState.loginTelegram(currentUser.user, phone);
        telegramUserId = currentUser.user.id.toString();
      }
      await apiClient.createBooking({
        scheduleId: schedule.id,
        route: schedule.route,
        date,
        departureTime: schedule.departureTime,
        seats,
        name: name.trim(),
        phone: phone.trim(),
        telegramUserId,
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка при створенні бронювання');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mizh-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="mizh-modal mizh-modal--offer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mizh-bus-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mizh-modal-close" onClick={onClose} aria-label="Закрити">
          ×
        </button>
        <h2 id="mizh-bus-title">Бронювання маршрутки</h2>
        <p className="mizh-modal-subtitle">
          {cityLabel(fromCity)} → {cityLabel(toCity)} · {formatTripDate(date)} · {schedule.departureTime}
        </p>

        <div className="mizh-modal-details">
          <div>
            <strong>Рейс:</strong> {formatRouteLabel(schedule.route)}
          </div>
          <div>
            <strong>Місця:</strong>{' '}
            {loadingAvailability
              ? 'перевіряємо…'
              : availability
                ? `${availability.availableSeats} з ${availability.maxSeats} вільних`
                : `до ${schedule.maxSeats}`}
          </div>
        </div>

        {success ? (
          <>
            <Alert variant="success">Заявку прийнято</Alert>
            {supportPhone && (
              <p className="mizh-modal-subtitle">
                Для підтвердження зручно зателефонувати:{' '}
                <a href={supportPhoneToTelLink(supportPhone)}>{formatPhoneDisplay(supportPhone)}</a>
              </p>
            )}
            <button type="button" className="mizh-offer-submit" onClick={onClose}>
              Готово
            </button>
          </>
        ) : (
          <form className="mizh-offer-form" onSubmit={handleSubmit}>
            {isSoldOut && <Alert variant="warning">Місця на цей рейс закінчились</Alert>}
            {availability && availability.isAvailable && availability.availableSeats <= 5 && (
              <Alert variant="info">Залишилось мало місць: {availability.availableSeats}</Alert>
            )}

            <label className="mizh-field">
              <span className="mizh-field-label">Місця</span>
              <input
                type="number"
                className="mizh-field-control"
                min={1}
                max={Math.max(1, maxSeats)}
                value={seats}
                onChange={(e) => setSeats(Number(e.target.value))}
                required
                disabled={isSoldOut}
              />
            </label>

            <label className="mizh-field">
              <span className="mizh-field-label">Телефон</span>
              <input
                type="tel"
                className="mizh-field-control"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="0501234567"
                required
                disabled={isSoldOut}
              />
            </label>

            <label className="mizh-field">
              <span className="mizh-field-label">Імʼя та прізвище</span>
              <input
                type="text"
                className="mizh-field-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Іван Петренко"
                required
                disabled={isSoldOut}
              />
            </label>

            {!userState.isTelegramUser() && (
              <button type="button" className="mizh-card-cta mizh-card-cta--ghost" onClick={() => navigate('/login')}>
                Увійти через Telegram (опційно)
              </button>
            )}

            {error && <Alert variant="error">{error}</Alert>}

            <button
              type="submit"
              className="mizh-offer-submit"
              disabled={submitting || isSoldOut || loadingAvailability}
            >
              {submitting ? 'Бронюємо…' : 'Забронювати'}
            </button>
            {availableSeats != null && (
              <p className="mizh-search-hint">Доступно місць: {availableSeats}</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
};
