import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { userState } from '@/utils/userState';
import { isTelegramLoginRejected } from '@/utils/telegramLogin';
import { Alert } from '@/components/Alert';
import type { UserProfile, ViberListing, Booking, TelegramScenariosResponse } from '@/types';
import { formatPhoneDisplay } from '@/utils/constants';
import './UserPage.css';

const TELEGRAM_BOT_USERNAME = import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'malin_kiev_ua_bot';
const DEFAULT_SCENARIOS: TelegramScenariosResponse = {
  enabled: true,
  scenarios: {
    driver: { title: 'Нова попутка', command: '/adddriverride', deepLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=driver` },
    passenger: { title: 'Новий запит', command: '/addpassengerride', deepLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=passenger` },
    view: { title: 'Перегляд', command: '/poputky', deepLink: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=view`, webLink: '' },
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
  return parsed.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
};

export const UserPage: React.FC = () => {
  const telegramUser = userState.getTelegramUser();
  const telegramUserId = telegramUser?.id?.toString() ?? '';
  const isTelegramUser = userState.isTelegramUser() && !!telegramUserId;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scenarios, setScenarios] = useState<TelegramScenariosResponse>(DEFAULT_SCENARIOS);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [editListing, setEditListing] = useState<ViberListing | null>(null);
  const [editForm, setEditForm] = useState({ route: '', date: '', departureTime: '', seats: '', notes: '', priceUah: '' });
  const [savingListing, setSavingListing] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<number | null>(null);
  /** 401 від /user/*: підпис Telegram Login прострочений або його нема — треба увійти ще раз */
  const [authStale, setAuthStale] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleteStep, setDeleteStep] = useState<'idle' | 'confirm' | 'deleting' | 'done'>('idle');
  const [deleteSummary, setDeleteSummary] = useState('');

  useEffect(() => {
    if (!isTelegramUser) return;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [data, scenarioData] = await Promise.all([
          apiClient.getUserProfile(),
          apiClient.getTelegramScenarios().catch(() => null),
        ]);
        setProfile(data);
        if (data.person?.fullName) setNameValue(data.person.fullName);
        else if (telegramUser?.first_name) setNameValue(telegramUser.first_name);
        if (scenarioData?.scenarios?.driver?.deepLink && scenarioData?.scenarios?.passenger?.deepLink) {
          setScenarios(scenarioData);
        }
      } catch (e) {
        if (isTelegramLoginRejected(e)) setAuthStale(true);
        else setError(e instanceof Error ? e.message : 'Не вдалося завантажити профіль');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isTelegramUser, telegramUserId, telegramUser?.first_name]);

  const displayName = profile?.person?.fullName?.trim() || telegramUser?.first_name || 'Користувач';

  const handleSaveName = async () => {
    if (!telegramUserId) return;
    setSavingName(true);
    try {
      await apiClient.updateProfileName(nameValue.trim() || null);
      setProfile((prev) =>
        prev && prev.person ? { ...prev, person: { ...prev.person, fullName: nameValue.trim() || null } } : prev
      );
      setEditingName(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося зберегти ім\'я');
    } finally {
      setSavingName(false);
    }
  };

  const handleCancelBooking = async (booking: Booking) => {
    if (!telegramUserId) return;
    setCancellingId(booking.id);
    try {
      await apiClient.cancelBookingByUser(booking.id, telegramUserId);
      setProfile((prev) =>
        prev ? { ...prev, bookings: prev.bookings.filter((b) => b.id !== booking.id) } : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося скасувати бронювання');
    } finally {
      setCancellingId(null);
    }
  };

  const openEditListing = (listing: ViberListing) => {
    setEditListing(listing);
    setEditForm({
      route: listing.route,
      date: listing.date.slice(0, 10),
      departureTime: listing.departureTime || '',
      seats: listing.seats != null ? String(listing.seats) : '',
      notes: listing.notes || '',
      priceUah: listing.priceUah != null ? String(listing.priceUah) : '',
    });
  };

  const handleSaveListing = async () => {
    if (!editListing || !telegramUserId) return;
    setSavingListing(true);
    try {
      const payload: Partial<ViberListing> = {
        route: editForm.route.trim() || editListing.route,
        date: editForm.date || editListing.date.slice(0, 10),
        departureTime: editForm.departureTime.trim() || null,
        seats: editForm.seats ? parseInt(editForm.seats, 10) : null,
        notes: editForm.notes.trim() || null,
        priceUah: editForm.priceUah ? parseInt(editForm.priceUah, 10) : null,
      };
      const updated = await apiClient.updateViberListingByUser(editListing.id, telegramUserId, payload);
      setProfile((prev) => {
        if (!prev) return prev;
        const replace = (list: ViberListing[]) =>
          list.map((l) => (l.id === updated.id ? updated : l));
        return {
          ...prev,
          passengerListings: replace(prev.passengerListings),
          driverListings: replace(prev.driverListings),
        };
      });
      setEditListing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося зберегти зміни');
    } finally {
      setSavingListing(false);
    }
  };

  /** «Завантажити мої дані» — файл з бекенду через тимчасове посилання (Blob) */
  const handleExport = async () => {
    setExporting(true);
    setError('');
    try {
      const { blob, filename } = await apiClient.exportUserData();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      if (isTelegramLoginRejected(e)) setAuthStale(true);
      else setError(e instanceof Error ? e.message : 'Не вдалося завантажити дані');
    } finally {
      setExporting(false);
    }
  };

  /** «Видалити акаунт» після підтвердження: бекенд знеособлює, сесія на пристрої завершується */
  const handleDelete = async () => {
    setDeleteStep('deleting');
    setError('');
    try {
      const result = await apiClient.deleteUserAccount();
      setDeleteSummary(result.summary);
      userState.logout();
      setDeleteStep('done');
    } catch (e) {
      setDeleteStep('confirm');
      if (isTelegramLoginRejected(e)) setAuthStale(true);
      else setError(e instanceof Error ? e.message : 'Не вдалося видалити акаунт');
    }
  };

  const handleDeactivateListing = async (listing: ViberListing) => {
    if (!telegramUserId) return;
    setDeactivatingId(listing.id);
    try {
      await apiClient.deactivateViberListingByUser(listing.id, telegramUserId);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              passengerListings: prev.passengerListings.filter((l) => l.id !== listing.id),
              driverListings: prev.driverListings.filter((l) => l.id !== listing.id),
            }
          : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося скасувати оголошення');
    } finally {
      setDeactivatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="user-page">
        <div className="user-page-inner">
          <div className="user-page-loading">Завантаження профілю...</div>
        </div>
      </div>
    );
  }

  if (deleteStep === 'done') {
    return (
      <div className="user-page">
        <div className="user-page-inner">
          <section className="user-section user-section--data" aria-labelledby="user-deleted-title">
            <h2 id="user-deleted-title" className="user-section-title">Акаунт видалено</h2>
            <p className="user-data-text">
              Ваше ім'я, телефон і Telegram прибрано з бази{deleteSummary ? `: ${deleteSummary}` : ''}. Бот більше не
              писатиме вам. Якщо захочете повернутися — увійдіть знову і поділіться номером у боті.
            </p>
            <div className="user-section-cta">
              <Link to="/" className="user-btn user-btn-primary">На головну</Link>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (authStale) {
    return (
      <div className="user-page">
        <div className="user-page-inner">
          <div className="alert-wrapper">
            <Alert variant="error">
              Сесія входу через Telegram застаріла або не підтверджена — увійдіть ще раз, щоб бачити профіль,
              завантажити чи видалити свої дані. <Link to="/login">Увійти через Telegram</Link>
            </Alert>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="user-page">
      <div className="user-page-inner">
        {error && (
          <div className="alert-wrapper">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        <div className="user-dashboard-grid">
        {/* Профіль: обкладинка + аватар + ім'я + дані */}
        <header className="user-page-header">
          <div className="user-page-cover" aria-hidden />
          <div className="user-page-profile-block">
            <div className="user-page-avatar-wrap">
              <div className="user-avatar">
                {displayName ? displayName.charAt(0).toUpperCase() : '?'}
              </div>
              <div className="user-page-name-wrap">
                <h1 className="user-page-title">{displayName}</h1>
              </div>
            </div>
            <div className="user-profile-row">
              <div className="user-profile-fields">
              <div className="user-field">
                <span className="user-field-label">Ім'я</span>
                {editingName ? (
                  <div className="user-field-edit">
                    <input
                      type="text"
                      value={nameValue}
                      onChange={(e) => setNameValue(e.target.value)}
                      className="user-input"
                      placeholder="Введіть ім'я"
                    />
                    <button type="button" className="user-btn user-btn-sm" onClick={handleSaveName} disabled={savingName}>
                      {savingName ? 'Збереження...' : 'Зберегти'}
                    </button>
                    <button type="button" className="user-btn user-btn-sm user-btn-ghost" onClick={() => { setEditingName(false); setNameValue(displayName); }}>
                      Скасувати
                    </button>
                  </div>
                ) : (
                  <span className="user-field-value">
                    {displayName}
                    <button type="button" className="user-edit-inline" onClick={() => setEditingName(true)} aria-label="Змінити ім'я">Змінити</button>
                  </span>
                )}
              </div>
              {profile?.person?.phoneNormalized && (
                <div className="user-field">
                  <span className="user-field-label">Телефон</span>
                  <span className="user-field-value">{formatPhoneDisplay(profile.person.phoneNormalized)}</span>
                </div>
              )}
              <div className="user-field">
                <span className="user-field-label">Telegram</span>
                <span className="user-field-value">
                  {profile?.person?.telegramUserId ? (
                    <span className="user-telegram-badge">Підключено</span>
                  ) : (
                    <span className="user-telegram-badge user-telegram-badge--no">Не підключено</span>
                  )}
                </span>
              </div>
              </div>
            </div>
          </div>
        </header>

        {/* Мої бронювання маршруток */}
        <section className="user-section">
          <div className="user-section-head">
            <h2 className="user-section-title">Мої поточні бронювання</h2>
            <span className="user-section-count">{profile?.bookings?.length ?? 0}</span>
          </div>
          {profile?.bookings && profile.bookings.length > 0 ? (
            <ul className="user-list">
              {profile.bookings.map((b) => (
                <li key={b.id} className="user-card">
                  <div className="user-card-main">
                    <span className="user-card-route">{formatRouteLabel(b.route)}</span>
                    <span className="user-card-meta">{formatTripDate(b.date)}{b.departureTime ? `, ${b.departureTime}` : ''}</span>
                    <span className="user-card-meta">Місць: {b.seats}</span>
                  </div>
                  <div className="user-card-actions">
                    <button
                      type="button"
                      className="user-btn user-btn-sm user-btn-danger"
                      onClick={() => handleCancelBooking(b)}
                      disabled={cancellingId === b.id}
                    >
                      {cancellingId === b.id ? 'Скасування...' : 'Скасувати'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="user-empty">Немає поточних бронювань</p>
          )}
          <div className="user-section-cta">
            <Link to="/mizhgorodski" className="user-btn user-btn-primary user-btn-new">
              Нове бронювання
            </Link>
          </div>
        </section>

        {/* Як пасажир */}
        <section className="user-section">
          <div className="user-section-head">
            <h2 className="user-section-title">Як пасажир</h2>
            <span className="user-section-count">{profile?.passengerListings?.length ?? 0}</span>
          </div>
          {profile?.passengerListings && profile.passengerListings.length > 0 ? (
            <ul className="user-list">
              {profile.passengerListings.map((l) => (
                <li key={l.id} className="user-card">
                  <div className="user-card-main">
                    <span className="user-card-route">{formatRouteLabel(l.route)}</span>
                    <span className="user-card-meta">{formatTripDate(l.date)}{l.departureTime ? `, ${l.departureTime}` : ''}</span>
                    {l.seats != null && <span className="user-card-meta">Місць: {l.seats}</span>}
                  </div>
                  <div className="user-card-actions">
                    <button type="button" className="user-btn user-btn-sm" onClick={() => openEditListing(l)}>Редагувати</button>
                    <button
                      type="button"
                      className="user-btn user-btn-sm user-btn-danger"
                      onClick={() => handleDeactivateListing(l)}
                      disabled={deactivatingId === l.id}
                    >
                      {deactivatingId === l.id ? 'Скасування...' : 'Скасувати'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="user-empty">Немає поточних планів як пасажир</p>
          )}
          <div className="user-section-cta">
            <a
              href={scenarios.scenarios.passenger.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="user-btn user-btn-primary user-btn-new"
            >
              Новий запит
            </a>
          </div>
        </section>

        {/* Як водій */}
        <section className="user-section">
          <div className="user-section-head">
            <h2 className="user-section-title">Як водій</h2>
            <span className="user-section-count">{profile?.driverListings?.length ?? 0}</span>
          </div>
          {profile?.driverListings && profile.driverListings.length > 0 ? (
            <ul className="user-list">
              {profile.driverListings.map((l) => (
                <li key={l.id} className="user-card">
                  <div className="user-card-main">
                    <span className="user-card-route">{formatRouteLabel(l.route)}</span>
                    <span className="user-card-meta">{formatTripDate(l.date)}{l.departureTime ? `, ${l.departureTime}` : ''}</span>
                    {l.seats != null && <span className="user-card-meta">Місць: {l.seats}</span>}
                    {l.priceUah != null && <span className="user-card-meta">Ціна: {l.priceUah} грн</span>}
                  </div>
                  <div className="user-card-actions">
                    <button type="button" className="user-btn user-btn-sm" onClick={() => openEditListing(l)}>Редагувати</button>
                    <button
                      type="button"
                      className="user-btn user-btn-sm user-btn-danger"
                      onClick={() => handleDeactivateListing(l)}
                      disabled={deactivatingId === l.id}
                    >
                      {deactivatingId === l.id ? 'Скасування...' : 'Скасувати'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="user-empty">Немає поточних планів як водій</p>
          )}
          <div className="user-section-cta">
            <a
              href={scenarios.scenarios.driver.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="user-btn user-btn-primary user-btn-new"
            >
              Нова попутка
            </a>
          </div>
        </section>

        {/* «Дані належать людині» (Docs/transport-open-data-2026-10.md, фаза 4): забрати все файлом або видалити.
            Те саме в боті — /mydata і /deleteme. Політика конфіденційності на /about пояснює, що саме стирається. */}
        <section className="user-section user-section--data" aria-labelledby="user-data-title">
          <div className="user-section-head">
            <h2 id="user-data-title" className="user-section-title">Мої дані</h2>
          </div>
          <p className="user-data-text">
            Усе, що сайт і бот знають про вас, можна забрати одним файлом (JSON) або видалити. Так само в боті:
            команди /mydata і /deleteme. Що саме зберігається і що стирається — у{' '}
            <a href="/about#privacy-policy">політиці конфіденційності</a>.
          </p>
          <div className="user-data-actions">
            <button type="button" className="user-btn user-btn-primary" onClick={handleExport} disabled={exporting}>
              {exporting ? 'Готуємо файл...' : 'Завантажити мої дані'}
            </button>
            {deleteStep === 'idle' && (
              <button type="button" className="user-btn user-btn-danger" onClick={() => setDeleteStep('confirm')}>
                Видалити акаунт
              </button>
            )}
          </div>
          {(deleteStep === 'confirm' || deleteStep === 'deleting') && (
            <div className="user-data-confirm" role="group" aria-labelledby="user-delete-title">
              <h3 id="user-delete-title" className="user-data-confirm-title">Видалити акаунт?</h3>
              <p className="user-data-text">
                Ми приберемо ваше ім'я, телефон і Telegram з бази: майбутні бронювання скасуємо, оголошення попуток
                знімемо, минулі поїздки лишаться знеособленими для статистики, нарахування «Приведи друга» — в обліку.
                Бот перестане вам писати. Повернутися можна буде заново через бот. Спершу можете забрати свої дані
                файлом.
              </p>
              <div className="user-data-actions">
                <button type="button" className="user-btn user-btn-danger" onClick={handleDelete} disabled={deleteStep === 'deleting'}>
                  {deleteStep === 'deleting' ? 'Видаляємо...' : 'Так, видалити акаунт'}
                </button>
                <button type="button" className="user-btn user-btn-ghost" onClick={() => setDeleteStep('idle')} disabled={deleteStep === 'deleting'}>
                  Ні, залишити
                </button>
              </div>
            </div>
          )}
        </section>
        </div>
      </div>

      {/* Модалка редагування оголошення */}
      {editListing && (
        <div className="user-modal-overlay" onClick={() => !savingListing && setEditListing(null)}>
          <div className="user-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="user-modal-title">Редагувати оголошення</h3>
            <div className="user-modal-form">
              <label className="user-form-label">
                Маршрут
                <input
                  type="text"
                  value={editForm.route}
                  onChange={(e) => setEditForm((f) => ({ ...f, route: e.target.value }))}
                  className="user-input"
                  placeholder="наприклад Kyiv-Malyn"
                />
              </label>
              <label className="user-form-label">
                Дата
                <input
                  type="date"
                  value={editForm.date}
                  onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                  className="user-input"
                />
              </label>
              <label className="user-form-label">
                Час
                <input
                  type="text"
                  value={editForm.departureTime}
                  onChange={(e) => setEditForm((f) => ({ ...f, departureTime: e.target.value }))}
                  className="user-input"
                  placeholder="наприклад 18:00 або 18:00-18:30"
                />
              </label>
              <label className="user-form-label">
                Місць
                <input
                  type="number"
                  min={0}
                  value={editForm.seats}
                  onChange={(e) => setEditForm((f) => ({ ...f, seats: e.target.value }))}
                  className="user-input"
                />
              </label>
              <label className="user-form-label">
                Примітки
                <input
                  type="text"
                  value={editForm.notes}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                  className="user-input"
                />
              </label>
              <label className="user-form-label">
                Ціна (грн)
                <input
                  type="number"
                  min={0}
                  value={editForm.priceUah}
                  onChange={(e) => setEditForm((f) => ({ ...f, priceUah: e.target.value }))}
                  className="user-input"
                />
              </label>
            </div>
            <div className="user-modal-actions">
              <button type="button" className="user-btn user-btn-primary" onClick={handleSaveListing} disabled={savingListing}>
                {savingListing ? 'Збереження...' : 'Зберегти'}
              </button>
              <button type="button" className="user-btn user-btn-ghost" onClick={() => setEditListing(null)} disabled={savingListing}>
                Закрити
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
