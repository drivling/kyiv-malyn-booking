import { ZubastykPhonesPanel } from './ZubastykPhonesPanel';
import { SchedulesTab } from './SchedulesTab';
import { RoutesTab } from './RoutesTab';
import React, { Suspense, lazy, useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { apiClient } from '@/api/client';
import { invalidateCatalogCache } from '@/api/catalogCache';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Alert } from '@/components/Alert';
import type { Schedule, ScheduleFormData, TelegramUserSendError, TripPoint, TripRoute, TimetablePreviewResponse } from '@/types';
import { getRouteLabel } from '@/utils/constants';
import { KYIV_MALYN_FARE_UAH } from '@/utils/fares';
import { MapEditorTab } from './MapEditorTab';
import { ScheduleEditorTab } from './ScheduleEditorTab';
import { StopStickerTab } from './StopStickerTab';
import { ArrivalReportsTab } from './ArrivalReportsTab';
import { TransportCityBar } from './TransportCityBar';
import { transportCitySearch, useAdminTransportCity } from './useAdminTransportCity';
import { ReferralTab } from './referrals/ReferralTab';
import { ViberTab } from './viber/ViberTab';
import { BookingsTab } from './bookings/BookingsTab';
import { PromoTab } from './promo/PromoTab';
import { LunchTab } from './LunchTab';
import { DzhuraTab } from './DzhuraTab';
import { NotificationSettingsTab } from './NotificationSettingsTab';
import { PersonArchiveTab } from './PersonArchiveTab';
import { PersonsTab } from './persons/PersonsTab';
import './AdminPage.css';

// «Доведе» (розділи /admin/dovede/<розділ>) тягне словник місць і вулиці міста — окремим чанком, лише коли вкладку відкрито
const DovedeTab = lazy(() => import('./dovede/DovedeTab'));

type Tab = 'bookings' | 'schedules' | 'routes' | 'viber' | 'promo' | 'data' | 'personArchive' | 'mapEditor' | 'scheduleEditor' | 'stickers' | 'arrivals' | 'userSenderErrors' | 'referrals' | 'lunch' | 'dzhura' | 'dovede' | 'notifications';

const DEFAULT_TAB: Tab = 'bookings';

/** Вкладки міського транспорту — над ними перемикач міста (фаза 6 плану Коростеня) */
const TRANSPORT_TABS: ReadonlySet<Tab> = new Set<Tab>(['mapEditor', 'scheduleEditor', 'stickers', 'arrivals']);

const TAB_SLUGS: Record<Tab, string> = {
  bookings: 'bookings',
  schedules: 'schedules',
  routes: 'routes',
  viber: 'viber',
  promo: 'promo',
  referrals: 'referrals',
  lunch: 'lunch',
  dzhura: 'dzhura',
  dovede: 'dovede',
  notifications: 'notifications',
  data: 'data',
  personArchive: 'archive',
  mapEditor: 'map-editor',
  scheduleEditor: 'route-schedule',
  stickers: 'stickers',
  arrivals: 'arrivals',
  userSenderErrors: 'user-sender-errors',
};

const SLUG_TO_TAB: Record<string, Tab> = Object.fromEntries(
  Object.entries(TAB_SLUGS).map(([tab, slug]) => [slug, tab as Tab])
);

function eltrainPageLabel(url: string): string {
  try {
    const reverse = new URL(url).searchParams.get('reverse');
    if (reverse === '1') return 'Київ → Коростень (reverse=1)';
    if (reverse === '2') return 'Коростень → Київ (reverse=2)';
  } catch {
    /* ignore */
  }
  return url;
}

