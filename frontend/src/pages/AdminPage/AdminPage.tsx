import React, { useState, useEffect } from 'react';
import { apiClient } from '@/api/client';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Alert } from '@/components/Alert';
import type { Booking, Schedule, Route, ScheduleFormData } from '@/types';
import { getRouteLabel, getRouteBadgeClass, ROUTES } from '@/utils/constants';
import './AdminPage.css';

type Tab = 'bookings' | 'schedules';

export const AdminPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('bookings');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Фільтри
  const [routeFilter, setRouteFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [scheduleRouteFilter, setScheduleRouteFilter] = useState('');

  // Модальне вікно для графіку
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormData>({
    route: 'Kyiv-Malyn-Irpin',
    departureTime: '',
    maxSeats: 20,
  });

  useEffect(() => {
    if (activeTab === 'bookings') {
      loadBookings();
    } else {
      loadSchedules();
    }
  }, [activeTab]);

  const loadBookings = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.getBookings();
      setBookings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  };

  const loadSchedules = async () => {
    setLoading(true);
    setError('');
    try {
      const data = scheduleRouteFilter
        ? await apiClient.getSchedules(scheduleRouteFilter)
        : await apiClient.getSchedules();
      // Сортування: спочатку по маршруту, потім по часу
      const sorted = [...data].sort((a, b) => {
        if (a.route !== b.route) {
          return a.route.localeCompare(b.route);
        }
        return a.departureTime.localeCompare(b.departureTime);
      });
      setSchedules(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  };

  const filteredBookings = bookings.filter((booking) => {
    if (routeFilter && booking.route !== routeFilter) return false;
    if (dateFilter) {
      const bookingDate = new Date(booking.date).toISOString().split('T')[0];
      if (bookingDate !== dateFilter) return false;
    }
    if (searchQuery) {
      const searchIn = `${booking.name} ${booking.phone}`.toLowerCase();
      if (!searchIn.includes(searchQuery.toLowerCase())) return false;
    }
    return true;
  });

  const handleDeleteBooking = async (id: number) => {
    if (!confirm('Ви впевнені, що хочете видалити це бронювання?')) return;
    try {
      await apiClient.deleteBooking(id);
      loadBookings();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Помилка видалення');
    }
  };

  const handleDeleteSchedule = async (id: number) => {
    if (!confirm('Ви впевнені, що хочете видалити цей рейс?')) return;
    try {
      await apiClient.deleteSchedule(id);
      loadSchedules();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Помилка видалення');
    }
  };

  const openScheduleModal = (schedule?: Schedule) => {
    if (schedule) {
      setEditingSchedule(schedule);
      setScheduleForm({
        route: schedule.route,
        departureTime: schedule.departureTime,
        maxSeats: schedule.maxSeats,
      });
    } else {
      setEditingSchedule(null);
      setScheduleForm({
        route: 'Kyiv-Malyn-Irpin',
        departureTime: '',
        maxSeats: 20,
      });
    }
    setIsScheduleModalOpen(true);
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editingSchedule) {
        await apiClient.updateSchedule(editingSchedule.id, scheduleForm);
      } else {
        await apiClient.createSchedule(scheduleForm);
      }
      setIsScheduleModalOpen(false);
      loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка збереження');
    }
  };

  const stats = {
    total: filteredBookings.length,
    kyivMalyn: filteredBookings.filter((b) => b.route.includes('Kyiv-Malyn')).length,
    malynKyiv: filteredBookings.filter((b) => b.route.includes('Malyn-Kyiv')).length,
    totalSeats: filteredBookings.reduce((sum, b) => sum + b.seats, 0),
  };

  const routeOptions = Object.entries(ROUTES).map(([value, label]) => ({
    value,
    label,
  }));

  return (
    <div className="admin-page">
      <div className="admin-container">
        <h1>📋 Адмін панель</h1>

        <div className="tabs">
          <button
            className={`tab ${activeTab === 'bookings' ? 'active' : ''}`}
            onClick={() => setActiveTab('bookings')}
          >
            📋 Бронювання
          </button>
          <button
            className={`tab ${activeTab === 'schedules' ? 'active' : ''}`}
            onClick={() => setActiveTab('schedules')}
          >
            🕐 Графіки
          </button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {activeTab === 'bookings' && (
          <div className="tab-content">
            <div className="stats">
              <div className="stat-card">
                <h3>Всього бронювань</h3>
                <div className="stat-value">{stats.total}</div>
              </div>
              <div className="stat-card">
                <h3>Київ → Малин</h3>
                <div className="stat-value">{stats.kyivMalyn}</div>
              </div>
              <div className="stat-card">
                <h3>Малин → Київ</h3>
                <div className="stat-value">{stats.malynKyiv}</div>
              </div>
              <div className="stat-card">
                <h3>Всього місць</h3>
                <div className="stat-value">{stats.totalSeats}</div>
              </div>
            </div>

            <div className="controls">
              <Select
                options={[
                  { value: '', label: 'Всі маршрути' },
                  ...routeOptions,
                ]}
                value={routeFilter}
                onChange={(e) => setRouteFilter(e.target.value)}
              />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="control-input"
              />
              <input
                type="text"
                placeholder="Пошук по імені або телефону..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="control-input"
              />
              <Button onClick={loadBookings}>🔄 Оновити</Button>
              <Button variant="secondary" onClick={() => {
                setRouteFilter('');
                setDateFilter('');
                setSearchQuery('');
              }}>
                Очистити фільтри
              </Button>
            </div>

            {loading ? (
              <div className="loading">Завантаження...</div>
            ) : filteredBookings.length === 0 ? (
              <div className="empty">📭 Немає бронювань</div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Маршрут</th>
                      <th>Дата</th>
                      <th>Час</th>
                      <th>Місця</th>
                      <th>Ім'я</th>
                      <th>Телефон</th>
                      <th>Створено</th>
                      <th>Дії</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBookings.map((booking) => (
                      <tr key={booking.id}>
                        <td>#{booking.id}</td>
                        <td>
                          <span className={`badge ${getRouteBadgeClass(booking.route)}`}>
                            {getRouteLabel(booking.route)}
                          </span>
                        </td>
                        <td>{new Date(booking.date).toLocaleDateString('uk-UA')}</td>
                        <td><strong>{booking.departureTime}</strong></td>
                        <td>{booking.seats}</td>
                        <td>{booking.name}</td>
                        <td>{booking.phone}</td>
                        <td>{new Date(booking.createdAt).toLocaleString('uk-UA')}</td>
                        <td>
                          <Button
                            variant="danger"
                            onClick={() => handleDeleteBooking(booking.id)}
                          >
                            Видалити
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'schedules' && (
          <div className="tab-content">
            <div className="controls">
              <Select
                options={[
                  { value: '', label: 'Всі маршрути' },
                  ...routeOptions,
                ]}
                value={scheduleRouteFilter}
                onChange={(e) => {
                  setScheduleRouteFilter(e.target.value);
                  loadSchedules();
                }}
              />
              <Button onClick={loadSchedules}>🔄 Оновити</Button>
              <Button onClick={() => openScheduleModal()}>➕ Додати рейс</Button>
            </div>

            {loading ? (
              <div className="loading">Завантаження...</div>
            ) : schedules.length === 0 ? (
              <div className="empty">🕐 Немає графіків</div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Маршрут</th>
                      <th>Час відправлення</th>
                      <th>Макс. місць</th>
                      <th>Створено</th>
                      <th>Оновлено</th>
                      <th>Дії</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((schedule) => (
                      <tr key={schedule.id}>
                        <td>#{schedule.id}</td>
                        <td>
                          <span className={`badge ${getRouteBadgeClass(schedule.route)}`}>
                            {getRouteLabel(schedule.route)}
                          </span>
                        </td>
                        <td><strong>{schedule.departureTime}</strong></td>
                        <td><strong>{schedule.maxSeats}</strong></td>
                        <td>{new Date(schedule.createdAt).toLocaleString('uk-UA')}</td>
                        <td>{new Date(schedule.updatedAt).toLocaleString('uk-UA')}</td>
                        <td>
                          <Button
                            variant="secondary"
                            onClick={() => openScheduleModal(schedule)}
                            style={{ marginRight: '8px' }}
                          >
                            Редагувати
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => handleDeleteSchedule(schedule.id)}
                          >
                            Видалити
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Модальне вікно для графіку */}
        {isScheduleModalOpen && (
          <div className="modal" onClick={(e) => e.target === e.currentTarget && setIsScheduleModalOpen(false)}>
            <div className="modal-content">
              <div className="modal-header">
                <h2>{editingSchedule ? 'Редагувати рейс' : 'Додати рейс'}</h2>
                <button className="close-btn" onClick={() => setIsScheduleModalOpen(false)}>
                  &times;
                </button>
              </div>
              <form onSubmit={handleSaveSchedule}>
                <Select
                  label="Маршрут *"
                  options={routeOptions}
                  value={scheduleForm.route}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, route: e.target.value as Route })}
                  required
                />
                <Input
                  label="Час відправлення * (формат HH:MM)"
                  type="text"
                  placeholder="08:00"
                  value={scheduleForm.departureTime}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, departureTime: e.target.value })}
                  pattern="^([0-1][0-9]|2[0-3]):[0-5][0-9]$"
                  required
                />
                <Input
                  label="Максимальна кількість місць *"
                  type="number"
                  min={1}
                  max={100}
                  value={scheduleForm.maxSeats}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, maxSeats: Number(e.target.value) })}
                  required
                />
                <div className="form-actions">
                  <Button type="button" variant="secondary" onClick={() => setIsScheduleModalOpen(false)}>
                    Скасувати
                  </Button>
                  <Button type="submit">Зберегти</Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
