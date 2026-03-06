import React, { useState, useEffect } from 'react';
import { apiClient } from '@/api/client';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Alert } from '@/components/Alert';
import type { Booking, Schedule, Route, ScheduleFormData, ViberListing, ViberListingType, PersonWithCounts, ViberClientBehavior, ViberAnalyticsPromoScenariosResponse, BehaviorPromoScenarioKey, RefreshPersonNamesResponse } from '@/types';
import { getRouteLabel, getRouteBadgeClass, getBookingRouteDisplayLabel, ROUTES, formatPhoneDisplay } from '@/utils/constants';
import './AdminPage.css';

type Tab = 'bookings' | 'schedules' | 'viber' | 'promo' | 'data';

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
    supportPhone: '',
  });

  // Viber listings
  const [isViberModalOpen, setIsViberModalOpen] = useState(false);
  const [viberMessage, setViberMessage] = useState('');
  const [viberActiveFilter, setViberActiveFilter] = useState(true);
  const [viberRouteFilter, setViberRouteFilter] = useState('');
  const [viberDateFilter, setViberDateFilter] = useState('');
  const [viberTypeFilter, setViberTypeFilter] = useState<'driver' | 'passenger' | ''>('');
  const [viberSearchQuery, setViberSearchQuery] = useState('');
  const [viberNoPhoneFilter, setViberNoPhoneFilter] = useState(false);
  const [viberNoDepartureTimeFilter, setViberNoDepartureTimeFilter] = useState(false);
  const [viberSortBy, setViberSortBy] = useState<'id' | 'date'>('id');
  const [viberSortOrder, setViberSortOrder] = useState<'asc' | 'desc'>('desc');
  const [editingViberListing, setEditingViberListing] = useState<ViberListing | null>(null);
  // Реклама каналу: база = без Telegram бота; вибір = усі / до кого не комунікували / не знайдено в Telegram
  type PromoFilter = 'no_telegram' | 'no_communication' | 'promo_not_found';
  const [promoFilter, setPromoFilter] = useState<PromoFilter>('no_communication');
  const [promoPersons, setPromoPersons] = useState<Array<{ id: number; phoneNormalized: string; fullName: string | null }>>([]);
  const [promoResults, setPromoResults] = useState<{
    sent: Array<{ phone: string; fullName: string | null }>;
    notFound: Array<{ phone: string; fullName: string | null }>;
  } | null>(null);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState('');
  const [promoContactPhone, setPromoContactPhone] = useState('+380931701835');
  const [promoContactName, setPromoContactName] = useState('Петро Коваленко');
  const [promoContactSaving, setPromoContactSaving] = useState(false);
  const [promoContactSuccess, setPromoContactSuccess] = useState('');
  // Нагадування для клієнтів з Telegram ботом
  type TelegramReminderFilter = 'all' | 'no_active_viber' | 'no_reminder_7_days';
  const [telegramReminderFilter, setTelegramReminderFilter] = useState<TelegramReminderFilter>('all');
  const [telegramReminderPersons, setTelegramReminderPersons] = useState<
    Array<{ id: number; phoneNormalized: string; fullName: string | null; telegramReminderSentAt: string | null }>
  >([]);
  const [telegramReminderLoading, setTelegramReminderLoading] = useState(false);
  const [telegramReminderError, setTelegramReminderError] = useState('');
  const [telegramReminderSummary, setTelegramReminderSummary] = useState('');
  const [telegramReminderResults, setTelegramReminderResults] = useState<{
    sent: number;
    failed: number;
    total: number;
    message: string;
    blocked: Array<{ id: number; phoneNormalized: string; fullName: string | null }>;
  } | null>(null);
  const [reminderViaUserLoading, setReminderViaUserLoading] = useState(false);
  const [reminderViaUserMessage, setReminderViaUserMessage] = useState('');
  const [reminderViaUserError, setReminderViaUserError] = useState('');
  const [viberEditForm, setViberEditForm] = useState<{
    rawMessage: string;
    senderName: string;
    listingType: ViberListingType;
    route: string;
    date: string;
    departureTime: string;
    seats: string;
    priceUah: string;
    phone: string;
    notes: string;
    isActive: boolean;
  }>({
    rawMessage: '',
    senderName: '',
    listingType: 'driver' as ViberListingType,
    route: '',
    date: '',
    departureTime: '',
    seats: '',
    priceUah: '',
    phone: '',
    notes: '',
    isActive: true,
  });

  // Управління даними (Person)
  const [persons, setPersons] = useState<PersonWithCounts[]>([]);
  const [dataSearchQuery, setDataSearchQuery] = useState('');
  const [dataLoading, setDataLoading] = useState(false);
  const [editingPerson, setEditingPerson] = useState<PersonWithCounts | null>(null);
  const [personEditForm, setPersonEditForm] = useState<{
    phone: string;
    fullName: string;
    telegramChatId: string;
    telegramUserId: string;
    telegramUsername: string;
    telegramPromoSentAt: string; // ISO або '' для обнулення
    telegramReminderSentAt: string; // комунікація через бота (нагадування)
  }>({ phone: '', fullName: '', telegramChatId: '', telegramUserId: '', telegramUsername: '', telegramPromoSentAt: '', telegramReminderSentAt: '' });
  const [dataSortField, setDataSortField] = useState<string>('id');
  const [dataSortDir, setDataSortDir] = useState<'asc' | 'desc'>('asc');
  const [refreshNamesLoading, setRefreshNamesLoading] = useState(false);
  const [refreshNamesResult, setRefreshNamesResult] = useState<RefreshPersonNamesResponse | null>(null);
  const [phoneCheckLoading, setPhoneCheckLoading] = useState(false);
  const [phoneCheckSummary, setPhoneCheckSummary] = useState('');

  // Аналітика ViberRide / поведінка клієнтів
  const [viberAnalyticsLoading, setViberAnalyticsLoading] = useState(false);
  const [viberAnalyticsError, setViberAnalyticsError] = useState('');
  const [viberAnalyticsClients, setViberAnalyticsClients] = useState<ViberClientBehavior[]>([]);
  const [viberAnalyticsSummary, setViberAnalyticsSummary] = useState('');
  const [viberAnalyticsPage, setViberAnalyticsPage] = useState(0);
  const [viberAnalyticsTotalPages, setViberAnalyticsTotalPages] = useState(0);
  const [viberAnalyticsTotalCount, setViberAnalyticsTotalCount] = useState(0);
  const [viberAnalyticsPromoScenarios, setViberAnalyticsPromoScenarios] = useState<ViberAnalyticsPromoScenariosResponse | null>(null);
  const [promoSendStatus, setPromoSendStatus] = useState<{ phoneKey?: string; success?: boolean; error?: string }>({});

  useEffect(() => {
    if (activeTab === 'bookings') {
      loadBookings();
    } else if (activeTab === 'schedules') {
      loadSchedules();
    } else if (activeTab === 'viber') {
      loadViberListings();
    } else if (activeTab === 'promo') {
      loadPromoPersons();
      loadTelegramReminderPersons();
    } else if (activeTab === 'data') {
      loadPersons();
    }
  }, [activeTab, promoFilter, telegramReminderFilter]);

  const loadPromoPersons = async () => {
    setPromoError('');
    try {
      const data = await apiClient.getChannelPromoPersons(promoFilter);
      setPromoPersons(data);
    } catch (err) {
      setPromoError(err instanceof Error ? err.message : 'Помилка завантаження');
    }
  };

  const loadTelegramReminderPersons = async () => {
    setTelegramReminderError('');
    setTelegramReminderLoading(true);
    try {
      const data = await apiClient.getTelegramReminderPersons(telegramReminderFilter);
      setTelegramReminderPersons(data);
    } catch (err) {
      setTelegramReminderError(
        err instanceof Error ? err.message : 'Помилка завантаження Telegram клієнтів'
      );
    } finally {
      setTelegramReminderLoading(false);
    }
  };

  const handleSendChannelPromo = async () => {
    setPromoLoading(true);
    setPromoError('');
    setPromoResults(null);
    try {
      const result = await apiClient.sendChannelPromo({ filter: promoFilter });
      setPromoResults(result);
      await loadPromoPersons();
    } catch (err) {
      setPromoError(err instanceof Error ? err.message : 'Помилка відправки');
    } finally {
      setPromoLoading(false);
    }
  };

  const handleImportViberAnalytics = async () => {
    setViberAnalyticsError('');
    setViberAnalyticsSummary('');
    try {
      const result = await apiClient.importViberAnalytics();
      const msg =
        result.message ||
        `Імпортовано ${result.importedNow} нових записів з ${result.totalSource} (вже було: ${result.alreadyImported}).` +
          (typeof result.totalListings === 'number' && typeof result.totalEvents === 'number'
            ? ` Загалом у ViberListing: ${result.totalListings}, у ViberRideEvent (аналітика): ${result.totalEvents}.`
            : '');
      if (!result.success) {
        // Якщо імпорт неуспішний (наприклад, немає таблиці ViberRide) — показуємо це як помилку
        setViberAnalyticsError(msg);
      } else {
        setViberAnalyticsSummary(msg);
      }
    } catch (err) {
      setViberAnalyticsError(err instanceof Error ? err.message : 'Помилка імпорту аналітики ViberRide');
    }
  };

  const handleLoadViberAnalyticsSummary = async () => {
    setViberAnalyticsError('');
    setViberAnalyticsLoading(true);
    try {
      const [result, scenarios] = await Promise.all([
        apiClient.getViberAnalyticsSummary({ page: 1, pageSize: 50, minRides: 3 }),
        apiClient.getViberAnalyticsPromoScenarios(),
      ]);
      setViberAnalyticsClients(result.clients);
      setViberAnalyticsPage(result.page);
      setViberAnalyticsTotalPages(result.totalPages);
      setViberAnalyticsTotalCount(result.total);
      setViberAnalyticsPromoScenarios(scenarios);
      if (!result.clients.length) {
        setViberAnalyticsSummary('Аналітика: поки що немає достатньо даних для побудови поведінкових профілів.');
      } else {
        setViberAnalyticsSummary(
          `Аналітика: знайдено ${result.total} активних клієнтів з історії ViberRide (сторінка ${result.page} з ${result.totalPages}).`,
        );
      }
    } catch (err) {
      setViberAnalyticsError(err instanceof Error ? err.message : 'Помилка завантаження аналітики ViberRide');
    } finally {
      setViberAnalyticsLoading(false);
    }
  };

  const handleSendPersonPromo = async (client: ViberClientBehavior, scenarioKey: BehaviorPromoScenarioKey) => {
    const phoneKey = `${client.phoneNormalized}:${scenarioKey}`;
    setPromoSendStatus({});
    setSuccess('');
    try {
      const mainRoute = client.routes[0]?.route;
      const result = await apiClient.sendViberAnalyticsPersonPromo(client.phoneNormalized, scenarioKey, mainRoute);
      if (result.success) {
        setPromoSendStatus({ phoneKey, success: true });
        setSuccess(`Реклама відправлена (${result.sentVia === 'bot' ? 'бот' : 'ваш акаунт'}).`);
      } else {
        setPromoSendStatus({ phoneKey, error: result.error ?? 'Помилка відправки' });
      }
    } catch (err) {
      setPromoSendStatus({ phoneKey, error: err instanceof Error ? err.message : 'Помилка відправки' });
    }
  };

  const handleSendChannelPromoFirst5 = async () => {
    setPromoLoading(true);
    setPromoError('');
    setPromoResults(null);
    try {
      const result = await apiClient.sendChannelPromo({
        filter: promoFilter,
        limit: 5,
        delaysMs: [5000, 10000, 15000, 25000],
      });
      setPromoResults(result);
      await loadPromoPersons();
    } catch (err) {
      setPromoError(err instanceof Error ? err.message : 'Помилка відправки');
    } finally {
      setPromoLoading(false);
    }
  };

  const handleSendReminderViaUserAccount = async () => {
    if (!telegramReminderResults?.blocked?.length) return;
    setReminderViaUserError('');
    setReminderViaUserMessage('');
    setReminderViaUserLoading(true);
    try {
      const result = await apiClient.sendReminderViaUserAccount(
        telegramReminderResults.blocked.map((p) => p.phoneNormalized)
      );
      setReminderViaUserMessage(result.message ?? `Відправлено: ${result.sent}, помилок: ${result.failed}`);
    } catch (err) {
      setReminderViaUserError(err instanceof Error ? err.message : 'Помилка відправки');
    } finally {
      setReminderViaUserLoading(false);
    }
  };

  const handleSendTelegramReminders = async () => {
    setTelegramReminderError('');
    setTelegramReminderSummary('');
    setTelegramReminderResults(null);
    setReminderViaUserMessage('');
    setReminderViaUserError('');
    setTelegramReminderLoading(true);
    try {
      const result = await apiClient.sendTelegramReminders({ filter: telegramReminderFilter });
      setTelegramReminderSummary(
        result.message ||
          `Нагадування відправлено: ${result.sent}/${result.total}, помилок: ${result.failed}`
      );
      setTelegramReminderResults({
        sent: result.sent,
        failed: result.failed,
        total: result.total,
        message: result.message,
        blocked: result.blocked ?? [],
      });
      await loadTelegramReminderPersons();
    } catch (err) {
      setTelegramReminderError(
        err instanceof Error ? err.message : 'Помилка відправки нагадувань'
      );
    } finally {
      setTelegramReminderLoading(false);
    }
  };

  const handleCreatePromoContact = async (e: React.FormEvent) => {
    e.preventDefault();
    const phone = promoContactPhone.trim();
    const name = promoContactName.trim();
    if (!phone || !name) {
      setPromoError('Заповніть телефон та ім\'я');
      return;
    }
    setPromoContactSaving(true);
    setPromoError('');
    setPromoContactSuccess('');
    try {
      await apiClient.createPerson(phone, name);
      setPromoContactSuccess('Контакт створено');
      loadPromoPersons();
    } catch (err) {
      setPromoError(err instanceof Error ? err.message : 'Помилка створення контакту');
    } finally {
      setPromoContactSaving(false);
    }
  };

  const loadPersons = async (search?: string) => {
    setDataLoading(true);
    setError('');
    try {
      const data = await apiClient.getPersons((search !== undefined ? search : dataSearchQuery) || undefined);
      setPersons(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження персон');
    } finally {
      setDataLoading(false);
    }
  };

  const toDateTimeLocal = (iso: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
  };

  const openEditPerson = (p: PersonWithCounts) => {
    setEditingPerson(p);
    setPersonEditForm({
      phone: p.phoneNormalized,
      fullName: p.fullName ?? '',
      telegramChatId: p.telegramChatId ?? '',
      telegramUserId: p.telegramUserId ?? '',
      telegramUsername: p.telegramUsername ?? '',
      telegramPromoSentAt: toDateTimeLocal(p.telegramPromoSentAt),
      telegramReminderSentAt: toDateTimeLocal(p.telegramReminderSentAt),
    });
  };

  const toggleDataSort = (field: string) => {
    if (dataSortField === field) {
      setDataSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setDataSortField(field);
      setDataSortDir('asc');
    }
  };

  const sortedPersons = [...persons].sort((a, b) => {
    const dir = dataSortDir === 'asc' ? 1 : -1;
    let va: string | number | null | undefined;
    let vb: string | number | null | undefined;
    if (dataSortField === 'id') {
      va = a.id;
      vb = b.id;
    } else if (dataSortField === 'phoneNormalized') {
      va = a.phoneNormalized;
      vb = b.phoneNormalized;
    } else if (dataSortField === 'fullName') {
      va = a.fullName ?? '';
      vb = b.fullName ?? '';
    } else if (dataSortField === 'telegramChatId') {
      va = a.telegramChatId ?? '';
      vb = b.telegramChatId ?? '';
    } else if (dataSortField === 'telegramUserId') {
      va = a.telegramUserId ?? '';
      vb = b.telegramUserId ?? '';
    } else if (dataSortField === 'telegramUsername') {
      va = a.telegramUsername ?? '';
      vb = b.telegramUsername ?? '';
    } else if (dataSortField === 'telegramPromoSentAt') {
      va = a.telegramPromoSentAt ?? '';
      vb = b.telegramPromoSentAt ?? '';
    } else if (dataSortField === 'telegramReminderSentAt') {
      va = a.telegramReminderSentAt ?? '';
      vb = b.telegramReminderSentAt ?? '';
    } else if (dataSortField === 'bookings') {
      va = a._count.bookings;
      vb = b._count.bookings;
    } else if (dataSortField === 'viberListings') {
      va = a._count.viberListings;
      vb = b._count.viberListings;
    } else {
      return 0;
    }
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return cmp * dir;
  });

  const handleUpdatePerson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPerson) return;
    setError('');
    setSuccess('');
    try {
      await apiClient.updatePerson(editingPerson.id, {
        phone: personEditForm.phone.trim() || undefined,
        fullName: personEditForm.fullName.trim() || null,
        telegramChatId: personEditForm.telegramChatId.trim() || null,
        telegramUserId: personEditForm.telegramUserId.trim() || null,
        telegramUsername: personEditForm.telegramUsername.trim() || null,
        telegramPromoSentAt: personEditForm.telegramPromoSentAt.trim() ? new Date(personEditForm.telegramPromoSentAt.trim()).toISOString() : null,
        telegramReminderSentAt: personEditForm.telegramReminderSentAt.trim() ? new Date(personEditForm.telegramReminderSentAt.trim()).toISOString() : null,
      });
      setSuccess('Персону оновлено. Пов’язані бронювання та Viber-оголошення оновлено за потреби.');
      setEditingPerson(null);
      loadPersons();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка оновлення');
    }
  };

  const handleRefreshNames = async (onlyEmpty?: boolean, onlyLatin?: boolean) => {
    setRefreshNamesLoading(true);
    setError('');
    setSuccess('');
    setRefreshNamesResult(null);
    try {
      const result = await apiClient.refreshPersonNames(
        onlyEmpty || onlyLatin ? { onlyEmpty: !!onlyEmpty, onlyLatin: !!onlyLatin } : undefined,
      );
      setRefreshNamesResult(result);
      if (result.updated > 0) {
        setSuccess(`Оновлено імен: ${result.updated}. Пропущено: ${result.skipped}. Всього перевірено: ${result.total}.`);
        loadPersons();
      } else {
        setSuccess(`Перевірено: ${result.total}. Оновлено: ${result.updated}, пропущено: ${result.skipped}.${result.errors?.length ? ' Помилки: ' + result.errors.length : ''}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка оновлення імен');
    } finally {
      setRefreshNamesLoading(false);
    }
  };

  const handleAnalyzePhonesViaPhoneCheck = async () => {
    if (!persons.length) {
      setError('Немає персон для аналізу. Спочатку завантажте список.');
      return;
    }
    setPhoneCheckLoading(true);
    setError('');
    setSuccess('');
    setPhoneCheckSummary('');
    try {
      const phones = persons.map((p) => p.phoneNormalized);
      const result = await apiClient.analyzePhonesViaPhoneCheck(phones);
      const withData = result.results.filter((r) => r.hasData).length;
      setPhoneCheckSummary(
        `phonecheck.top: перевірено ${result.total} телефонів, дані знайдено для ${withData}.` +
          (withData > 0 ? ' Файл з відповідями завантажено.' : ' Дані не знайдено.')
      );

      const dataToDownload = result.results.filter((r) => r.hasData);
      if (typeof window !== 'undefined' && dataToDownload.length > 0) {
        const blob = new Blob(
          [JSON.stringify(dataToDownload, null, 2)],
          { type: 'application/json;charset=utf-8' }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
          now.getDate(),
        ).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(
          now.getMinutes(),
        ).padStart(2, '0')}`;
        a.href = url;
        a.download = `phonecheck-top-results-${ts}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка аналізу через phonecheck.top');
    } finally {
      setPhoneCheckLoading(false);
    }
  };

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

  const filteredViberListings = viberListings
    .filter((listing) => {
      if (viberActiveFilter && !listing.isActive) return false;
      if (viberRouteFilter && !listing.route.toLowerCase().includes(viberRouteFilter.toLowerCase())) return false;
      if (viberDateFilter) {
        const listingDate = listing.date.slice(0, 10);
        if (listingDate !== viberDateFilter) return false;
      }
      if (viberTypeFilter && listing.listingType !== viberTypeFilter) return false;
      if (viberNoPhoneFilter && listing.phone?.trim()) return false;
      if (viberNoDepartureTimeFilter && listing.departureTime?.trim()) return false;
      if (viberSearchQuery) {
        const searchIn = `${listing.phone} ${listing.senderName ?? ''} ${listing.notes ?? ''} ${listing.rawMessage}`.toLowerCase();
        if (!searchIn.includes(viberSearchQuery.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const mult = viberSortOrder === 'asc' ? 1 : -1;
      if (viberSortBy === 'id') {
        return (a.id - b.id) * mult;
      }
      const dateA = a.date.slice(0, 10);
      const dateB = b.date.slice(0, 10);
      if (dateA !== dateB) return (dateA.localeCompare(dateB)) * mult;
      const timeA = (a.departureTime || '').trim() || '00:00';
      const timeB = (b.departureTime || '').trim() || '00:00';
      return (timeA.localeCompare(timeB)) * mult;
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
        supportPhone: schedule.supportPhone ?? '',
      });
    } else {
      setEditingSchedule(null);
      setScheduleForm({
        route: 'Kyiv-Malyn-Irpin',
        departureTime: '',
        maxSeats: 20,
        supportPhone: '',
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
      priceUah: listing.priceUah != null ? String(listing.priceUah) : '',
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
        priceUah: viberEditForm.priceUah ? parseInt(viberEditForm.priceUah, 10) : null,
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
    korostenMalyn: filteredBookings.filter((b) => b.route.includes('Korosten-Malyn')).length,
    malynKorosten: filteredBookings.filter((b) => b.route.includes('Malyn-Korosten')).length,
    totalSeats: filteredBookings.reduce((sum, b) => sum + b.seats, 0),
  };

  const routeOptions = Object.entries(ROUTES).map(([value, label]) => ({
    value,
    label,
  }));

  return (
    <div className="admin-page">
      <header className="admin-header">
        <div className="admin-header-inner">
          <h1 className="admin-title">Адмін панель</h1>
          <p className="admin-subtitle">Бронювання, графіки, оголошення</p>
        </div>
      </header>
      <div className="admin-container">
        <nav className="admin-tabs" aria-label="Розділи">
          <button
            className={`admin-tab ${activeTab === 'bookings' ? 'active' : ''}`}
            onClick={() => setActiveTab('bookings')}
          >
            Бронювання
          </button>
          <button
            className={`admin-tab ${activeTab === 'schedules' ? 'active' : ''}`}
            onClick={() => setActiveTab('schedules')}
          >
            Графіки
          </button>
          <button
            className={`admin-tab ${activeTab === 'viber' ? 'active' : ''}`}
            onClick={() => setActiveTab('viber')}
          >
            Viber
          </button>
          <button
            className={`admin-tab ${activeTab === 'promo' ? 'active' : ''}`}
            onClick={() => setActiveTab('promo')}
          >
            Реклама
          </button>
          <button
            className={`admin-tab ${activeTab === 'data' ? 'active' : ''}`}
            onClick={() => setActiveTab('data')}
          >
            Дані
          </button>
        </nav>

        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

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
                <h3>Коростень → Малин</h3>
                <div className="stat-value">{stats.korostenMalyn}</div>
              </div>
              <div className="stat-card">
                <h3>Малин → Коростень</h3>
                <div className="stat-value">{stats.malynKorosten}</div>
              </div>
              <div className="stat-card">
                <h3>Всього місць</h3>
                <div className="stat-value">{stats.totalSeats}</div>
              </div>
            </div>

            <div className="admin-controls">
              <div className="admin-controls-filters">
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
                  aria-label="Дата"
                />
                <input
                  type="text"
                  placeholder="Пошук..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="control-input control-input--search"
                  aria-label="Пошук по імені або телефону"
                />
              </div>
              <div className="admin-controls-actions">
                <Button onClick={loadBookings}>Оновити</Button>
                <Button variant="secondary" onClick={() => { setRouteFilter(''); setDateFilter(''); setSearchQuery(''); }}>
                  Очистити
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="admin-loading" aria-live="polite">Завантаження...</div>
            ) : filteredBookings.length === 0 ? (
              <div className="admin-empty">
                <p className="admin-empty-text">Немає бронювань за обраними фільтрами</p>
                <Button variant="secondary" onClick={() => { setRouteFilter(''); setDateFilter(''); setSearchQuery(''); }}>
                  Очистити фільтри
                </Button>
              </div>
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
                            {getBookingRouteDisplayLabel(booking.route, booking.source)}
                          </span>
                        </td>
                        <td>{new Date(booking.date).toLocaleDateString('uk-UA')}</td>
                        <td><strong>{booking.departureTime}</strong></td>
                        <td>{booking.seats}</td>
                        <td>{booking.name}</td>
                        <td>{formatPhoneDisplay(booking.phone)}</td>
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
            <div className="admin-controls">
              <div className="admin-controls-filters">
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
              </div>
              <div className="admin-controls-actions">
                <Button onClick={loadSchedules}>Оновити</Button>
                <Button onClick={() => openScheduleModal()}>Додати рейс</Button>
              </div>
            </div>

            {loading ? (
              <div className="admin-loading" aria-live="polite">Завантаження...</div>
            ) : schedules.length === 0 ? (
              <div className="admin-empty">
                <p className="admin-empty-text">Ще немає рейсів у графіку</p>
                <Button onClick={() => openScheduleModal()}>Додати перший рейс</Button>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Маршрут</th>
                      <th>Час відправлення</th>
                      <th>Макс. місць</th>
                      <th>Телефон підтримки</th>
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
                        <td>{schedule.supportPhone ? formatPhoneDisplay(schedule.supportPhone) : '—'}</td>
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
                <h3>Водії</h3>
                <div className="stat-value">{filteredViberListings.filter((l) => l.listingType === 'driver').length}</div>
              </div>
              <div className="stat-card">
                <h3>Пасажири</h3>
                <div className="stat-value">{filteredViberListings.filter((l) => l.listingType === 'passenger').length}</div>
              </div>
            </div>

            <div className="admin-controls admin-controls--viber">
              <div className="admin-controls-filters">
                <Select
                  options={[
                    { value: '', label: 'Всі типи' },
                    { value: 'driver', label: 'Водій' },
                    { value: 'passenger', label: 'Пасажир' },
                  ]}
                  value={viberTypeFilter}
                  onChange={(e) => setViberTypeFilter(e.target.value as 'driver' | 'passenger' | '')}
                />
                <input type="text" placeholder="Маршрут" value={viberRouteFilter} onChange={(e) => setViberRouteFilter(e.target.value)} className="control-input" aria-label="Маршрут" />
                <input type="date" value={viberDateFilter} onChange={(e) => setViberDateFilter(e.target.value)} className="control-input" aria-label="Дата" />
                <input type="text" placeholder="Пошук..." value={viberSearchQuery} onChange={(e) => setViberSearchQuery(e.target.value)} className="control-input control-input--search" aria-label="Пошук" />
                <label className="admin-checkbox">
                  <input type="checkbox" checked={viberActiveFilter} onChange={(e) => setViberActiveFilter(e.target.checked)} />
                  <span>Активні</span>
                </label>
                <label className="admin-checkbox">
                  <input type="checkbox" checked={viberNoPhoneFilter} onChange={(e) => setViberNoPhoneFilter(e.target.checked)} />
                  <span>Без телефону</span>
                </label>
                <label className="admin-checkbox">
                  <input type="checkbox" checked={viberNoDepartureTimeFilter} onChange={(e) => setViberNoDepartureTimeFilter(e.target.checked)} />
                  <span>Без часу</span>
                </label>
              </div>
              <div className="admin-controls-actions">
                <Button onClick={loadViberListings}>Оновити</Button>
                <Button onClick={() => setIsViberModalOpen(true)}>Додати оголошення</Button>
                <Button variant="secondary" onClick={handleCleanupOldViberListings}>Очистити старі</Button>
                <Button variant="secondary" onClick={() => { setViberRouteFilter(''); setViberDateFilter(''); setViberTypeFilter(''); setViberSearchQuery(''); setViberNoPhoneFilter(false); setViberNoDepartureTimeFilter(false); setViberSortBy('id'); setViberSortOrder('desc'); }}>Очистити</Button>
              </div>
            </div>

            {loading ? (
              <div className="admin-loading" aria-live="polite">Завантаження...</div>
            ) : filteredViberListings.length === 0 ? (
              <div className="admin-empty">
                <p className="admin-empty-text">Немає оголошень за фільтрами</p>
                <Button variant="secondary" onClick={() => { setViberRouteFilter(''); setViberDateFilter(''); setViberTypeFilter(''); setViberSearchQuery(''); setViberNoPhoneFilter(false); setViberNoDepartureTimeFilter(false); }}>
                  Очистити фільтри
                </Button>
                <Button onClick={() => setIsViberModalOpen(true)}>Додати оголошення</Button>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th
                        className="sortable"
                        onClick={() => {
                          setViberSortBy('id');
                          setViberSortOrder((o) => (viberSortBy === 'id' ? (o === 'asc' ? 'desc' : 'asc') : 'desc'));
                        }}
                        title="Сортувати по ID"
                      >
                        ID {viberSortBy === 'id' && (viberSortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th>Тип</th>
                      <th>Маршрут</th>
                      <th
                        className="sortable"
                        onClick={() => {
                          setViberSortBy('date');
                          setViberSortOrder((o) => (viberSortBy === 'date' ? (o === 'asc' ? 'desc' : 'asc') : 'desc'));
                        }}
                        title="Сортувати по даті та часу"
                      >
                        Дата + час {viberSortBy === 'date' && (viberSortOrder === 'asc' ? '↑' : '↓')}
                      </th>
                      <th>Місця</th>
                      <th>Ціна (грн)</th>
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
                            {listing.listingType === 'driver' ? 'Водій' : 'Пасажир'}
                          </span>
                        </td>
                        <td>{listing.route}</td>
                        <td>
                          {new Date(listing.date).toLocaleDateString('uk-UA')}
                          {listing.departureTime ? ` ${listing.departureTime}` : ''}
                        </td>
                        <td>{listing.seats ?? '-'}</td>
                        <td>{listing.priceUah != null ? `${listing.priceUah} грн` : '—'}</td>
                        <td><strong>{formatPhoneDisplay(listing.phone)}</strong></td>
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
                            Редагувати
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
                        { value: 'driver', label: 'Водій' },
                        { value: 'passenger', label: 'Пасажир' },
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
                    label="Ціна (грн)"
                    type="number"
                    value={viberEditForm.priceUah}
                    onChange={(e) => setViberEditForm((f) => ({ ...f, priceUah: e.target.value }))}
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

        {/* Реклама каналу (одноразово) */}
        {activeTab === 'promo' && (
          <div className="tab-content">
            {promoError && <Alert variant="error">{promoError}</Alert>}
            {promoContactSuccess && <Alert variant="success">{promoContactSuccess}</Alert>}

            {viberAnalyticsError && <Alert variant="error">{viberAnalyticsError}</Alert>}
            {viberAnalyticsSummary && <Alert variant="success">{viberAnalyticsSummary}</Alert>}

            <h3 style={{ marginBottom: '8px' }}>Створити контакт</h3>
            <form onSubmit={handleCreatePromoContact} style={{ marginBottom: '24px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'flex-end' }}>
              <Input
                label="Телефон *"
                type="text"
                placeholder="+380931701835"
                value={promoContactPhone}
                onChange={(e) => setPromoContactPhone(e.target.value)}
                required
              />
              <Input
                label="Ім'я *"
                type="text"
                placeholder="Петро Коваленко"
                value={promoContactName}
                onChange={(e) => setPromoContactName(e.target.value)}
                required
              />
              <Button type="submit" disabled={promoContactSaving}>
                {promoContactSaving ? 'Збереження...' : 'Створити контакт'}
              </Button>
            </form>

            <p style={{ marginBottom: '8px' }}>
              <strong>База для реклами</strong> — тільки персони без Telegram бота. Вибір:{' '}
              <select
                value={promoFilter}
                onChange={(e) => setPromoFilter(e.target.value as PromoFilter)}
                style={{ marginLeft: '4px', padding: '4px 8px' }}
              >
                <option value="no_telegram">Усі з бази (без бота)</option>
                <option value="no_communication">До кого ще не комунікували</option>
                <option value="promo_not_found">Не знайдено в Telegram</option>
              </select>
            </p>
            <p style={{ marginBottom: '12px' }}>
              Підходить під вибір: <strong>{promoPersons.length}</strong>. Після відправки проставляється дата комунікації.
            </p>
            <div className="controls" style={{ marginBottom: '16px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <Button
                onClick={handleSendChannelPromo}
                disabled={promoLoading || promoPersons.length === 0}
              >
                {promoLoading ? 'Відправка...' : 'Відправити рекламу'}
              </Button>
              <Button
                variant="secondary"
                onClick={handleSendChannelPromoFirst5}
                disabled={promoLoading || promoPersons.length === 0}
                title="Першим 5 одержувачам з паузою 5, 10, 15, 25 с між відправками"
              >
                {promoLoading ? 'Відправка...' : 'Перші 5 (з паузою)'}
              </Button>
              <Button variant="secondary" onClick={loadPromoPersons} disabled={promoLoading}>
                Оновити список
              </Button>
            </div>
            {promoResults && (
              <div className="table-container" style={{ marginTop: '16px' }}>
                <h3 style={{ marginBottom: '8px' }}>Доставлено ({promoResults.sent.length})</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Телефон</th>
                      <th>Імʼя</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promoResults.sent.map((r, i) => (
                      <tr key={`sent-${i}`}>
                        <td>{formatPhoneDisplay(r.phone)}</td>
                        <td>{r.fullName ?? '—'}</td>
                      </tr>
                    ))}
                    {promoResults.sent.length === 0 && (
                      <tr><td colSpan={2}>—</td></tr>
                    )}
                  </tbody>
                </table>
                <h3 style={{ marginTop: '16px', marginBottom: '8px' }}>Не знайдено в Telegram ({promoResults.notFound.length})</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Телефон</th>
                      <th>Імʼя</th>
                    </tr>
                  </thead>
                  <tbody>
                    {promoResults.notFound.map((r, i) => (
                      <tr key={`nf-${i}`}>
                        <td>{formatPhoneDisplay(r.phone)}</td>
                        <td>{r.fullName ?? '—'}</td>
                      </tr>
                    ))}
                    {promoResults.notFound.length === 0 && (
                      <tr><td colSpan={2}>—</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <hr style={{ margin: '24px 0' }} />

            <h3 style={{ marginBottom: '8px' }}>Аналітика історичних ViberRide</h3>
            <p style={{ marginBottom: '8px', color: 'var(--color-text-secondary, #666)' }}>
              Тут використовуються історичні дані з таблиці <code>ViberRide</code>, які переносяться в окрему аналітичну таблицю.
              Спочатку імпортуйте нові записи, потім побудуйте короткі профілі 10–20 клієнтів.
            </p>
            <div
              className="controls"
              style={{ marginBottom: '16px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}
            >
              <Button onClick={handleImportViberAnalytics}>
                Імпортувати нові ViberRide в аналітику
              </Button>
              <Button onClick={handleLoadViberAnalyticsSummary} disabled={viberAnalyticsLoading}>
                {viberAnalyticsLoading ? 'Аналіз...' : 'Показати 10–20 клієнтів з патернами'}
              </Button>
            </div>
            {viberAnalyticsClients.length > 0 && (
              <div className="table-container" style={{ marginTop: '8px' }}>
                <h4 style={{ marginBottom: '8px' }}>Клієнти з виявленими патернами (історія ViberRide)</h4>
                {viberAnalyticsTotalCount > 0 && (
                  <p style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--color-text-secondary, #666)' }}>
                    Показано {viberAnalyticsClients.length} з {viberAnalyticsTotalCount} клієнтів
                    {viberAnalyticsTotalPages > 1 ? ` (сторінка ${viberAnalyticsPage} з ${viberAnalyticsTotalPages})` : ''}.
                  </p>
                )}
                <table>
                  <thead>
                    <tr>
                      <th>Телефон</th>
                      <th>Імʼя</th>
                      <th>Поїздок</th>
                      <th>Період</th>
                      <th>Основні маршрути</th>
                      <th>Короткий опис поведінки</th>
                      <th>Технічні ідеї, що робити з даними</th>
                      <th>Реклама</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viberAnalyticsClients.map((c) => {
                      const scenarioKeys = viberAnalyticsPromoScenarios?.scenarioKeysByProfile[c.profileRole] ?? [];
                      const canSend = !(c.communicationFailed && !c.hasTelegramBot);
                      return (
                        <tr key={c.phoneNormalized}>
                          <td>{formatPhoneDisplay(c.phoneNormalized)}</td>
                          <td>{c.fullName ?? '—'}</td>
                          <td>{c.totalRides}</td>
                          <td>
                            {c.firstRideDate
                              ? new Date(c.firstRideDate).toLocaleDateString('uk-UA')
                              : '—'}{' '}
                            –{' '}
                            {c.lastRideDate
                              ? new Date(c.lastRideDate).toLocaleDateString('uk-UA')
                              : '—'}
                          </td>
                          <td>
                            {c.routes.slice(0, 3).map((r) => (
                              <div key={r.route}>
                                {r.route} ({r.count})
                              </div>
                            ))}
                          </td>
                          <td style={{ maxWidth: 320 }}>
                            <span>{c.behaviorSummary}</span>
                          </td>
                          <td style={{ maxWidth: 360 }}>
                            <ul style={{ paddingLeft: '18px', margin: 0 }}>
                              {c.recommendations.map((rec, idx) => (
                                <li key={idx}>{rec}</li>
                              ))}
                            </ul>
                          </td>
                          <td style={{ minWidth: 200 }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                              {scenarioKeys.map((key) => {
                                const label = viberAnalyticsPromoScenarios?.scenarios.find((s) => s.key === key)?.label ?? key;
                                const rowKey = `${c.phoneNormalized}:${key}`;
                                const isSending = promoSendStatus.phoneKey === rowKey && promoSendStatus.success === undefined && !promoSendStatus.error;
                                const isError = promoSendStatus.phoneKey === rowKey && promoSendStatus.error;
                                return (
                                  <span key={key} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                                    <Button
                                      variant="secondary"
                                      disabled={!canSend || isSending}
                                      onClick={() => handleSendPersonPromo(c, key)}
                                      title={!canSend ? 'Невдала комунікація — контакт не знайдено в Telegram' : undefined}
                                      style={{ fontSize: '12px', padding: '4px 8px', whiteSpace: 'nowrap' }}
                                    >
                                      {isSending ? '…' : label}
                                    </Button>
                                    {isError && (
                                      <span style={{ fontSize: '11px', color: 'var(--color-error, #c00)' }}>{promoSendStatus.error}</span>
                                    )}
                                  </span>
                                );
                              })}
                            </div>
                            {!canSend && (
                              <span style={{ fontSize: '11px', color: 'var(--color-text-secondary, #666)' }} title="Раніше не вдалося доставити повідомлення в Telegram">
                                Комунікація не вдалася
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {viberAnalyticsPage < viberAnalyticsTotalPages && (
                  <div style={{ marginTop: '12px', textAlign: 'center' }}>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          setViberAnalyticsLoading(true);
                          const nextPage = viberAnalyticsPage + 1;
                          const result = await apiClient.getViberAnalyticsSummary({
                            page: nextPage,
                            pageSize: 50,
                            minRides: 3,
                          });
                          setViberAnalyticsClients((prev) => [...prev, ...result.clients]);
                          setViberAnalyticsPage(result.page);
                          setViberAnalyticsTotalPages(result.totalPages);
                          setViberAnalyticsTotalCount(result.total);
                        } catch (err) {
                          setViberAnalyticsError(
                            err instanceof Error ? err.message : 'Помилка завантаження наступної сторінки аналітики',
                          );
                        } finally {
                          setViberAnalyticsLoading(false);
                        }
                      }}
                    >
                      Догрузити ще
                    </Button>
                  </div>
                )}
              </div>
            )}

            <h3 style={{ marginBottom: '8px' }}>Нагадування для Telegram-клієнтів</h3>
            {telegramReminderError && <Alert variant="error">{telegramReminderError}</Alert>}
            {telegramReminderSummary && <Alert variant="success">{telegramReminderSummary}</Alert>}
            <p style={{ marginBottom: '8px' }}>
              <strong>База для нагадувань</strong> — тільки персони, які вже підключили Telegram бота.
              Вибір:{' '}
              <select
                value={telegramReminderFilter}
                onChange={(e) =>
                  setTelegramReminderFilter(e.target.value as TelegramReminderFilter)
                }
                style={{ marginLeft: '4px', padding: '4px 8px' }}
              >
                <option value="all">Всі з Telegram ID</option>
                <option value="no_active_viber">
                  Тільки ті, в яких зараз немає активних пропозицій у ViberRides
                </option>
                <option value="no_reminder_7_days">
                  Тим, кому не слали нагадування 7+ днів (або ніколи)
                </option>
              </select>
            </p>
            <p style={{ marginBottom: '12px' }}>
              Підходить під вибір: <strong>{telegramReminderPersons.length}</strong>. Після відправки
              проставляється дата комунікації (Нагадування відправлено).
            </p>
            <div
              className="controls"
              style={{ marginBottom: '16px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}
            >
              <Button
                onClick={handleSendTelegramReminders}
                disabled={telegramReminderLoading || telegramReminderPersons.length === 0}
              >
                {telegramReminderLoading ? 'Відправка...' : 'Відправити нагадування'}
              </Button>
              <Button
                variant="secondary"
                onClick={loadTelegramReminderPersons}
                disabled={telegramReminderLoading}
              >
                Оновити список
              </Button>
            </div>
            {telegramReminderResults && telegramReminderResults.blocked.length > 0 && (
              <div className="table-container" style={{ marginTop: '16px', marginBottom: '16px' }}>
                <h4 style={{ marginBottom: '8px' }}>
                  Заблоковано бота ({telegramReminderResults.blocked.length})
                </h4>
                <p style={{ marginBottom: '8px', color: 'var(--color-text-secondary, #666)' }}>
                  Ці користувачі заблокували бота — повідомлення не доставлено.
                </p>
                <div style={{ marginBottom: '12px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                  <Button
                    variant="secondary"
                    onClick={handleSendReminderViaUserAccount}
                    disabled={reminderViaUserLoading}
                  >
                    {reminderViaUserLoading ? 'Відправка...' : 'Нагадати їм від мого імені'}
                  </Button>
                  {reminderViaUserMessage && (
                    <span style={{ color: 'var(--color-success, green)' }}>{reminderViaUserMessage}</span>
                  )}
                  {reminderViaUserError && (
                    <Alert variant="error">{reminderViaUserError}</Alert>
                  )}
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Телефон</th>
                      <th>Імʼя</th>
                    </tr>
                  </thead>
                  <tbody>
                    {telegramReminderResults.blocked.map((p) => (
                      <tr key={p.id}>
                        <td>#{p.id}</td>
                        <td>{formatPhoneDisplay(p.phoneNormalized)}</td>
                        <td>{p.fullName ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="table-container" style={{ marginTop: '16px' }}>
              <h4 style={{ marginBottom: '8px' }}>Потенційні клієнти ({telegramReminderPersons.length})</h4>
              {telegramReminderLoading ? (
                <div className="loading">Завантаження...</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Телефон</th>
                      <th>Імʼя</th>
                      <th>Нагадування відправлено</th>
                    </tr>
                  </thead>
                  <tbody>
                    {telegramReminderPersons.length === 0 ? (
                      <tr>
                        <td colSpan={4}>—</td>
                      </tr>
                    ) : (
                      telegramReminderPersons.map((p) => (
                        <tr key={p.id}>
                          <td>#{p.id}</td>
                          <td>{formatPhoneDisplay(p.phoneNormalized)}</td>
                          <td>{p.fullName ?? '—'}</td>
                          <td>
                            {p.telegramReminderSentAt
                              ? new Date(p.telegramReminderSentAt).toLocaleString('uk-UA')
                              : '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {activeTab === 'data' && (
          <div className="tab-content">
            <div className="controls">
              <input
                type="text"
                placeholder="Пошук по телефону або імені..."
                value={dataSearchQuery}
                onChange={(e) => setDataSearchQuery(e.target.value)}
                className="control-input"
              />
              <Button onClick={() => loadPersons()}>Пошук</Button>
              <Button variant="secondary" onClick={() => loadPersons('')}>Оновити список</Button>
              <Button
                onClick={() => handleRefreshNames()}
                disabled={refreshNamesLoading}
                title="Пошук імен через Telegram-бота (якщо підключений) або через ваш акаунт (send_message.py). Оновлює ім'я, якщо нове довше і кирилицею або було пусте."
              >
                {refreshNamesLoading ? 'Оновлення…' : 'Оновити дані імен'}
              </Button>
              <Button
                onClick={() => handleRefreshNames(true)}
                disabled={refreshNamesLoading}
                title="Те саме, але лише для персон без імені в базі (—)."
              >
                {refreshNamesLoading ? 'Оновлення…' : 'Онови імена (-)'}
              </Button>
              <Button
                onClick={() => handleRefreshNames(false, true)}
                disabled={refreshNamesLoading}
                title="Оновити імена лише для персон, у яких імʼя збережене латиницею (без кирилиці) — наприклад, Tatiana Oks."
              >
                {refreshNamesLoading ? 'Оновлення…' : 'Онови імена (латиниця)'}
              </Button>
              <Button
                variant="secondary"
                onClick={handleAnalyzePhonesViaPhoneCheck}
                disabled={phoneCheckLoading || !persons.length}
                title="Перевірити поточний список телефонів через phonecheck.top та завантажити відповіді (ігноруючи «Данные не найдены»)."
              >
                {phoneCheckLoading ? 'Аналіз…' : 'Аналіз phonecheck.top'}
              </Button>
            </div>
            {refreshNamesResult && (
              <div className="data-refresh-summary" style={{ marginBottom: '12px', fontSize: '14px', color: 'var(--text-secondary, #666)' }}>
                Статистика: перевірено {refreshNamesResult.total}, оновлено {refreshNamesResult.updated}, пропущено {refreshNamesResult.skipped}.
                {refreshNamesResult.errors?.length ? ` Помилки: ${refreshNamesResult.errors.length}.` : ''}
              </div>
            )}
            {phoneCheckSummary && (
              <div className="data-refresh-summary" style={{ marginBottom: '12px', fontSize: '14px', color: 'var(--text-secondary, #666)' }}>
                {phoneCheckSummary}
              </div>
            )}
            {dataLoading ? (
              <div className="admin-loading" aria-live="polite">Завантаження...</div>
            ) : persons.length === 0 ? (
              <div className="admin-empty">
                <p className="admin-empty-text">Немає персон за пошуком</p>
                <Button variant="secondary" onClick={() => setDataSearchQuery('')}>Очистити пошук</Button>
                <Button onClick={() => loadPersons()}>Оновити список</Button>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th className="sortable" onClick={() => toggleDataSort('id')} title="Сортувати">
                        ID {dataSortField === 'id' ? (dataSortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="sortable" onClick={() => toggleDataSort('phoneNormalized')} title="Сортувати">
                        Телефон {dataSortField === 'phoneNormalized' ? (dataSortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="sortable" onClick={() => toggleDataSort('fullName')} title="Сортувати">
                        Ім'я {dataSortField === 'fullName' ? (dataSortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th>Зміни</th>
                      <th className="sortable" onClick={() => toggleDataSort('telegramChatId')} title="Сортувати">
                        Telegram ChatId {dataSortField === 'telegramChatId' ? (dataSortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="sortable" onClick={() => toggleDataSort('telegramUserId')} title="Сортувати">
                        Telegram UserId {dataSortField === 'telegramUserId' ? (dataSortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="sortable" onClick={() => toggleDataSort('telegramUsername')} title="Сортувати">
                        @username {dataSortField === 'telegramUsername' ? (dataSortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="sortable" onClick={() => toggleDataSort('telegramPromoSentAt')} title="Сортувати">
                        Промо відправлено {dataSortField === 'telegramPromoSentAt' ? (dataSortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="sortable" onClick={() => toggleDataSort('telegramReminderSentAt')} title="Сортувати">
                        Нагадування (бот) {dataSortField === 'telegramReminderSentAt' ? (dataSortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="sortable" onClick={() => toggleDataSort('bookings')} title="Сортувати">
                        Бронювань {dataSortField === 'bookings' ? (dataSortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th className="sortable" onClick={() => toggleDataSort('viberListings')} title="Сортувати">
                        Viber оголош. {dataSortField === 'viberListings' ? (dataSortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                      <th>Дії</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPersons.map((p) => {
                      const change = refreshNamesResult?.changes?.find((c) => c.personId === p.id);
                      const changeLabel = change
                        ? `${change.oldName ?? '—'} → ${change.newName ?? '—'}${change.source ? ` (${change.source === 'bot' ? 'бот' : 'ваш акаунт'})` : ''}`
                        : '—';
                      return (
                        <tr key={p.id}>
                          <td>#{p.id}</td>
                          <td>{formatPhoneDisplay(p.phoneNormalized)}</td>
                          <td>{p.fullName ?? '—'}</td>
                          <td title={changeLabel} style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {changeLabel}
                          </td>
                          <td>{p.telegramChatId ?? '—'}</td>
                          <td>{p.telegramUserId ?? '—'}</td>
                          <td>{p.telegramUsername ?? '—'}</td>
                          <td>{p.telegramPromoSentAt ? new Date(p.telegramPromoSentAt).toLocaleString('uk-UA') : '—'}</td>
                          <td>{p.telegramReminderSentAt ? new Date(p.telegramReminderSentAt).toLocaleString('uk-UA') : '—'}</td>
                          <td>{p._count.bookings}</td>
                          <td>{p._count.viberListings}</td>
                          <td>
                            <Button variant="secondary" onClick={() => openEditPerson(p)}>
                              Редагувати
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {editingPerson && (
              <div className="modal" onClick={(e) => e.target === e.currentTarget && setEditingPerson(null)}>
                <div className="modal-content">
                  <div className="modal-header">
                    <h2>Редагувати персону #{editingPerson.id}</h2>
                    <button className="close-btn" onClick={() => setEditingPerson(null)}>&times;</button>
                  </div>
                  <p className="modal-hint">При зміні телефону або імені оновляться пов’язані записи в Бронюваннях та Viber-оголошеннях.</p>
                  <form onSubmit={handleUpdatePerson}>
                    <Input
                      label="Телефон (нормалізований)"
                      type="text"
                      placeholder="380931701835"
                      value={personEditForm.phone}
                      onChange={(e) => setPersonEditForm({ ...personEditForm, phone: e.target.value })}
                      required
                    />
                    <Input
                      label="Ім'я"
                      type="text"
                      placeholder="Іван Петренко"
                      value={personEditForm.fullName}
                      onChange={(e) => setPersonEditForm({ ...personEditForm, fullName: e.target.value })}
                    />
                    <Input
                      label="Telegram ChatId"
                      type="text"
                      value={personEditForm.telegramChatId}
                      onChange={(e) => setPersonEditForm({ ...personEditForm, telegramChatId: e.target.value })}
                    />
                    <Input
                      label="Telegram UserId"
                      type="text"
                      value={personEditForm.telegramUserId}
                      onChange={(e) => setPersonEditForm({ ...personEditForm, telegramUserId: e.target.value })}
                    />
                    <Input
                      label="@username"
                      type="text"
                      placeholder="@username"
                      value={personEditForm.telegramUsername}
                      onChange={(e) => setPersonEditForm({ ...personEditForm, telegramUsername: e.target.value })}
                    />
                    <div className="form-group">
                      <label>Промо відправлено (telegramPromoSentAt)</label>
                      <input
                        type="datetime-local"
                        className="control-input"
                        value={personEditForm.telegramPromoSentAt}
                        onChange={(e) => setPersonEditForm({ ...personEditForm, telegramPromoSentAt: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setPersonEditForm({ ...personEditForm, telegramPromoSentAt: '' })}
                        style={{ marginTop: '8px' }}
                      >
                        Обнулити (збити контакт для повторної реклами)
                      </Button>
                    </div>
                    <div className="form-group">
                      <label>Комунікація через бота (нагадування) — telegramReminderSentAt</label>
                      <input
                        type="datetime-local"
                        className="control-input"
                        value={personEditForm.telegramReminderSentAt}
                        onChange={(e) => setPersonEditForm({ ...personEditForm, telegramReminderSentAt: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => setPersonEditForm({ ...personEditForm, telegramReminderSentAt: '' })}
                        style={{ marginTop: '8px' }}
                      >
                        Обнулити
                      </Button>
                    </div>
                    <div className="form-actions">
                      <Button type="button" variant="secondary" onClick={() => setEditingPerson(null)}>Скасувати</Button>
                      <Button type="submit">Зберегти</Button>
                    </div>
                  </form>
                </div>
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
                <Input
                  label="Телефон підтримки (напр. +380(93)1701835)"
                  type="text"
                  placeholder="+380(93)1701835"
                  value={scheduleForm.supportPhone ?? ''}
                  onChange={(e) => setScheduleForm({ ...scheduleForm, supportPhone: e.target.value })}
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