export const AdminPage: React.FC = () => {
  const navigate = useNavigate();
  // `section` — другий сегмент адреси (/admin/dovede/questions, /admin/referrals/photos, /admin/lunch/menu,
  // /admin/promo/reminders); його читають «Доведе», «Реферали», «Столова» й «Реклама»
  const { tab: tabSlug, section } = useParams<{ tab?: string; section?: string }>();
  const activeTab: Tab = (tabSlug && SLUG_TO_TAB[tabSlug]) || DEFAULT_TAB;
  // Місто транспортних вкладок (?city=); між ними переходить разом із вкладкою
  const { city: transportCity, setCity: setTransportCity } = useAdminTransportCity();
  const setActiveTab = useCallback(
    (tab: Tab) => {
      const path = tab === DEFAULT_TAB ? '/admin' : `/admin/${TAB_SLUGS[tab]}`;
      navigate(TRANSPORT_TABS.has(tab) ? `${path}${transportCitySearch(transportCity)}` : path);
    },
    [navigate, transportCity]
  );
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [tripPoints, setTripPoints] = useState<TripPoint[]>([]);
  const [adminTripRoutes, setAdminTripRoutes] = useState<TripRoute[]>([]);
  const [isTripRouteModalOpen, setIsTripRouteModalOpen] = useState(false);
  const [editingTripRoute, setEditingTripRoute] = useState<TripRoute | null>(null);
  const [tripRouteForm, setTripRouteForm] = useState({
    startPointId: undefined as number | undefined,
    endPointId: undefined as number | undefined,
    viaPointIds: [] as number[],
    labelUk: '',
    carDurationMinutes: '',
    stopOffsets: [] as Array<{ pointId: number; departureOffsetMinutes: number | null }>,
  });
  const [isTripPointModalOpen, setIsTripPointModalOpen] = useState(false);
  const [editingTripPoint, setEditingTripPoint] = useState<TripPoint | null>(null);
  const [tripPointForm, setTripPointForm] = useState({
    code: '',
    nameUk: '',
    sortOrder: 0,
    requiredOnTrip: false,
    appearInFromTo: true,
    appearInPoputky: false,
    hasLocalTransport: false,
    quickDirectPointIds: [] as number[],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Фільтри
  const [scheduleRouteFilter, setScheduleRouteFilter] = useState('');

  // Модальне вікно для графіку
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormData>({
    departureTime: '',
    maxSeats: 20,
    supportPhone: '',
    priceUah: KYIV_MALYN_FARE_UAH,
    startPointId: undefined,
    endPointId: undefined,
    viaPointIds: [],
    stopOffsets: [],
    vehicleType: 'marshrutka',
    boardingPlace: '',
    alightingPlace: '',
    tripNumber: '',
    arrivalTime: '',
    durationMinutes: null,
    ticketPurchaseUrl: '',
    timetableSourceUrl: '',
    activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
  });
  const [timetablePreview, setTimetablePreview] = useState<TimetablePreviewResponse | null>(null);
  const [timetablePreviewLoading, setTimetablePreviewLoading] = useState(false);
  const [timetableApplyLoading, setTimetableApplyLoading] = useState(false);
  const [timetableSelectedIds, setTimetableSelectedIds] = useState<Set<number>>(new Set());
  const [timetableHtmlByUrl, setTimetableHtmlByUrl] = useState<Record<string, string>>({});

  const [userSenderErrors, setUserSenderErrors] = useState<TelegramUserSendError[]>([]);
  const [userSenderErrorsLoading, setUserSenderErrorsLoading] = useState(false);
  const [userSenderErrorsClearing, setUserSenderErrorsClearing] = useState(false);


  useEffect(() => {
    if (activeTab === 'schedules') {
      loadSchedules();
    } else if (activeTab === 'routes') {
      loadRoutesTab();
    } else if (activeTab === 'mapEditor') {
      // MapEditor завантажує дані сам
    } else if (activeTab === 'scheduleEditor') {
      // ScheduleEditor завантажує дані сам
    } else if (activeTab === 'userSenderErrors') {
      loadUserSenderErrors();
    }
    // referrals — ReferralTab завантажує дані сам
  }, [activeTab]);

  const loadUserSenderErrors = async () => {
    setUserSenderErrorsLoading(true);
    setError('');
    try {
      const data = await apiClient.getTelegramUserSendErrors();
      setUserSenderErrors(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження помилок user-sender');
    } finally {
      setUserSenderErrorsLoading(false);
    }
  };

  const handleClearUserSenderErrors = async () => {
    if (!confirm('Видалити всі записи з таблиці помилок user-sender?')) return;
    setUserSenderErrorsClearing(true);
    setError('');
    try {
      const result = await apiClient.clearTelegramUserSendErrors();
      setSuccess(`Обнулено: видалено ${result.deleted} записів`);
      setUserSenderErrors([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка обнулення');
    } finally {
      setUserSenderErrorsClearing(false);
    }
  };

  const loadSchedules = async (routeSlug?: string) => {
    setLoading(true);
    setError('');
    const filter = routeSlug !== undefined ? routeSlug : scheduleRouteFilter;
    try {
      const [data, points, routes] = await Promise.all([
        filter ? apiClient.getSchedules(filter) : apiClient.getSchedules(),
        apiClient.getTripPoints(),
        apiClient.getTripRoutes(),
      ]);
      setTripPoints(points);
      setAdminTripRoutes(routes);
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

  const loadRoutesTab = async () => {
    setLoading(true);
    setError('');
    try {
      const [points, routes] = await Promise.all([
        apiClient.getTripPoints(),
        apiClient.getTripRoutes(),
      ]);
      setTripPoints(points);
      setAdminTripRoutes(routes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка завантаження маршрутів');
    } finally {
      setLoading(false);
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

  const emptyScheduleForm = (): ScheduleFormData => ({
    departureTime: '',
    maxSeats: 20,
    supportPhone: '',
    priceUah: KYIV_MALYN_FARE_UAH,
    startPointId: tripPoints.find((p) => p.code === 'Kyiv')?.id,
    endPointId: tripPoints.find((p) => p.code === 'Malyn')?.id,
    viaPointIds: tripPoints.find((p) => p.code === 'Irpin') ? [tripPoints.find((p) => p.code === 'Irpin')!.id] : [],
    stopOffsets: [],
    vehicleType: 'marshrutka',
    boardingPlace: '',
    alightingPlace: '',
    tripNumber: '',
    arrivalTime: '',
    durationMinutes: null,
    ticketPurchaseUrl: '',
    timetableSourceUrl: '',
    activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
  });

  const openTripPointModal = (point?: TripPoint) => {
    if (point) {
      setEditingTripPoint(point);
      setTripPointForm({
        code: point.code,
        nameUk: point.nameUk,
        sortOrder: point.sortOrder,
        requiredOnTrip: point.requiredOnTrip,
        appearInFromTo: point.appearInFromTo,
        appearInPoputky: point.appearInPoputky,
        hasLocalTransport: Boolean(point.hasLocalTransport),
        quickDirectPointIds: Array.isArray(point.quickDirectPointIds) ? [...point.quickDirectPointIds] : [],
      });
    } else {
      setEditingTripPoint(null);
      setTripPointForm({
        code: '',
        nameUk: '',
        sortOrder: (tripPoints[tripPoints.length - 1]?.sortOrder ?? 0) + 10,
        requiredOnTrip: false,
        appearInFromTo: true,
        appearInPoputky: false,
        hasLocalTransport: false,
        quickDirectPointIds: [],
      });
    }
    setIsTripPointModalOpen(true);
  };

  const handleSaveTripPoint = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingTripPoint) {
        await apiClient.updateTripPoint(editingTripPoint.id, tripPointForm);
      } else {
        await apiClient.createTripPoint(tripPointForm);
      }
      invalidateCatalogCache();
      setIsTripPointModalOpen(false);
      if (activeTab === 'routes') loadRoutesTab();
      else loadSchedules();
      setSuccess(editingTripPoint ? 'Місто оновлено' : 'Місто додано');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Помилка збереження міста');
    }
  };

  const handleDeleteTripPoint = async (point: TripPoint) => {
    if (!window.confirm(`Видалити місто «${point.nameUk}» (${point.code})?`)) return;
    try {
      await apiClient.deleteTripPoint(point.id);
      invalidateCatalogCache();
      if (activeTab === 'routes') loadRoutesTab();
      else loadSchedules();
      setSuccess('Місто видалено');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не вдалося видалити (можливо, місто вже використовується)');
    }
  };

  const openTripRouteModal = (route?: TripRoute) => {
    if (route) {
      setEditingTripRoute(route);
      const vias = (route.stops || [])
        .filter((s) => s.role === 'via')
        .sort((a, b) => a.position - b.position)
        .map((s) => s.pointId);
      setTripRouteForm({
        startPointId: route.startPointId,
        endPointId: route.endPointId,
        viaPointIds: vias,
        labelUk: route.labelUk,
        carDurationMinutes: route.carDurationMinutes ? String(route.carDurationMinutes) : '',
        stopOffsets: (route.stops || []).map((s) => ({
          pointId: s.pointId,
          departureOffsetMinutes: s.departureOffsetMinutes ?? null,
        })),
      });
    } else {
      setEditingTripRoute(null);
      setTripRouteForm({
        startPointId: tripPoints.find((p) => p.code === 'Kyiv')?.id,
        endPointId: tripPoints.find((p) => p.code === 'Korosten')?.id,
        viaPointIds: tripPoints.find((p) => p.code === 'Malyn')
          ? [tripPoints.find((p) => p.code === 'Malyn')!.id]
          : [],
        labelUk: '',
        carDurationMinutes: '',
        stopOffsets: [],
      });
    }
    setIsTripRouteModalOpen(true);
  };

  const handleSaveTripRoute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (tripRouteForm.startPointId == null || tripRouteForm.endPointId == null) {
      alert('Оберіть початкову і кінцеву точки');
      return;
    }
    try {
      const payload = {
        startPointId: tripRouteForm.startPointId,
        endPointId: tripRouteForm.endPointId,
        viaPointIds: tripRouteForm.viaPointIds,
        labelUk: tripRouteForm.labelUk.trim() || undefined,
        stopOffsets: tripRouteForm.stopOffsets,
      };
      // «Авто в дорозі»: порожнє поле прибирає значення
      const car = tripRouteForm.carDurationMinutes.trim();
      const carDurationMinutes = car ? Number(car) : null;
      if (carDurationMinutes != null && (!Number.isInteger(carDurationMinutes) || carDurationMinutes < 5 || carDurationMinutes > 1440)) {
        alert('Авто в дорозі: ціле число хвилин від 5 до 1440');
        return;
      }
      if (editingTripRoute) {
        await apiClient.updateTripRoute(editingTripRoute.id, { ...payload, carDurationMinutes });
      } else {
        const created = await apiClient.createTripRoute(payload);
        if (carDurationMinutes != null) await apiClient.updateTripRoute(created.id, { carDurationMinutes });
      }
      invalidateCatalogCache();
      setIsTripRouteModalOpen(false);
      loadRoutesTab();
      setSuccess(editingTripRoute ? 'Маршрут оновлено' : 'Маршрут створено');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Помилка збереження маршруту');
    }
  };

  const handleDeleteTripRoute = async (route: TripRoute) => {
    if (!window.confirm(`Видалити маршрут «${route.labelUk}» (${route.slug})?`)) return;
    try {
      await apiClient.deleteTripRoute(route.id);
      invalidateCatalogCache();
      loadRoutesTab();
      setSuccess('Маршрут видалено');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не вдалося видалити маршрут');
    }
  };

  const handleRebindScheduleTripRoutes = async () => {
    if (!window.confirm('Перепривʼязати TripRoute для всіх рейсів (route ↔ slug)?')) return;
    try {
      const result = await apiClient.rebindScheduleTripRoutes();
      setSuccess(
        `Перепривʼязка: оновлено ${result.updated}, без змін ${result.unchanged}` +
          (result.errors.length ? `, помилок ${result.errors.length}` : '')
      );
      loadSchedules();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Помилка перепривʼязки');
    }
  };

  const handleTimetablePreview = async (pages?: Array<{ url: string; html: string }>) => {
    setTimetablePreviewLoading(true);
    setError('');
    try {
      const preview = await apiClient.previewScheduleTimetable(pages?.length ? { pages } : undefined);
      setTimetablePreview(preview);
      setTimetableSelectedIds(
        new Set(preview.changes.filter((c) => c.status === 'changed').map((c) => c.scheduleId))
      );
      if (preview.changes.length === 0 && preview.errors.length === 0) {
        setSuccess('Немає рейсів з URL розкладу — додайте «URL розкладу (парсер)» у картці рейсу');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка превʼю розкладу');
    } finally {
      setTimetablePreviewLoading(false);
    }
  };

  const handleTimetableHtmlFile = async (url: string, file: File | undefined) => {
    if (!file) {
      setTimetableHtmlByUrl((prev) => {
        const next = { ...prev };
        delete next[url];
        return next;
      });
      return;
    }
    const html = await file.text();
    setTimetableHtmlByUrl((prev) => ({ ...prev, [url]: html }));
  };

  const handleTimetablePreviewFromHtml = async () => {
    if (!timetablePreview) return;
    const pages = timetablePreview.errors
      .map((e) => e.url)
      .filter((url, i, arr) => arr.indexOf(url) === i && timetableHtmlByUrl[url])
      .map((url) => ({ url, html: timetableHtmlByUrl[url]! }));
    if (pages.length === 0) {
      alert('Завантажте HTML хоча б для однієї сторінки УЗ');
      return;
    }
    await handleTimetablePreview(pages);
  };

  const handleTimetableApply = async () => {
    if (!timetablePreview) return;
    const ids = [...timetableSelectedIds];
    if (ids.length === 0) {
      alert('Оберіть хоча б один рейс зі змінами');
      return;
    }
    setTimetableApplyLoading(true);
    try {
      const result = await apiClient.applyScheduleTimetable({
        previewToken: timetablePreview.previewToken,
        scheduleIds: ids,
      });
      if (result.conflicts?.length) {
        alert(
          'Конфлікти часу (нічого не застосовано):\n' +
            result.conflicts.map((c) => `#${c.scheduleId}: ${c.error}`).join('\n')
        );
        return;
      }
      setTimetablePreview(null);
      setSuccess(`Оновлено графіків: ${result.updated}`);
      loadSchedules();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Помилка застосування');
    } finally {
      setTimetableApplyLoading(false);
    }
  };

  const openScheduleModal = (schedule?: Schedule) => {
    if (schedule) {
      setEditingSchedule(schedule);
      const stops = schedule.tripRoute?.stops ?? [];
      setScheduleForm({
        route: schedule.route,
        departureTime: schedule.departureTime,
        maxSeats: schedule.maxSeats,
        supportPhone: schedule.supportPhone ?? '',
        priceUah: schedule.priceUah ?? null,
        startPointId: schedule.startPointId ?? undefined,
        endPointId: schedule.endPointId ?? undefined,
        viaPointIds: Array.isArray(schedule.viaPointIds) ? schedule.viaPointIds : [],
        stopOffsets: stops.map((s) => ({
          pointId: s.pointId,
          departureOffsetMinutes: s.departureOffsetMinutes ?? null,
        })),
        vehicleType: schedule.vehicleType || 'marshrutka',
        boardingPlace: schedule.boardingPlace ?? '',
        alightingPlace: schedule.alightingPlace ?? '',
        tripNumber: schedule.tripNumber ?? '',
        arrivalTime: schedule.arrivalTime ?? '',
        durationMinutes: schedule.durationMinutes ?? null,
        ticketPurchaseUrl: schedule.ticketPurchaseUrl ?? '',
        timetableSourceUrl: schedule.timetableSourceUrl ?? '',
        activeWeekdays: Array.isArray(schedule.activeWeekdays)
          ? schedule.activeWeekdays
          : [1, 2, 3, 4, 5, 6, 7],
      });
    } else {
      setEditingSchedule(null);
      setScheduleForm(emptyScheduleForm());
    }
    setIsScheduleModalOpen(true);
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const saved = editingSchedule
        ? await apiClient.updateSchedule(editingSchedule.id, scheduleForm)
        : await apiClient.createSchedule(scheduleForm);
      setIsScheduleModalOpen(false);
      const label = saved.tripRoute?.labelUk || getRouteLabel(saved.route);
      const slug = saved.tripRoute?.slug || saved.route;
      setSuccess(`Рейс збережено: ${label} (${slug})`);
      loadSchedules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка збереження');
    }
  };

  const routeOptions = [...adminTripRoutes]
    .sort((a, b) => a.labelUk.localeCompare(b.labelUk, 'uk') || a.slug.localeCompare(b.slug))
    .map((r) => ({
      value: r.slug,
      label: r.labelUk || r.slug,
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
            className={`admin-tab ${activeTab === 'routes' ? 'active' : ''}`}
            onClick={() => setActiveTab('routes')}
          >
            Маршрути
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
            className={`admin-tab ${activeTab === 'referrals' ? 'active' : ''}`}
            onClick={() => setActiveTab('referrals')}
          >
            Реферали
          </button>
          <button
            className={`admin-tab ${activeTab === 'lunch' ? 'active' : ''}`}
            onClick={() => setActiveTab('lunch')}
          >
            Столова
          </button>
          <button
            className={`admin-tab ${activeTab === 'dzhura' ? 'active' : ''}`}
            onClick={() => setActiveTab('dzhura')}
          >
            Джура
          </button>
          <button
            className={`admin-tab ${activeTab === 'dovede' ? 'active' : ''}`}
            onClick={() => setActiveTab('dovede')}
          >
            Доведе
          </button>
          <button
            className={`admin-tab ${activeTab === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveTab('notifications')}
          >
            Сповіщення / SMS
          </button>
          <button
            className={`admin-tab ${activeTab === 'data' ? 'active' : ''}`}
            onClick={() => setActiveTab('data')}
          >
            Дані
          </button>
          <button
            className={`admin-tab ${activeTab === 'personArchive' ? 'active' : ''}`}
            onClick={() => setActiveTab('personArchive')}
          >
            Архів
          </button>
          <button
            className={`admin-tab ${activeTab === 'mapEditor' ? 'active' : ''}`}
            onClick={() => setActiveTab('mapEditor')}
          >
            Редактор карти
          </button>
          <button
            className={`admin-tab ${activeTab === 'scheduleEditor' ? 'active' : ''}`}
            onClick={() => setActiveTab('scheduleEditor')}
          >
            Графік транспорту
          </button>
          <button
            className={`admin-tab ${activeTab === 'stickers' ? 'active' : ''}`}
            onClick={() => setActiveTab('stickers')}
          >
            Наклейки зупинок
          </button>
          <button
            className={`admin-tab ${activeTab === 'arrivals' ? 'active' : ''}`}
            onClick={() => setActiveTab('arrivals')}
          >
            Факт прибуття
          </button>
          <button
            className={`admin-tab ${activeTab === 'userSenderErrors' ? 'active' : ''}`}
            onClick={() => setActiveTab('userSenderErrors')}
          >
            Помилки user-sender
          </button>
        </nav>

        {error && <Alert variant="error">{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}

        {activeTab === 'bookings' && <BookingsTab />}

        {activeTab === 'schedules' && (
          <div className="tab-content">
            <SchedulesTab
              schedules={schedules}
              loading={loading}
              routeOptions={routeOptions}
              routeFilter={scheduleRouteFilter}
              onRouteFilter={(next) => {
                setScheduleRouteFilter(next);
                loadSchedules(next);
              }}
              onReload={() => loadSchedules()}
              onAdd={() => openScheduleModal()}
              onEdit={(sch) => openScheduleModal(sch)}
              onDelete={(id) => handleDeleteSchedule(id)}
              onRebind={handleRebindScheduleTripRoutes}
              onParse={() => handleTimetablePreview()}
              parsing={timetablePreviewLoading}
              footer={<ZubastykPhonesPanel />}
            />
          </div>
        )}

        {activeTab === 'routes' && (
          <div className="tab-content">
            <RoutesTab
              points={tripPoints}
              routes={adminTripRoutes}
              loading={loading}
              onReload={loadRoutesTab}
              onAddPoint={() => openTripPointModal()}
              onEditPoint={(p) => openTripPointModal(p)}
              onDeletePoint={(p) => handleDeleteTripPoint(p)}
              onAddRoute={() => openTripRouteModal()}
              onEditRoute={(r) => openTripRouteModal(r)}
              onDeleteRoute={(r) => handleDeleteTripRoute(r)}
            />
          </div>
        )}

        {/* Viber оголошення */}
        {activeTab === 'viber' && <ViberTab />}

        {/* Реклама каналу (одноразово) */}
        {activeTab === 'promo' && <PromoTab section={section} />}

        {activeTab === 'data' && <PersonsTab />}

        {activeTab === 'personArchive' && <PersonArchiveTab />}

        {TRANSPORT_TABS.has(activeTab) && <TransportCityBar city={transportCity} onChange={setTransportCity} />}
        {/* key — місто: інше місто монтує вкладку наново, без залишків стану попереднього */}
        {activeTab === 'mapEditor' && <MapEditorTab key={transportCity} city={transportCity} />}
        {activeTab === 'scheduleEditor' && <ScheduleEditorTab key={transportCity} city={transportCity} />}
        {activeTab === 'stickers' && <StopStickerTab key={transportCity} city={transportCity} />}
        {activeTab === 'arrivals' && <ArrivalReportsTab key={transportCity} city={transportCity} />}

        {activeTab === 'referrals' && <ReferralTab section={section} />}

        {activeTab === 'lunch' && <LunchTab section={section} />}

        {activeTab === 'dzhura' && <DzhuraTab />}

        {activeTab === 'dovede' && (
          <Suspense fallback={<p>Завантаження…</p>}>
            <DovedeTab section={section} />
          </Suspense>
        )}

        {activeTab === 'notifications' && <NotificationSettingsTab />}

        {/* Помилки відправки через персональний акаунт (PRIVACY_PREMIUM_REQUIRED тощо) */}
        {activeTab === 'userSenderErrors' && (
          <div className="tab-content">
            <h3 style={{ marginBottom: '8px' }}>Помилки user-sender (персональний акаунт)</h3>
            <p style={{ marginBottom: '12px', color: 'var(--color-text-secondary, #666)' }}>
              Контакти, до яких не вдалося надіслати повідомлення через send_message.py (наприклад PRIVACY_PREMIUM_REQUIRED).
            </p>
            <div style={{ marginBottom: '16px', display: 'flex', gap: '8px' }}>
              <Button variant="secondary" onClick={loadUserSenderErrors} disabled={userSenderErrorsLoading}>
                {userSenderErrorsLoading ? 'Завантаження...' : 'Оновити'}
              </Button>
              <Button
                variant="secondary"
                onClick={handleClearUserSenderErrors}
                disabled={userSenderErrorsClearing || userSenderErrors.length === 0}
                title="Видалити всі записи"
              >
                {userSenderErrorsClearing ? 'Обнулення...' : 'Обнулити'}
              </Button>
            </div>
            {userSenderErrorsLoading ? (
              <div className="admin-loading">Завантаження...</div>
            ) : userSenderErrors.length === 0 ? (
              <div className="admin-empty">
                <p className="admin-empty-text">Немає записів</p>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Контакт</th>
                      <th>Тип</th>
                      <th>Код</th>
                      <th>Помилка</th>
                      <th>Дата</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userSenderErrors.map((r) => (
                      <tr key={r.id}>
                        <td>#{r.id}</td>
                        <td>{r.contact}</td>
                        <td>{r.contactType}</td>
                        <td>{r.errorCode}</td>
                        <td>
                          <div
                            title={r.errorText ?? ''}
                            style={{
                              maxWidth: '500px',
                              maxHeight: '120px',
                              overflow: 'auto',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              fontSize: '12px',
                            }}
                          >
                            {r.errorText ?? '—'}
                          </div>
                        </td>
                        <td>{new Date(r.createdAt).toLocaleString('uk-UA')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Модальне вікно для міста */}
        {isTripPointModalOpen && (
          <div className="modal" onClick={(e) => e.target === e.currentTarget && setIsTripPointModalOpen(false)}>
            <div className="modal-content">
              <div className="modal-header">
                <h2>{editingTripPoint ? `Редагувати місто #${editingTripPoint.id}` : 'Додати місто'}</h2>
                <button className="close-btn" onClick={() => setIsTripPointModalOpen(false)}>
                  &times;
                </button>
              </div>
              <form onSubmit={handleSaveTripPoint}>
                <Input
                  label="Code * (латиниця, унікальний)"
                  value={tripPointForm.code}
                  onChange={(e) => setTripPointForm({ ...tripPointForm, code: e.target.value })}
                  required
                  placeholder="Zviahel"
                />
                <Input
                  label="Назва (uk) *"
                  value={tripPointForm.nameUk}
                  onChange={(e) => setTripPointForm({ ...tripPointForm, nameUk: e.target.value })}
                  required
                  placeholder="Звягель"
                />
                <Input
                  label="Sort order"
                  type="number"
                  value={tripPointForm.sortOrder}
                  onChange={(e) =>
                    setTripPointForm({ ...tripPointForm, sortOrder: Number(e.target.value) || 0 })
                  }
                />
                <label className="admin-checkbox" style={{ display: 'block', marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={tripPointForm.requiredOnTrip}
                    onChange={(e) =>
                      setTripPointForm({ ...tripPointForm, requiredOnTrip: e.target.checked })
                    }
                  />
                  <span>Обовʼязкова на рейсі</span>
                </label>
                <label className="admin-checkbox" style={{ display: 'block', marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={tripPointForm.appearInFromTo}
                    onChange={(e) =>
                      setTripPointForm({ ...tripPointForm, appearInFromTo: e.target.checked })
                    }
                  />
                  <span>У «звідки/куди» (маршрутки)</span>
                </label>
                <label className="admin-checkbox" style={{ display: 'block', marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={tripPointForm.appearInPoputky}
                    onChange={(e) =>
                      setTripPointForm({ ...tripPointForm, appearInPoputky: e.target.checked })
                    }
                  />
                  <span>У попутках</span>
                </label>
                <label className="admin-checkbox" style={{ display: 'block', marginBottom: 8 }}>
                  <input
                    type="checkbox"
                    checked={tripPointForm.hasLocalTransport}
                    onChange={(e) =>
                      setTripPointForm({ ...tripPointForm, hasLocalTransport: e.target.checked })
                    }
                  />
                  <span>Є локальний транспорт (міські маршрутки)</span>
                </label>
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                    Швидкі напрямки (без пересадки) для чипів на сайті
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {tripPoints
                      .filter((p) => p.id !== editingTripPoint?.id)
                      .map((p) => {
                        const checked = tripPointForm.quickDirectPointIds.includes(p.id);
                        return (
                          <label key={p.id} className="admin-checkbox">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setTripPointForm({
                                  ...tripPointForm,
                                  quickDirectPointIds: checked
                                    ? tripPointForm.quickDirectPointIds.filter((id) => id !== p.id)
                                    : [...tripPointForm.quickDirectPointIds, p.id],
                                });
                              }}
                            />
                            <span>{p.nameUk}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
                <div className="form-actions">
                  <Button type="button" variant="secondary" onClick={() => setIsTripPointModalOpen(false)}>
                    Скасувати
                  </Button>
                  <Button type="submit">Зберегти</Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isTripRouteModalOpen && (
          <div className="modal" onClick={(e) => e.target === e.currentTarget && setIsTripRouteModalOpen(false)}>
            <div className="modal-content">
              <div className="modal-header">
                <h2>{editingTripRoute ? `Редагувати маршрут #${editingTripRoute.id}` : 'Додати маршрут'}</h2>
                <button className="close-btn" onClick={() => setIsTripRouteModalOpen(false)}>
                  &times;
                </button>
              </div>
              <form onSubmit={handleSaveTripRoute}>
                {editingTripRoute && (
                  <p style={{ marginTop: 0, fontSize: 13, color: '#666' }}>
                    Slug: <code>{editingTripRoute.slug}</code>
                  </p>
                )}
                <Select
                  label="Початкова точка *"
                  options={tripPoints.map((p) => ({ value: String(p.id), label: `${p.nameUk} (${p.code})` }))}
                  value={tripRouteForm.startPointId != null ? String(tripRouteForm.startPointId) : ''}
                  onChange={(e) =>
                    setTripRouteForm({
                      ...tripRouteForm,
                      startPointId: Number(e.target.value) || undefined,
                    })
                  }
                  required
                />
                <Select
                  label="Кінцева точка *"
                  options={tripPoints.map((p) => ({ value: String(p.id), label: `${p.nameUk} (${p.code})` }))}
                  value={tripRouteForm.endPointId != null ? String(tripRouteForm.endPointId) : ''}
                  onChange={(e) =>
                    setTripRouteForm({
                      ...tripRouteForm,
                      endPointId: Number(e.target.value) || undefined,
                    })
                  }
                  required
                />
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label>Проміжні точки (via)</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {tripPoints
                      .filter(
                        (p) => p.id !== tripRouteForm.startPointId && p.id !== tripRouteForm.endPointId
                      )
                      .map((p) => {
                        const checked = tripRouteForm.viaPointIds.includes(p.id);
                        return (
                          <label key={p.id} className="admin-checkbox">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                const cur = tripRouteForm.viaPointIds;
                                setTripRouteForm({
                                  ...tripRouteForm,
                                  viaPointIds: checked
                                    ? cur.filter((id) => id !== p.id)
                                    : [...cur, p.id],
                                });
                              }}
                            />
                            <span>{p.nameUk}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
                <Input
                  label="Назва (uk)"
                  value={tripRouteForm.labelUk}
                  onChange={(e) => setTripRouteForm({ ...tripRouteForm, labelUk: e.target.value })}
                  placeholder="Київ — Коростень (через Малин)"
                />
                <Input
                  label="Авто в дорозі, хв"
                  type="number"
                  min={5}
                  max={1440}
                  value={tripRouteForm.carDurationMinutes}
                  onChange={(e) => setTripRouteForm({ ...tripRouteForm, carDurationMinutes: e.target.value })}
                  placeholder="95"
                />
                <p style={{ margin: '-6px 0 12px', fontSize: 13, color: '#666' }}>
                  Скільки їде легковик — з цього «Доведе» рахує час прибуття попуток, коли сервіс заторів не відповів.
                  Порожньо — 1 год 35 хв.
                </p>
                <div className="form-group" style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                    Зсув часу посадки на зупинках (хв від старту)
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {[
                      tripRouteForm.startPointId,
                      ...tripRouteForm.viaPointIds,
                      tripRouteForm.endPointId,
                    ]
                      .filter((id): id is number => id != null)
                      .map((pointId) => {
                        const p = tripPoints.find((x) => x.id === pointId);
                        const cur =
                          tripRouteForm.stopOffsets.find((s) => s.pointId === pointId)
                            ?.departureOffsetMinutes ?? '';
                        return (
                          <label
                            key={pointId}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}
                          >
                            <span style={{ minWidth: 120 }}>{p?.nameUk || `#${pointId}`}</span>
                            <input
                              type="number"
                              min={0}
                              placeholder="0"
                              value={cur === null || cur === undefined ? '' : cur}
                              onChange={(e) => {
                                const val =
                                  e.target.value === ''
                                    ? null
                                    : Math.max(0, Math.round(Number(e.target.value)));
                                const rest = tripRouteForm.stopOffsets.filter(
                                  (s) => s.pointId !== pointId
                                );
                                setTripRouteForm({
                                  ...tripRouteForm,
                                  stopOffsets: [...rest, { pointId, departureOffsetMinutes: val }],
                                });
                              }}
                              style={{ width: 80, padding: '4px 8px' }}
                            />
                            <span style={{ color: '#666', fontSize: 12 }}>хв</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
                <div className="form-actions">
                  <Button type="button" variant="secondary" onClick={() => setIsTripRouteModalOpen(false)}>
                    Скасувати
                  </Button>
                  <Button type="submit">Зберегти</Button>
                </div>
              </form>
            </div>
          </div>
        )}

        {isScheduleModalOpen && (
          <div className="modal" onClick={(e) => e.target === e.currentTarget && setIsScheduleModalOpen(false)}>
            <div className="modal-content modal-content--schedule">
              <div className="modal-header">
                <h2>{editingSchedule ? 'Редагувати рейс' : 'Додати рейс'}</h2>
                <button className="close-btn" onClick={() => setIsScheduleModalOpen(false)}>
                  &times;
                </button>
              </div>
              <form onSubmit={handleSaveSchedule} className="schedule-form">
                <div className="schedule-form-grid">
                  <section className="schedule-form-col" aria-labelledby="schedule-route-heading">
                    <h3 id="schedule-route-heading" className="schedule-form-section-title">
                      Маршрут
                    </h3>
                    <Select
                      label="Тип рейсу *"
                      options={[
                        { value: 'marshrutka', label: 'Маршрутка' },
                        { value: 'elektrichka', label: 'Електричка' },
                      ]}
                      value={scheduleForm.vehicleType || 'marshrutka'}
                      onChange={(e) => setScheduleForm({ ...scheduleForm, vehicleType: e.target.value })}
                      required
                    />
                    <div className="schedule-form-pair">
                      <Select
                        label="Звідки *"
                        options={tripPoints.map((p) => ({
                          value: String(p.id),
                          label: `${p.nameUk} (${p.code})`,
                        }))}
                        value={scheduleForm.startPointId != null ? String(scheduleForm.startPointId) : ''}
                        onChange={(e) =>
                          setScheduleForm({
                            ...scheduleForm,
                            startPointId: Number(e.target.value) || undefined,
                          })
                        }
                        required
                      />
                      <Select
                        label="Куди *"
                        options={tripPoints.map((p) => ({
                          value: String(p.id),
                          label: `${p.nameUk} (${p.code})`,
                        }))}
                        value={scheduleForm.endPointId != null ? String(scheduleForm.endPointId) : ''}
                        onChange={(e) =>
                          setScheduleForm({
                            ...scheduleForm,
                            endPointId: Number(e.target.value) || undefined,
                          })
                        }
                        required
                      />
                    </div>
                    <div className="form-group schedule-form-block">
                      <label>Проміжні точки</label>
                      <div className="schedule-chip-row">
                        {tripPoints
                          .filter(
                            (p) => p.id !== scheduleForm.startPointId && p.id !== scheduleForm.endPointId
                          )
                          .map((p) => {
                            const checked = (scheduleForm.viaPointIds || []).includes(p.id);
                            return (
                              <label key={p.id} className="admin-checkbox">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const cur = scheduleForm.viaPointIds || [];
                                    setScheduleForm({
                                      ...scheduleForm,
                                      viaPointIds: checked
                                        ? cur.filter((id) => id !== p.id)
                                        : [...cur, p.id],
                                    });
                                  }}
                                />
                                <span>{p.nameUk}</span>
                              </label>
                            );
                          })}
                      </div>
                    </div>
                    <div className="form-group schedule-form-block">
                      <label>Зсув посадки (хв від старту)</label>
                      <div className="schedule-offset-list">
                        {[
                          scheduleForm.startPointId,
                          ...(scheduleForm.viaPointIds || []),
                          scheduleForm.endPointId,
                        ]
                          .filter((id): id is number => id != null)
                          .map((pointId) => {
                            const p = tripPoints.find((x) => x.id === pointId);
                            const cur =
                              scheduleForm.stopOffsets?.find((s) => s.pointId === pointId)
                                ?.departureOffsetMinutes ?? '';
                            return (
                              <label key={pointId} className="schedule-offset-row">
                                <span>{p?.nameUk || `#${pointId}`}</span>
                                <input
                                  type="number"
                                  min={0}
                                  placeholder="0"
                                  value={cur === null || cur === undefined ? '' : cur}
                                  onChange={(e) => {
                                    const val =
                                      e.target.value === ''
                                        ? null
                                        : Math.max(0, Math.round(Number(e.target.value)));
                                    const rest = (scheduleForm.stopOffsets || []).filter(
                                      (s) => s.pointId !== pointId
                                    );
                                    setScheduleForm({
                                      ...scheduleForm,
                                      stopOffsets: [...rest, { pointId, departureOffsetMinutes: val }],
                                    });
                                  }}
                                />
                                <span className="schedule-offset-unit">хв</span>
                              </label>
                            );
                          })}
                      </div>
                    </div>
                  </section>

                  <section className="schedule-form-col" aria-labelledby="schedule-ops-heading">
                    <h3 id="schedule-ops-heading" className="schedule-form-section-title">
                      Час і деталі
                    </h3>
                    <div className="schedule-form-pair">
                      <Input
                        label="Відправлення * (HH:MM)"
                        type="text"
                        placeholder="08:00"
                        value={scheduleForm.departureTime}
                        onChange={(e) =>
                          setScheduleForm({ ...scheduleForm, departureTime: e.target.value })
                        }
                        pattern="^([0-1][0-9]|2[0-3]):[0-5][0-9]$"
                        required
                      />
                      <Input
                        label="Прибуття (HH:MM)"
                        type="text"
                        placeholder="10:00"
                        value={scheduleForm.arrivalTime ?? ''}
                        onChange={(e) =>
                          setScheduleForm({ ...scheduleForm, arrivalTime: e.target.value })
                        }
                      />
                    </div>
                    <Input
                      label="Тривалість, хв (якщо немає прибуття)"
                      type="number"
                      min={0}
                      value={scheduleForm.durationMinutes ?? ''}
                      onChange={(e) =>
                        setScheduleForm({
                          ...scheduleForm,
                          durationMinutes: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                    <div className="form-group schedule-form-block">
                      <label>Дні тижня</label>
                      <div className="schedule-chip-row">
                        {[
                          [1, 'Пн'],
                          [2, 'Вт'],
                          [3, 'Ср'],
                          [4, 'Чт'],
                          [5, 'Пт'],
                          [6, 'Сб'],
                          [7, 'Нд'],
                        ].map(([d, label]) => {
                          const day = Number(d);
                          const checked = (scheduleForm.activeWeekdays || []).includes(day);
                          return (
                            <label key={day} className="admin-checkbox">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const cur = scheduleForm.activeWeekdays || [];
                                  setScheduleForm({
                                    ...scheduleForm,
                                    activeWeekdays: checked
                                      ? cur.filter((x) => x !== day)
                                      : [...cur, day].sort((a, b) => a - b),
                                  });
                                }}
                              />
                              <span>{label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <div className="schedule-form-pair">
                      <Input
                        label="Місце посадки"
                        type="text"
                        value={scheduleForm.boardingPlace ?? ''}
                        onChange={(e) =>
                          setScheduleForm({ ...scheduleForm, boardingPlace: e.target.value })
                        }
                      />
                      <Input
                        label="Місце висадки"
                        type="text"
                        value={scheduleForm.alightingPlace ?? ''}
                        onChange={(e) =>
                          setScheduleForm({ ...scheduleForm, alightingPlace: e.target.value })
                        }
                      />
                    </div>
                    {scheduleForm.vehicleType === 'elektrichka' ? (
                      <>
                        <Input
                          label="Номер рейсу"
                          type="text"
                          value={scheduleForm.tripNumber ?? ''}
                          onChange={(e) =>
                            setScheduleForm({ ...scheduleForm, tripNumber: e.target.value })
                          }
                        />
                        <Input
                          label="Посилання на квиток *"
                          type="url"
                          required
                          value={scheduleForm.ticketPurchaseUrl ?? ''}
                          onChange={(e) =>
                            setScheduleForm({ ...scheduleForm, ticketPurchaseUrl: e.target.value })
                          }
                        />
                        <Input
                          label="URL розкладу (парсер)"
                          type="url"
                          placeholder="https://swrailway.gov.ua/timetable/eltrain/?..."
                          value={scheduleForm.timetableSourceUrl ?? ''}
                          onChange={(e) =>
                            setScheduleForm({ ...scheduleForm, timetableSourceUrl: e.target.value })
                          }
                        />
                        <p className="modal-hint" style={{ marginTop: -4 }}>
                          Сторінка SW Railway eltrain (`reverse=1` Київ→Малин, `reverse=2` Малин→Київ).
                          Для Києва в «Місце посадки» вкажіть старт: Київ-Пас. / Борщагівка / Святошин.
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="schedule-form-pair">
                          <Input
                            label="Місць *"
                            type="number"
                            min={1}
                            max={100}
                            value={scheduleForm.maxSeats}
                            onChange={(e) =>
                              setScheduleForm({
                                ...scheduleForm,
                                maxSeats: Number(e.target.value),
                              })
                            }
                            required
                          />
                          <Input
                            label="Ціна, грн"
                            type="number"
                            min={0}
                            max={9999}
                            placeholder={String(KYIV_MALYN_FARE_UAH)}
                            value={scheduleForm.priceUah ?? ''}
                            onChange={(e) =>
                              setScheduleForm({
                                ...scheduleForm,
                                priceUah: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                          />
                        </div>
                        <Input
                          label="Телефон підтримки"
                          type="text"
                          placeholder="+380(93)1701835"
                          value={scheduleForm.supportPhone ?? ''}
                          onChange={(e) =>
                            setScheduleForm({ ...scheduleForm, supportPhone: e.target.value })
                          }
                        />
                      </>
                    )}
                  </section>
                </div>
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

        {timetablePreview && (
          <div className="modal" onClick={(e) => e.target === e.currentTarget && setTimetablePreview(null)}>
            <div className="modal-content modal-content--schedule">
              <div className="modal-header">
                <h2>Оновлення графіків (парсер)</h2>
                <button className="close-btn" onClick={() => setTimetablePreview(null)}>
                  &times;
                </button>
              </div>
              <p className="modal-hint">
                Зміниться {timetablePreview.summary.changed}, без змін {timetablePreview.summary.unchanged},
                не знайдено {timetablePreview.summary.notFound}, неоднозначно{' '}
                {timetablePreview.summary.ambiguous}
                {timetablePreview.summary.errors
                  ? `, помилок URL ${timetablePreview.summary.errors}`
                  : ''}
                . Застосування — одна транзакція; при конфлікті часу нічого не пишеться.
              </p>
              {timetablePreview.errors.length > 0 && (
                <Alert variant="error">
                  Європейський хостинг не дістає swrailway.gov.ua (УЗ блокує з-за кордону). У браузері
                  відкрийте сторінку → Зберегти як → «Веб-сторінка, лише HTML», потім завантажте файл
                  сюди.
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    {timetablePreview.errors.map((e) => `${eltrainPageLabel(e.url)}: ${e.error}`).join(' · ')}
                  </div>
                </Alert>
              )}
              {timetablePreview.errors.length > 0 && (
                <div style={{ margin: '12px 0', display: 'grid', gap: 10 }}>
                  {[...new Set(timetablePreview.errors.map((e) => e.url))].map((url) => (
                    <label key={url} style={{ display: 'grid', gap: 4, fontSize: 13 }}>
                      <span>
                        {eltrainPageLabel(url)}{' '}
                        <a href={url} target="_blank" rel="noreferrer">
                          відкрити
                        </a>
                        {timetableHtmlByUrl[url]
                          ? ` · файл ${(timetableHtmlByUrl[url].length / 1024).toFixed(0)} КБ`
                          : ''}
                      </span>
                      <input
                        type="file"
                        accept=".html,.htm,text/html"
                        onChange={(e) => handleTimetableHtmlFile(url, e.target.files?.[0])}
                      />
                    </label>
                  ))}
                  <Button
                    type="button"
                    onClick={handleTimetablePreviewFromHtml}
                    disabled={
                      timetablePreviewLoading ||
                      ![...new Set(timetablePreview.errors.map((e) => e.url))].every(
                        (url) => timetableHtmlByUrl[url]
                      )
                    }
                  >
                    {timetablePreviewLoading ? 'Парсинг…' : 'Превʼю з HTML'}
                  </Button>
                </div>
              )}
              <div className="table-container" style={{ maxHeight: '50vh', overflow: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>ID</th>
                      <th>№</th>
                      <th>Маршрут</th>
                      <th>Статус</th>
                      <th>Було → стане</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timetablePreview.changes.map((row) => {
                      const selectable = row.status === 'changed';
                      const checked = timetableSelectedIds.has(row.scheduleId);
                      const fmtDays = (d: number[]) => (d?.length ? d.join(',') : '—');
                      const diffLines = [
                        row.before.departureTime !== row.after.departureTime
                          ? `відпр. ${row.before.departureTime || '—'} → ${row.after.departureTime || '—'}`
                          : null,
                        (row.before.arrivalTime || '') !== (row.after.arrivalTime || '')
                          ? `приб. ${row.before.arrivalTime || '—'} → ${row.after.arrivalTime || '—'}`
                          : null,
                        fmtDays(row.before.activeWeekdays) !== fmtDays(row.after.activeWeekdays)
                          ? `дні ${fmtDays(row.before.activeWeekdays)} → ${fmtDays(row.after.activeWeekdays)}`
                          : null,
                        (row.before.alightingPlace || '') !== (row.after.alightingPlace || '')
                          ? `висадка ${row.before.alightingPlace || '—'} → ${row.after.alightingPlace || '—'}`
                          : null,
                      ].filter(Boolean);
                      return (
                        <tr
                          key={row.scheduleId}
                          style={
                            row.status === 'changed'
                              ? { background: 'rgba(26, 115, 232, 0.06)' }
                              : undefined
                          }
                        >
                          <td>
                            <input
                              type="checkbox"
                              disabled={!selectable}
                              checked={checked}
                              onChange={() => {
                                setTimetableSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(row.scheduleId)) next.delete(row.scheduleId);
                                  else next.add(row.scheduleId);
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td>#{row.scheduleId}</td>
                          <td>{row.tripNumber}</td>
                          <td style={{ fontSize: 12 }}>{row.route}</td>
                          <td style={{ fontSize: 12 }}>{row.status}</td>
                          <td style={{ fontSize: 12 }}>
                            {row.status === 'unchanged'
                              ? 'без змін'
                              : diffLines.length
                                ? diffLines.join('; ')
                                : row.after.daysNote || row.status}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {timetablePreview.pageTrainsUnmatched.length > 0 && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: 'pointer' }}>
                    Потяги на сторінці без рейсу в БД ({timetablePreview.pageTrainsUnmatched.length})
                  </summary>
                  <ul style={{ fontSize: 13, marginTop: 8 }}>
                    {timetablePreview.pageTrainsUnmatched.slice(0, 40).map((t) => (
                      <li key={`${t.url}-${t.tripNumber}`}>
                        {t.tripNumber} — {t.daysNote}
                        {t.destinationLabel ? ` (${t.destinationLabel})` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="form-actions">
                <Button type="button" variant="secondary" onClick={() => setTimetablePreview(null)}>
                  Скасувати
                </Button>
                <Button
                  type="button"
                  onClick={handleTimetableApply}
                  disabled={timetableApplyLoading || timetableSelectedIds.size === 0}
                >
                  {timetableApplyLoading
                    ? 'Застосування…'
                    : `Застосувати вибрані (${timetableSelectedIds.size})`}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
