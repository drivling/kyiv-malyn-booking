import React, { useState, useEffect } from 'react';
import { apiClient } from '@/api/client';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Alert } from '@/components/Alert';
import type { Booking, Schedule, Route, ScheduleFormData, ViberListing, ViberListingType } from '@/types';
import { getRouteLabel, getRouteBadgeClass, ROUTES } from '@/utils/constants';
import './AdminPage.css';

type Tab = 'bookings' | 'schedules' | 'viber';

export const AdminPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('bookings');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [viberListings, setViberListings] = useState<ViberListing[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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

  // Viber listings
  const [isViberModalOpen, setIsViberModalOpen] = useState(false);
  const [viberMessage, setViberMessage] = useState('');
  const [viberActiveFilter, setViberActiveFilter] = useState(true);
  const [viberRouteFilter, setViberRouteFilter] = useState('');
  const [viberDateFilter, setViberDateFilter] = useState('');
  const [viberTypeFilter, setViberTypeFilter] = useState<'driver' | 'passenger' | ''>('');
  const [viberSearchQuery, setViberSearchQuery] = useState('');
  const [migratePersonLoading, setMigratePersonLoading] = useState(false);
  const [editingViberListing, setEditingViberListing] = useState<ViberListing | null>(null);
  const [viberEditForm, setViberEditForm] = useState({
    rawMessage: '',
    senderName: '',
    listingType: 'driver' as ViberListingType,
    route: '',
    date: '',
    departureTime: '',
    seats: '',
    phone: '',
    notes: '',
    isActive: true,
  });

  useEffect(() => {
    if (activeTab === 'bookings') {
      loadBookings();
    } else if (activeTab === 'schedules') {
      loadSchedules();
    } else if (activeTab === 'viber') {
      loadViberListings();
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

  const loadViberListings = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiClient.getViberListings(); // завантажуємо всі, фільтрація клієнтська
      setViberListings(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження');
    } finally {
      setLoading(false);
    }
  };

  const filteredViberListings = viberListings.filter((listing) => {
    if (viberActiveFilter && !listing.isActive) return false;
    if (viberRouteFilter && !listing.route.toLowerCase().includes(viberRouteFilter.toLowerCase())) return false;
    if (viberDateFilter) {
      const listingDate = listing.date.slice(0, 10);
      if (listingDate !== viberDateFilter) return false;
    }
    if (viberTypeFilter && listing.listingType !== viberTypeFilter) return false;
    if (viberSearchQuery) {
      const searchIn = `${listing.phone} ${listing.senderName ?? ''} ${listing.notes ?? ''} ${listing.rawMessage}`.toLowerCase();
      if (!searchIn.includes(viberSearchQuery.toLowerCase())) return false;
    }
    return true;
  });

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

  const handleCreateViberListing = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      // Перевіряємо чи це багато повідомлень (містить декілька заголовків)
      const messageCount = (viberMessage.match(/\[.*?\]/g) || []).length;
      
      if (messageCount > 1) {
        // Масове створення
        const result = await apiClient.createViberListingsBulk(viberMessage);
        setSuccess(`✅ Створено ${result.created} оголошень з ${result.total}`);
      } else {
        // Одне повідомлення
        await apiClient.createViberListing({ rawMessage: viberMessage });
        setSuccess('✅ Оголошення створено!');
      }
      
      setViberMessage('');
      setIsViberModalOpen(false);
      loadViberListings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка створення');
    }
  };

  const handleDeleteViberListing = async (id: number) => {
    if (!confirm('Ви впевнені, що хочете видалити це оголошення?')) return;
    try {
      await apiClient.deleteViberListing(id);
      loadViberListings();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Помилка видалення');
    }
  };

  const handleDeactivateViberListing = async (id: number) => {
    try {
      await apiClient.deactivateViberListing(id);
      loadViberListings();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Помилка деактивації');
    }
  };

  const openEditViberListing = (listing: ViberListing) => {
    const dateStr = listing.date.slice(0, 10);
    setViberEditForm({
      rawMessage: listing.rawMessage,
      senderName: listing.senderName ?? '',
      listingType: listing.listingType,
      route: listing.route,
      date: dateStr,
      departureTime: listing.departureTime ?? '',
      seats: listing.seats != null ? String(listing.seats) : '',
      phone: listing.phone,
      notes: listing.notes ?? '',
      isActive: listing.isActive,
    });
    setEditingViberListing(listing);
  };

  const handleUpdateViberListing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingViberListing) return;
    setError('');
    setSuccess('');
    try {
      await apiClient.updateViberListing(editingViberListing.id, {
        rawMessage: viberEditForm.rawMessage,
        senderName: viberEditForm.senderName || null,
        listingType: viberEditForm.listingType,
        route: viberEditForm.route,
        date: viberEditForm.date,
        departureTime: viberEditForm.departureTime || null,
        seats: viberEditForm.seats ? parseInt(viberEditForm.seats, 10) : null,
        phone: viberEditForm.phone,
        notes: viberEditForm.notes || null,
        isActive: viberEditForm.isActive,
      });
      setSuccess('✅ Оголошення оновлено!');
      setEditingViberListing(null);
      loadViberListings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка оновлення');
    }
  };

  const handleCleanupOldViberListings = async () => {
    if (!confirm('Деактивувати всі старі оголошення?')) return;
    setError('');
    setSuccess('');
    try {
      const result = await apiClient.cleanupOldViberListings();
      setSuccess(result.message);
      loadViberListings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка очищення');
    }
  };

  const stats = {
    total: filteredBookings.length,
    kyivMalyn: filteredBookings.filter((b) => b.route.includes('Kyiv-Malyn')).length,
    malynKyiv: filteredBookings.filter((b) => b.route.includes('Malyn-Kyiv')).length,
    malynZhytomyr: filteredBookings.filter((b) => b.route.includes('Malyn-Zhytomyr')).length,
    zhytomyrMalyn: filteredBookings.filter((b) => b.route.includes('Zhytomyr-Malyn')).length,
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
          <button
            className={`tab ${activeTab === 'viber' ? 'active' : ''}`}
            onClick={() => setActiveTab('viber')}
          >
            📱 Viber Оголошення
          </button>
        </div>

        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        <div className="admin-utility" style={{ marginBottom: '1rem', padding: '0.75rem', background: '#f8f9fa', borderRadius: 8 }}>
          <strong>Службові дії:</strong>{' '}
          <Button
            type="button"
            variant="secondary"
            disabled={migratePersonLoading}
            onClick={async () => {
              setMigratePersonLoading(true);
              setError('');
              setSuccess('');
              try {
                const r = await apiClient.runMigrateToPerson();
                if (r.ok) {
                  setSuccess(
                    `Person: ${r.personCount}, Booking з personId: ${r.bookingsWithPerson}, ViberListing: ${r.listingsWithPerson} (БД: ${r.dbHost})`
                  );
                } else {
                  setError(r.error || 'Помилка міграції');
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Помилка');
              } finally {
                setMigratePersonLoading(false);
              }
            }}
          >
            {migratePersonLoading ? 'Виконую…' : 'Запустити міграцію Person'}
          </Button>
        </div>

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
                <h3>Малин → Житомир</h3>
                <div className="stat-value">{stats.malynZhytomyr}</div>
              </div>
              <div className="stat-card">
                <h3>Житомир → Малин</h3>
                <div className="stat-value">{stats.zhytomyrMalyn}</div>
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

        {/* Viber оголошення */}
        {activeTab === 'viber' && (
          <div className="tab-content">
            <div className="stats">
              <div className="stat-card">
                <h3>Всього (за фільтром)</h3>
                <div className="stat-value">{filteredViberListings.length}</div>
              </div>
              <div className="stat-card">
                <h3>Активні</h3>
                <div className="stat-value">{filteredViberListings.filter((l) => l.isActive).length}</div>
              </div>
              <div className="stat-card">
                <h3>🚗 Водії</h3>
                <div className="stat-value">{filteredViberListings.filter((l) => l.listingType === 'driver').length}</div>
              </div>
              <div className="stat-card">
                <h3>👤 Пасажири</h3>
                <div className="stat-value">{filteredViberListings.filter((l) => l.listingType === 'passenger').length}</div>
              </div>
            </div>

            <div className="controls">
              <Select
                options={[
                  { value: '', label: 'Всі типи' },
                  { value: 'driver', label: '🚗 Водій' },
                  { value: 'passenger', label: '👤 Пасажир' },
                ]}
                value={viberTypeFilter}
                onChange={(e) => setViberTypeFilter(e.target.value as 'driver' | 'passenger' | '')}
              />
              <input
                type="text"
                placeholder="Маршрут..."
                value={viberRouteFilter}
                onChange={(e) => setViberRouteFilter(e.target.value)}
                className="control-input"
              />
              <input
                type="date"
                value={viberDateFilter}
                onChange={(e) => setViberDateFilter(e.target.value)}
                className="control-input"
              />
              <input
                type="text"
                placeholder="Пошук по телефону, імені..."
                value={viberSearchQuery}
                onChange={(e) => setViberSearchQuery(e.target.value)}
                className="control-input"
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={viberActiveFilter}
                  onChange={(e) => setViberActiveFilter(e.target.checked)}
                />
                <span>Тільки активні</span>
              </label>
              <Button onClick={loadViberListings}>🔄 Оновити</Button>
              <Button onClick={() => setIsViberModalOpen(true)}>➕ Додати оголошення</Button>
              <Button variant="secondary" onClick={handleCleanupOldViberListings}>
                🧹 Очистити старі
              </Button>
              <Button variant="secondary" onClick={() => {
                setViberRouteFilter('');
                setViberDateFilter('');
                setViberTypeFilter('');
                setViberSearchQuery('');
              }}>
                Очистити фільтри
              </Button>
            </div>

            {loading ? (
              <div className="loading">Завантаження...</div>
            ) : filteredViberListings.length === 0 ? (
              <div className="empty">📭 Немає оголошень</div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Тип</th>
                      <th>Маршрут</th>
                      <th>Дата</th>
                      <th>Час</th>
                      <th>Місця</th>
                      <th>Телефон</th>
                      <th>Відправник</th>
                      <th>Статус</th>
                      <th>Дії</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredViberListings.map((listing) => (
                      <tr key={listing.id} style={{ opacity: listing.isActive ? 1 : 0.5 }}>
                        <td>#{listing.id}</td>
                        <td>
                          <span className={`badge ${listing.listingType === 'driver' ? 'badge-success' : 'badge-info'}`}>
                            {listing.listingType === 'driver' ? '🚗 Водій' : '👤 Пасажир'}
                          </span>
                        </td>
                        <td>{listing.route}</td>
                        <td>{new Date(listing.date).toLocaleDateString('uk-UA')}</td>
                        <td>{listing.departureTime || '-'}</td>
                        <td>{listing.seats || '-'}</td>
                        <td><strong>{listing.phone}</strong></td>
                        <td>{listing.senderName || '-'}</td>
                        <td>
                          <span className={`badge ${listing.isActive ? 'badge-success' : 'badge-secondary'}`}>
                            {listing.isActive ? 'Активне' : 'Неактивне'}
                          </span>
                        </td>
                        <td>
                          <Button
                            variant="secondary"
                            onClick={() => openEditViberListing(listing)}
                            style={{ marginRight: '8px' }}
                          >
                            ✏️ Редагувати
                          </Button>
                          {listing.isActive && (
                            <Button
                              variant="secondary"
                              onClick={() => handleDeactivateViberListing(listing.id)}
                              style={{ marginRight: '8px' }}
                            >
                              Деактивувати
                            </Button>
                          )}
                          <Button
                            variant="danger"
                            onClick={() => handleDeleteViberListing(listing.id)}
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

        {/* Модальне вікно для Viber оголошення */}
        {isViberModalOpen && (
          <div className="modal" onClick={(e) => e.target === e.currentTarget && setIsViberModalOpen(false)}>
            <div className="modal-content">
              <div className="modal-header">
                <h2>Додати Viber оголошення</h2>
                <button className="close-btn" onClick={() => setIsViberModalOpen(false)}>
                  &times;
                </button>
              </div>
              <form onSubmit={handleCreateViberListing}>
                <div style={{ marginBottom: '16px' }}>
                  <label htmlFor="viberMessage" style={{ display: 'block', marginBottom: '8px', fontWeight: 500 }}>
                    Повідомлення з Viber чату *
                  </label>
                  <textarea
                    id="viberMessage"
                    value={viberMessage}
                    onChange={(e) => setViberMessage(e.target.value)}
                    placeholder={'Приклад:\n[ 9 лютого 2026 р. 12:55 ] ⁨Ковальчук Інна⁩: 2 пасажира\nСьогодні (9.02) \nКиїв(академ)-Малин\n18:00-18:30\n0730392680'}
                    rows={10}
                    required
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '1px solid #ddd',
                      borderRadius: '4px',
                      fontFamily: 'monospace',
                      fontSize: '14px'
                    }}
                  />
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                    💡 Підказка: Можна вставити одразу декілька повідомлень - вони будуть створені автоматично
                  </div>
                </div>
                <div className="form-actions">
                  <Button type="button" variant="secondary" onClick={() => setIsViberModalOpen(false)}>
                    Скасувати
                  </Button>
                  <Button type="submit">Створити</Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Модальне вікно редагування Viber оголошення */}
        {editingViberListing && (
          <div className="modal" onClick={(e) => e.target === e.currentTarget && setEditingViberListing(null)}>
            <div className="modal-content">
              <div className="modal-header">
                <h2>Редагувати Viber оголошення #{editingViberListing.id}</h2>
                <button className="close-btn" onClick={() => setEditingViberListing(null)}>
                  &times;
                </button>
              </div>
              <form onSubmit={handleUpdateViberListing}>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Повідомлення (raw)</label>
                  <textarea
                    value={viberEditForm.rawMessage}
                    onChange={(e) => setViberEditForm((f) => ({ ...f, rawMessage: e.target.value }))}
                    rows={3}
                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <Input
                    label="Відправник"
                    value={viberEditForm.senderName}
                    onChange={(e) => setViberEditForm((f) => ({ ...f, senderName: e.target.value }))}
                  />
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Тип</label>
                    <Select
                      value={viberEditForm.listingType}
                      onChange={(e) => setViberEditForm((f) => ({ ...f, listingType: e.target.value as ViberListingType }))}
                      options={[
                        { value: 'driver', label: '🚗 Водій' },
                        { value: 'passenger', label: '👤 Пасажир' },
                      ]}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <Input
                    label="Маршрут"
                    value={viberEditForm.route}
                    onChange={(e) => setViberEditForm((f) => ({ ...f, route: e.target.value }))}
                  />
                  <div>
                    <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Дата поїздки</label>
                    <input
                      type="date"
                      value={viberEditForm.date}
                      onChange={(e) => setViberEditForm((f) => ({ ...f, date: e.target.value }))}
                      required
                      style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <Input
                    label="Час відправлення"
                    value={viberEditForm.departureTime}
                    onChange={(e) => setViberEditForm((f) => ({ ...f, departureTime: e.target.value }))}
                    placeholder="напр. 18:00 або 18:00-18:30"
                  />
                  <Input
                    label="Місця"
                    type="number"
                    value={viberEditForm.seats}
                    onChange={(e) => setViberEditForm((f) => ({ ...f, seats: e.target.value }))}
                    placeholder="—"
                  />
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <Input
                    label="Телефон *"
                    value={viberEditForm.phone}
                    onChange={(e) => setViberEditForm((f) => ({ ...f, phone: e.target.value }))}
                    required
                  />
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>Примітки</label>
                  <textarea
                    value={viberEditForm.notes}
                    onChange={(e) => setViberEditForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    style={{ width: '100%', padding: '8px', border: '1px solid #ddd', borderRadius: '4px' }}
                  />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <input
                    type="checkbox"
                    checked={viberEditForm.isActive}
                    onChange={(e) => setViberEditForm((f) => ({ ...f, isActive: e.target.checked }))}
                  />
                  <span>Активне оголошення</span>
                </label>
                <div className="form-actions">
                  <Button type="button" variant="secondary" onClick={() => setEditingViberListing(null)}>
                    Скасувати
                  </Button>
                  <Button type="submit">Зберегти</Button>
                </div>
              </form>
            </div>
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
