import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Select } from '@/components/Select';
import { Input } from '@/components/Input';
import { AdminSectionHeader, ChipGroup, StatTile, StatTiles, StatusPill } from './kit';
import { transportCitySearch } from './useAdminTransportCity';
import { apiClient } from '@/api/client';
import { DEFAULT_TRANSPORT_CITY } from '@/site/transportCity';
import { SourceWatchPanel } from './SourceWatchPanel';
import { GpsRunTimesPanel } from './GpsRunTimesPanel';
import { datasetSaveErrorMessage, type TransportDataset, type TransportRouteDto, type TransportTripDto } from '@/api/transportDataset';
import { broadcastTransportDatasetInvalidate } from '../LocalTransportPage/dataset/useTransportDataset';
import {
  autoHeadsign,
  buildSegmentLookup,
  clockAtStop,
  compareTripsByDeparture,
  computeTripTimes,
  nextOppositeDeparture,
  nextTripId,
  parseClockToMinutes,
  FALLBACK_DEFAULT_SEGMENT_SEC,
} from './scheduleEditorTiming';
import {
  MAIN_PATH,
  canSetTimepoint,
  moveTripToPath,
  parseVariantsText,
  pathChain,
  setTimepoint,
  timepointAt,
  tripPath,
  variantsForDirection,
  variantsToText,
} from './scheduleEditorVariants';
import type { TripTiming } from '../LocalTransportPage/dataset/tripTiming';
import './ScheduleEditorTab.css';

/** Номер маршруту для показу з форми (ще не збережений) — «11/1 (id 11)»; без номера — id */
function formRouteNo(r: Pick<TransportRouteDto, 'id' | 'shortName'>): string {
  const no = (r.shortName ?? '').trim();
  return no && no !== r.id ? `${no} (id ${r.id})` : r.id;
}

type DirectionMode = 'there' | 'back';

const directionToId: Record<DirectionMode, string> = { there: '1', back: '0' };

interface AddTripForm {
  time: string;
  headsign: string;
  serviceId: string;
}

const SERVICE_OPTIONS = [
  { value: 'everyday', label: 'Щодня' },
  { value: 'weekdays', label: 'Будні' },
  { value: 'weekends', label: 'Вихідні' },
];

const EMPTY_ADD_FORM: AddTripForm = { time: '', headsign: '', serviceId: 'everyday' };

/** Значення селекта «Кінцева» для власного тексту таблички */
const OTHER_HEADSIGN = '__other__';

/** Людське розписання маршруту (JSON) → текст для textarea */
function scheduleToText(schedule: unknown): string {
  return schedule == null ? '' : JSON.stringify(schedule, null, 2);
}

const BASE = '/admin/route-schedule';
type EditorSection = '' | 'sources' | 'gps';
const SECTIONS: ReadonlyArray<{ slug: EditorSection; label: string }> = [
  { slug: '', label: 'Розклад' },
  { slug: 'sources', label: 'Джерела розкладу' },
  { slug: 'gps', label: 'Час у дорозі за GPS' },
];

/**
 * «Графік транспорту» (`/admin/route-schedule/<розділ>?city=`): розклад маршрутів міста (сітка «зупинки × рейси»),
 * джерела розкладу (SourceWatchPanel) і час у дорозі за GPS (GpsRunTimesPanel). Угорі — плитки й позначка
 * незбережених змін; маршрут, напрямок і шлях — чіпами. city — місто датасету (перемикач над вкладками); без нього — Малин.
 */
export const ScheduleEditorTab: React.FC<{ city?: string; section?: string }> = ({ city = DEFAULT_TRANSPORT_CITY, section = '' }) => {
  const editorSection: EditorSection = section === 'sources' || section === 'gps' ? section : '';
  const [baseDataset, setBaseDataset] = useState<TransportDataset | null>(null);
  const [routes, setRoutes] = useState<TransportRouteDto[]>([]);
  const [trips, setTrips] = useState<TransportTripDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [selectedRoute, setSelectedRoute] = useState('');
  const [directionMode, setDirectionMode] = useState<DirectionMode>('there');
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddTripForm>(EMPTY_ADD_FORM);
  const [addError, setAddError] = useState('');
  /** Чернетки JSON-розкладу по маршрутах (текст у textarea) і помилки парсингу */
  const [scheduleDrafts, setScheduleDrafts] = useState<Record<string, string>>({});
  const [scheduleErrors, setScheduleErrors] = useState<Record<string, string>>({});
  /** Рейси, для яких табличка редагується як текст («Інше…»), а не береться з кінцевої */
  const [customHeadsign, setCustomHeadsign] = useState<Record<string, boolean>>({});
  /** Шлях у сітці: основний ланцюжок напрямку (MAIN_PATH) або id варіанта шляху */
  const [pathMode, setPathMode] = useState<string>(MAIN_PATH);
  /** Чернетки JSON варіантів шляху по маршрутах і помилки їх розбору */
  const [variantDrafts, setVariantDrafts] = useState<Record<string, string>>({});
  const [variantErrors, setVariantErrors] = useState<Record<string, string>>({});
  /** Клітинки сітки — поля опорних часів (час з листка на зупинці) замість розрахованого часу */
  const [timepointsMode, setTimepointsMode] = useState(false);

  const loadFromDb = useCallback(async () => {
    setLoading(true);
    setError('');
    setStatusMsg('');
    try {
      // Повз HTTP-кеш: revision має бути свіжою, інакше перше ж збереження отримає 409
      const dataset = await apiClient.getTransportDataset({ fresh: true, city });
      setBaseDataset(dataset);
      setRoutes(dataset.routes);
      setTrips(dataset.trips);
      setScheduleDrafts({});
      setScheduleErrors({});
      setVariantDrafts({});
      setVariantErrors({});
      setCustomHeadsign({});
      setPathMode(MAIN_PATH);
      setSelectedRoute((prev) => {
        if (prev && dataset.routes.some((r) => r.id === prev)) return prev;
        const sorted = [...dataset.routes].sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
        return sorted[0]?.id ?? '';
      });
      setStatusMsg('Завантажено з бази');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося завантажити дані з бази');
    } finally {
      setLoading(false);
    }
  }, [city]);

  useEffect(() => {
    void loadFromDb();
  }, [loadFromDb]);

  const handleReloadFromDb = useCallback(async () => {
    if (!window.confirm('Завантажити з бази? Несхоронені зміни графіка та даних маршрутів буде втрачено.')) return;
    await loadFromDb();
  }, [loadFromDb]);

  const scheduleHasErrors = useMemo(
    () => Object.values(scheduleErrors).some((e) => Boolean(e)) || Object.values(variantErrors).some((e) => Boolean(e)),
    [scheduleErrors, variantErrors]
  );

  const handleSaveToDb = useCallback(async () => {
    if (!baseDataset) return;
    if (scheduleHasErrors) {
      setError('Виправте JSON розкладу чи варіантів шляху маршруту перед збереженням.');
      return;
    }
    if (
      !window.confirm(
        'Зберегти графік і дані маршрутів у базу? Несхоронені правки інших вкладок (карта, зупинки) не торкаються — береться те, що вже в базі.'
      )
    ) {
      return;
    }
    setSaving(true);
    setError('');
    setStatusMsg('');
    try {
      const merged: TransportDataset = { ...baseDataset, routes, trips };
      const result = await apiClient.putTransportDataset(merged, baseDataset.revision, city);
      setBaseDataset({ ...merged, revision: result.revision ?? null });
      broadcastTransportDatasetInvalidate();
      const variantsNote = result.counts.variants ? `, ${result.counts.variants} варіантів шляху` : '';
      setStatusMsg(`Збережено: ${result.counts.routes} маршрутів, ${result.counts.trips} рейсів${variantsNote}`);
    } catch (err) {
      setError(datasetSaveErrorMessage(err, 'Не вдалося зберегти графік у базу'));
    } finally {
      setSaving(false);
    }
  }, [baseDataset, routes, trips, scheduleHasErrors, city]);

  const selectedRouteObj = useMemo(
    () => routes.find((r) => r.id === selectedRoute) ?? null,
    [routes, selectedRoute]
  );

  const updateRoute = useCallback((routeId: string, patch: Partial<TransportRouteDto>) => {
    setRoutes((prev) => prev.map((r) => (r.id === routeId ? { ...r, ...patch } : r)));
  }, []);

  const handleScheduleTextChange = useCallback(
    (routeId: string, text: string) => {
      setScheduleDrafts((prev) => ({ ...prev, [routeId]: text }));
      if (!text.trim()) {
        setScheduleErrors((prev) => ({ ...prev, [routeId]: '' }));
        updateRoute(routeId, { schedule: null });
        return;
      }
      try {
        const parsed: unknown = JSON.parse(text);
        setScheduleErrors((prev) => ({ ...prev, [routeId]: '' }));
        updateRoute(routeId, { schedule: parsed });
      } catch (err) {
        setScheduleErrors((prev) => ({
          ...prev,
          [routeId]: `Некоректний JSON: ${err instanceof Error ? err.message : String(err)}`,
        }));
      }
    },
    [updateRoute]
  );

  /** JSON варіантів шляху маршруту: розібраний — у маршрут; з помилкою — лише чернетка (збереження заблоковане) */
  const handleVariantsTextChange = useCallback(
    (routeId: string, text: string) => {
      setVariantDrafts((prev) => ({ ...prev, [routeId]: text }));
      const parsed = parseVariantsText(text);
      setVariantErrors((prev) => ({ ...prev, [routeId]: parsed.error }));
      if (parsed.variants) updateRoute(routeId, { variants: parsed.variants });
    },
    [updateRoute]
  );

  // Інший маршрут чи напрямок — сітка з основного шляху
  useEffect(() => {
    setPathMode(MAIN_PATH);
  }, [selectedRoute, directionMode]);

  const stopNameById = useMemo(() => {
    const map = new Map<string, string>();
    baseDataset?.stops.forEach((s) => map.set(s.id, s.name));
    return map;
  }, [baseDataset]);

  /** Варіанти шляху маршруту в цьому напрямку і обраний у перемикачі «Шлях» (null — основний ланцюжок) */
  const directionVariants = useMemo(
    () => variantsForDirection(selectedRouteObj, directionToId[directionMode]),
    [selectedRouteObj, directionMode]
  );
  const activeVariant = useMemo(
    () => directionVariants.find((v) => v.id === pathMode) ?? null,
    [directionVariants, pathMode]
  );

  /**
   * Ланцюжок шляху з технічними точками — для розрахунку часу; пасажирські зупинки — рядки таблиці
   * та селекти «З»/«Кінцева»
   */
  const { chain: chainStopIds, passengers: passengerStopIds } = useMemo(
    () =>
      baseDataset && selectedRoute
        ? pathChain(baseDataset.routeStops, selectedRoute, directionToId[directionMode], activeVariant)
        : { chain: [], passengers: [] },
    [baseDataset, selectedRoute, directionMode, activeVariant]
  );

  const routeStopCount = useMemo(
    () =>
      baseDataset
        ? baseDataset.routeStops.filter((rs) => rs.routeId === selectedRoute && !rs.mapOnly).length
        : 0,
    [baseDataset, selectedRoute]
  );

  const routeTripCount = useMemo(
    () => trips.filter((t) => t.routeId === selectedRoute).length,
    [trips, selectedRoute]
  );

  const directionId = directionToId[directionMode];

  /** Рейси напрямку на обраному шляху (рейс варіанта — лише в сітці свого варіанта) */
  const tripsForDirection = useMemo(
    () =>
      trips
        .filter(
          (t) =>
            t.routeId === selectedRoute &&
            t.directionId === directionId &&
            tripPath(t, directionVariants) === (activeVariant?.id ?? MAIN_PATH)
        )
        .sort(compareTripsByDeparture),
    [trips, selectedRoute, directionId, directionVariants, activeVariant]
  );

  const segmentLookup = useMemo(
    () => buildSegmentLookup(baseDataset?.segments ?? []),
    [baseDataset]
  );

  const defaultSec = useMemo(() => {
    const raw = Number(baseDataset?.meta.defaultSec);
    return Number.isFinite(raw) && raw > 0 ? raw : FALLBACK_DEFAULT_SEGMENT_SEC;
  }, [baseDataset]);

  const timingByTrip = useMemo(() => {
    const map = new Map<string, TripTiming | null>();
    for (const t of tripsForDirection) {
      map.set(t.id, computeTripTimes(t, segmentLookup, selectedRoute, chainStopIds, defaultSec));
    }
    return map;
  }, [tripsForDirection, segmentLookup, selectedRoute, chainStopIds, defaultSec]);

  const stopName = useCallback((id: string | null | undefined) => (id ? stopNameById.get(id) || id : ''), [stopNameById]);
  const lastPassengerStopId = passengerStopIds[passengerStopIds.length - 1] ?? null;
  const tripStartIndex = (t: TransportTripDto) => (t.startStopId ? passengerStopIds.indexOf(t.startStopId) : 0);
  const tripEndIndex = (t: TransportTripDto) =>
    t.endStopId ? passengerStopIds.indexOf(t.endStopId) : passengerStopIds.length - 1;
  /** Табличка відрізняється від назви фактичної кінцевої → показуємо текстове поле */
  const isCustomHeadsign = (t: TransportTripDto) => {
    if (customHeadsign[t.id] != null) return customHeadsign[t.id];
    const plate = (t.headsign || '').trim();
    return !!plate && plate !== stopName(t.endStopId || lastPassengerStopId).trim();
  };

  const updateTrip = useCallback((tripId: string, patch: Partial<TransportTripDto>) => {
    setTrips((prev) => prev.map((t) => (t.id === tripId ? { ...t, ...patch } : t)));
  }, []);

  const handleTimeChange = useCallback(
    (tripId: string, value: string) => {
      updateTrip(tripId, { departureTime: value ? `${value}:00` : null });
    },
    [updateTrip]
  );

  const handleDeleteTrip = useCallback((tripId: string) => {
    if (!window.confirm(`Видалити рейс ${tripId}?`)) return;
    setTrips((prev) => prev.filter((t) => t.id !== tripId));
  }, []);

  const openAddModal = useCallback(() => {
    const defaultHeadsign =
      (directionMode === 'there' ? selectedRouteObj?.toName : selectedRouteObj?.fromName) || '';
    setAddForm({ time: '', headsign: defaultHeadsign, serviceId: 'everyday' });
    setAddError('');
    setAddModalOpen(true);
  }, [directionMode, selectedRouteObj]);

  const handleAddTrip = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (parseClockToMinutes(addForm.time) == null) {
        setAddError('Вкажіть коректний час (ГГ:ХХ)');
        return;
      }
      const id = nextTripId(selectedRoute, trips);
      const newTrip: TransportTripDto = {
        id,
        routeId: selectedRoute,
        serviceId: addForm.serviceId,
        headsign: addForm.headsign.trim(),
        directionId,
        departureTime: `${addForm.time}:00`,
        blockId: null,
        wheelchairAccessible: '',
        bikesAllowed: '',
        startStopId: null,
        endStopId: null,
        arrivalTime: null,
        // рейс з'являється в сітці, яку зараз видно: на обраному шляху
        variantId: activeVariant?.id ?? null,
        timepoints: null,
      };
      setTrips((prev) => [...prev, newTrip]);
      setAddModalOpen(false);
    },
    [addForm, selectedRoute, trips, directionId, activeVariant]
  );

  /** Перенести рейс на інший шлях; сітка перемикається на нього, щоб рейс лишився перед очима */
  const handleTripPathChange = useCallback(
    (t: TransportTripDto, nextPath: string) => {
      if (!baseDataset) return;
      const variant = directionVariants.find((v) => v.id === nextPath) ?? null;
      const { passengers } = pathChain(baseDataset.routeStops, selectedRoute, directionId, variant);
      updateTrip(t.id, moveTripToPath(t, variant?.id ?? MAIN_PATH, passengers));
      setPathMode(variant?.id ?? MAIN_PATH);
      setStatusMsg(`Рейс ${t.id} — на шляху «${variant ? variant.name : 'основний'}»`);
    },
    [baseDataset, directionVariants, selectedRoute, directionId, updateTrip]
  );

  /** Селект «Кінцева»: зупинка → endStopId + автотабличка; порожньо → остання; «Інше…» → текст */
  const handleEndChange = useCallback(
    (t: TransportTripDto, value: string) => {
      if (value === OTHER_HEADSIGN) {
        setCustomHeadsign((prev) => ({ ...prev, [t.id]: true }));
        return;
      }
      const prevEndName = stopName(t.endStopId || lastPassengerStopId) || null;
      const nextEndId = value || null;
      const nextEndName = stopName(nextEndId || lastPassengerStopId);
      updateTrip(t.id, { endStopId: nextEndId, headsign: autoHeadsign(t.headsign, prevEndName, nextEndName) });
      setCustomHeadsign((prev) => ({ ...prev, [t.id]: false }));
    },
    [stopName, lastPassengerStopId, updateTrip]
  );

  const directionLabel = useCallback(
    (mode: DirectionMode) => {
      if (!selectedRouteObj) return mode === 'there' ? 'Туди' : 'Назад';
      const { fromName, toName } = selectedRouteObj;
      return mode === 'there' ? `${fromName || '?'} → ${toName || '?'}` : `${toName || '?'} → ${fromName || '?'}`;
    },
    [selectedRouteObj]
  );

  /** Чи є правки, яких ще немає в базі (маршрути чи рейси відрізняються від завантажених) */
  const dirty = useMemo(
    () => Boolean(baseDataset) && (JSON.stringify(routes) !== JSON.stringify(baseDataset?.routes) || JSON.stringify(trips) !== JSON.stringify(baseDataset?.trips)),
    [baseDataset, routes, trips]
  );

  const tripsByRoute = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of trips) m.set(t.routeId, (m.get(t.routeId) ?? 0) + 1);
    return m;
  }, [trips]);

  const tiles = useMemo(
    () => ({
      routes: routes.length,
      hidden: routes.filter((r) => r.unreliable).length,
      trips: trips.length,
      weekdays: trips.filter((t) => t.serviceId === 'weekdays').length,
      weekends: trips.filter((t) => t.serviceId === 'weekends').length,
      empty: routes.filter((r) => !tripsByRoute.get(r.id)).length,
      short: trips.filter((t) => t.startStopId || t.endStopId).length,
      fixed: trips.filter((t) => t.arrivalTime || t.timepoints?.length).length,
    }),
    [routes, trips, tripsByRoute]
  );

  const routeChips = useMemo(
    () =>
      [...routes]
        .sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10))
        .map((r) => ({ value: r.id, label: `№${(r.shortName ?? '').trim() || r.id} · ${tripsByRoute.get(r.id) ?? 0}${r.unreliable ? ' · прих.' : ''}` })),
    [routes, tripsByRoute]
  );

  if (loading) {
    return <div className="schedule-editor-loading">Завантаження…</div>;
  }

  if (error && !baseDataset) {
    return (
      <div className="schedule-editor-error">
        <p>{error}</p>
        <button type="button" className="admin-kit-btn" onClick={() => void loadFromDb()}>
          Спробувати ще раз
        </button>
      </div>
    );
  }

  if (!baseDataset) {
    return (
      <div className="schedule-editor-error">
        <p>Не вдалося завантажити дані</p>
        <button type="button" className="admin-kit-btn" onClick={() => void loadFromDb()}>
          Спробувати ще раз
        </button>
      </div>
    );
  }

  const scheduleText =
    selectedRouteObj
      ? (scheduleDrafts[selectedRouteObj.id] ?? scheduleToText(selectedRouteObj.schedule))
      : '';
  const scheduleError = selectedRouteObj ? scheduleErrors[selectedRouteObj.id] || '' : '';
  const variantsText = selectedRouteObj
    ? (variantDrafts[selectedRouteObj.id] ?? variantsToText(selectedRouteObj.variants))
    : '';
  const variantsError = selectedRouteObj ? variantErrors[selectedRouteObj.id] || '' : '';

  const search = transportCitySearch(city);

  return (
    <div className="tab-content schedule-editor-tab">
      <AdminSectionHeader
        title="Графік транспорту"
        purpose="Розклад міських маршрутів: рейси по зупинках, скорочені рейси, варіанти шляху й опорні часи; джерела розкладу й час за GPS."
        actions={
          <>
            {dirty ? <StatusPill tone="warn">є незбережені зміни</StatusPill> : <StatusPill tone="ok">усе в базі</StatusPill>}
            <button type="button" className="admin-kit-btn" onClick={() => void handleSaveToDb()} disabled={saving}>
              {saving ? 'Збереження…' : 'Зберегти в базу'}
            </button>
            <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => void handleReloadFromDb()} disabled={loading || saving}>
              Завантажити з бази
            </button>
          </>
        }
      />

      <StatTiles label="Розклад міста">
        <StatTile label="Маршрутів" value={tiles.routes} sub={tiles.hidden ? `прихованих ${tiles.hidden}` : undefined} />
        <StatTile label="Рейсів" value={tiles.trips} sub={`будні ${tiles.weekdays} · вихідні ${tiles.weekends}`} />
        <StatTile label="Маршрутів без рейсів" value={tiles.empty} tone={tiles.empty ? 'warn' : 'default'} />
        <StatTile label="Скорочених рейсів" value={tiles.short} sub={`з фіксованим часом ${tiles.fixed}`} />
      </StatTiles>

      <nav className="admin-kit-nav schedule-editor-nav" aria-label="Розділи «Графік транспорту»">
        {SECTIONS.map((x) => (
          <NavLink
            key={x.slug || '_'}
            to={`${x.slug ? `${BASE}/${x.slug}` : BASE}${search}`}
            end
            className={() => `admin-kit-nav-link${editorSection === x.slug ? ' is-active' : ''}`}
          >
            {x.label}
          </NavLink>
        ))}
      </nav>

      {error && <p className="schedule-editor-error">{error}</p>}
      {statusMsg && <p className="schedule-editor-hint">{statusMsg}</p>}

      {editorSection === 'sources' && <SourceWatchPanel defaultOpen />}
      {editorSection === 'gps' && <GpsRunTimesPanel city={city} defaultOpen />}

      {editorSection === '' && (
        <>
          <div className="schedule-editor-pickers">
            <ChipGroup label="Маршрут" value={selectedRoute} onChange={setSelectedRoute} options={routeChips} />
            <ChipGroup label="Напрямок" value={directionMode} onChange={setDirectionMode} options={[
              { value: 'there' as const, label: directionLabel('there') },
              { value: 'back' as const, label: directionLabel('back') },
            ]} />
            {directionVariants.length > 0 && (
              <ChipGroup
                label="Шлях"
                value={activeVariant?.id ?? MAIN_PATH}
                onChange={setPathMode}
                options={[{ value: MAIN_PATH, label: 'основний' }, ...directionVariants.map((v) => ({ value: v.id, label: v.name }))]}
              />
            )}
          </div>

          {selectedRouteObj && (
            <section className="schedule-editor-route-panel" aria-labelledby="schedule-editor-route-panel-h">
              <div className="schedule-editor-route-panel-head">
                <h3 id="schedule-editor-route-panel-h" className="schedule-editor-route-panel-title">
                  Маршрут №{formRouteNo(selectedRouteObj)}
                </h3>
                <span className="schedule-editor-count">
                  {selectedRouteObj.fromName || '?'} → {selectedRouteObj.toName || '?'} · {routeTripCount} рейсів · {routeStopCount} зупинок
                </span>
                {selectedRouteObj.unreliable && <span className="sched-flag">приховано на сайті</span>}
              </div>
              <details className="schedule-editor-route-details">
                <summary>Дані маршруту — номер, кінцеві, джерело, схема, примітка, розписання міськради, варіанти шляху</summary>
              <label
                className={`admin-checkbox schedule-editor-route-flag ${selectedRouteObj.unreliable ? 'schedule-editor-route-flag--on' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selectedRouteObj.unreliable === true}
                  onChange={(e) => updateRoute(selectedRouteObj.id, { unreliable: e.target.checked })}
                />
                <span>
                  Ненадійний маршрут — приховати на сайті (список маршрутів, планер, сторінка маршруту, табло
                  зупинок, SEO/AEO-сторінки, sitemap, GTFS)
                </span>
              </label>
              {selectedRouteObj.unreliable && (
                <p className="schedule-editor-hint">
                  Прихований маршрут лишається в базі та адмінці. Статичні сторінки зупинок і sitemap
                  перегенеруються під час наступного деплою фронтенду.
                </p>
              )}
              <div className="schedule-editor-route-grid">
                <Input
                  label="Номер для показу (shortName)"
                  type="text"
                  maxLength={16}
                  value={selectedRouteObj.shortName ?? ''}
                  placeholder={selectedRouteObj.id}
                  title="Як номер написано на табличці й у розкладі («11/1», «5А»). Порожньо — показуємо id. Адреси сторінок, рейси й кольори лишаються прив'язані до id. Після зміни — перегенерувати схему міста."
                  onChange={(e) => updateRoute(selectedRouteObj.id, { shortName: e.target.value })}
                />
                <Input
                  label="Кінцева «звідки» (fromName)"
                  type="text"
                  value={selectedRouteObj.fromName ?? ''}
                  onChange={(e) => updateRoute(selectedRouteObj.id, { fromName: e.target.value })}
                />
                <Input
                  label="Кінцева «куди» (toName)"
                  type="text"
                  value={selectedRouteObj.toName ?? ''}
                  onChange={(e) => updateRoute(selectedRouteObj.id, { toName: e.target.value })}
                />
                <Input
                  label="Джерело (sourceUrl)"
                  type="url"
                  value={selectedRouteObj.sourceUrl ?? ''}
                  placeholder="https://…"
                  onChange={(e) => updateRoute(selectedRouteObj.id, { sourceUrl: e.target.value })}
                />
              </div>
              <label className="schedule-editor-route-field">
                <span className="schedule-editor-field-label">Схема руху (scheme)</span>
                <textarea
                  className="schedule-editor-textarea"
                  rows={2}
                  value={selectedRouteObj.scheme ?? ''}
                  onChange={(e) => updateRoute(selectedRouteObj.id, { scheme: e.target.value })}
                />
              </label>
              <label className="schedule-editor-route-field">
                <span className="schedule-editor-field-label">Примітка (note)</span>
                <textarea
                  className="schedule-editor-textarea"
                  rows={2}
                  value={selectedRouteObj.note ?? ''}
                  onChange={(e) => updateRoute(selectedRouteObj.id, { note: e.target.value })}
                />
              </label>
              <label className="schedule-editor-route-field">
                <span className="schedule-editor-field-label">
                  Людське розписання з міськради (schedule, JSON: schedule_entries, lunch_break, note)
                </span>
                <textarea
                  className={`schedule-editor-textarea schedule-editor-textarea--mono ${scheduleError ? 'schedule-editor-textarea--error' : ''}`}
                  rows={6}
                  value={scheduleText}
                  placeholder="Порожньо — без людського розписання"
                  spellCheck={false}
                  onChange={(e) => handleScheduleTextChange(selectedRouteObj.id, e.target.value)}
                />
                {scheduleError && <span className="schedule-editor-field-error">{scheduleError}</span>}
              </label>
              <label className="schedule-editor-route-field">
                <span className="schedule-editor-field-label">
                  Варіанти шляху (JSON: [{'{'} id, directionId «1» туди / «0» назад, name — шлях з малої літери, як
                  «через вокзал», stops: [{'{'} stopId, mapOnly? {'}'}] {'}'}]). Технічні точки лінії краще генерувати
                  скриптом — Docs/route-variants-2026-10.md
                </span>
                <textarea
                  className={`schedule-editor-textarea schedule-editor-textarea--mono ${variantsError ? 'schedule-editor-textarea--error' : ''}`}
                  rows={4}
                  value={variantsText}
                  placeholder="Порожньо — у маршруту лише основні ланцюжки"
                  spellCheck={false}
                  onChange={(e) => handleVariantsTextChange(selectedRouteObj.id, e.target.value)}
                />
                {variantsError && <span className="schedule-editor-field-error">{variantsError}</span>}
              </label>
              </details>
            </section>
          )}

          <details className="schedule-editor-howto">
            <summary>Як рахується час</summary>
            <p className="schedule-editor-hint">
              Час на зупинці = час відправлення рейсу + сума тривалостей перегонів (сегментів). «З» / «Кінцева»
              роблять рейс скороченим: на інших зупинках він не показується (сайт, табло, GTFS). «Прибуття» —
              фіксований час на кінцевій: якщо перегони не вкладаються, вони стискаються пропорційно лише для
              цього рейсу (бейдж ×0.78); із запасом — час за перегонами. Сегменти правте у «Редакторі карти»
              кнопкою «Перерахувати час». «Шлях» — основний ланцюжок або варіант шляху (перший рейс №9 через вокзал):
              рейс варіанта видно лише в сітці свого шляху. «Опорні часи» — точний час із листка на проміжних
              зупинках: між опорами перегони стискаються або розтягуються, разом із «Прибуттям» не задаються.
            </p>
          </details>

      <div className="schedule-editor-toolbar">
        <button type="button" className="admin-kit-btn" onClick={openAddModal} disabled={!selectedRoute}>
          + Додати рейс
        </button>
        <button
          type="button"
          className={`admin-kit-chip${timepointsMode ? ' is-on' : ''}`}
          aria-pressed={timepointsMode}
          onClick={() => setTimepointsMode((on) => !on)}
          title="Клітинки сітки — поля точного часу з листка розкладу на проміжних зупинках"
        >
          Опорні часи
        </button>
        <span className="schedule-editor-count">{tripsForDirection.length} рейсів</span>
      </div>

      {passengerStopIds.length === 0 ? (
        <p className="schedule-editor-hint">У цього маршруту немає зупинок для обраного напрямку.</p>
      ) : tripsForDirection.length === 0 ? (
        <p className="schedule-editor-hint">Рейсів ще немає. Натисніть «+ Додати рейс», щоб створити перший.</p>
      ) : (
        <div className="schedule-editor-grid-wrap">
          <table className="schedule-editor-grid">
            <thead>
              <tr>
                <th className="schedule-editor-corner">Зупинка</th>
                {tripsForDirection.map((t) => {
                  const timing = timingByTrip.get(t.id) ?? null;
                  const startIdx = tripStartIndex(t);
                  const endIdx = tripEndIndex(t);
                  const startOptions = passengerStopIds.filter((_, i) => i > 0 && i < endIdx);
                  const endOptions = passengerStopIds.filter(
                    (_, i) => i > startIdx && i < passengerStopIds.length - 1
                  );
                  const custom = isCustomHeadsign(t);
                  const endSelectValue = t.endStopId ?? (custom ? OTHER_HEADSIGN : '');
                  // з опорними часами прибуття не задається — і підказки для нього немає
                  const oppositeHint = t.arrivalTime || t.timepoints?.length ? null : nextOppositeDeparture(trips, t);
                  return (
                    <th key={t.id} className="schedule-editor-trip-head">
                      <input
                        type="time"
                        className="schedule-editor-time-input"
                        value={(t.departureTime || '').slice(0, 5)}
                        onChange={(e) => handleTimeChange(t.id, e.target.value)}
                        title="Відправлення з першої обслуговуваної зупинки"
                      />
                      {directionVariants.length > 0 && (
                        <>
                          <span className="schedule-editor-head-label">Шлях</span>
                          <select
                            className="schedule-editor-stop-select"
                            value={tripPath(t, directionVariants)}
                            onChange={(e) => handleTripPathChange(t, e.target.value)}
                            title="Шлях рейсу: основний ланцюжок напрямку або варіант шляху"
                          >
                            <option value={MAIN_PATH}>основний</option>
                            {directionVariants.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      <span className="schedule-editor-head-label">З</span>
                      <select
                        className="schedule-editor-stop-select"
                        value={t.startStopId ?? ''}
                        onChange={(e) => updateTrip(t.id, { startStopId: e.target.value || null })}
                        title="Перша обслуговувана зупинка"
                      >
                        <option value="">(перша)</option>
                        {startOptions.map((id) => (
                          <option key={id} value={id}>
                            {stopName(id)}
                          </option>
                        ))}
                      </select>
                      <span className="schedule-editor-head-label">Кінцева</span>
                      <select
                        className="schedule-editor-stop-select"
                        value={endSelectValue}
                        onChange={(e) => handleEndChange(t, e.target.value)}
                        title="Остання обслуговувана зупинка; «Інше…» — власний текст таблички"
                      >
                        <option value="">(остання)</option>
                        {endOptions.map((id) => (
                          <option key={id} value={id}>
                            {stopName(id)}
                          </option>
                        ))}
                        <option value={OTHER_HEADSIGN}>Інше…</option>
                      </select>
                      {custom && (
                        <input
                          type="text"
                          className="schedule-editor-headsign-input"
                          value={t.headsign || ''}
                          placeholder="табличка"
                          onChange={(e) => updateTrip(t.id, { headsign: e.target.value })}
                        />
                      )}
                      <span className="schedule-editor-head-label">Прибуття</span>
                      <input
                        type="time"
                        className="schedule-editor-time-input"
                        value={(t.arrivalTime || '').slice(0, 5)}
                        disabled={!t.departureTime || Boolean(t.timepoints?.length)}
                        title={
                          t.timepoints?.length
                            ? 'Є опорні часи — прибуття разом з ними не задається'
                            : t.departureTime
                              ? 'Фіксований час на кінцевій: перегони рейсу стискаються, щоб встигнути'
                              : 'Спочатку задайте час відправлення'
                        }
                        onChange={(e) =>
                          updateTrip(t.id, { arrivalTime: e.target.value ? `${e.target.value}:00` : null })
                        }
                      />
                      {timing != null && timing.timepointsIgnored > 0 && (
                        <span
                          className="schedule-editor-factor schedule-editor-factor--error"
                          title="Опора поза зрізом рейсу, не по порядку ланцюжка або час не зростає — сайт її не бере"
                        >
                          опор відкинуто: {timing.timepointsIgnored}
                        </span>
                      )}
                      {timing?.arrivalIgnored && (
                        <span className="schedule-editor-factor schedule-editor-factor--error">
                          прибуття ≤ відправлення
                        </span>
                      )}
                      {timing && !timing.arrivalIgnored && timing.factor < 1 && (
                        <span
                          className={`schedule-editor-factor ${timing.factor < 0.5 ? 'schedule-editor-factor--warn' : ''}`}
                          title="Перегони цього рейсу стиснуто, щоб встигнути до часу прибуття"
                        >
                          ×{timing.factor.toFixed(2)}
                        </span>
                      )}
                      {oppositeHint && (
                        <button
                          type="button"
                          className="schedule-editor-hint-btn"
                          onClick={() => updateTrip(t.id, { arrivalTime: `${oppositeHint}:00` })}
                          title="Підставити як час прибуття (виїзд зворотного рейсу з кінцевої)"
                        >
                          ↩ зворотний о {oppositeHint}
                        </button>
                      )}
                      <select
                        className="schedule-editor-service-select"
                        value={t.serviceId || 'everyday'}
                        onChange={(e) => updateTrip(t.id, { serviceId: e.target.value })}
                      >
                        {SERVICE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="schedule-editor-delete-btn"
                        onClick={() => handleDeleteTrip(t.id)}
                        title={`Видалити рейс ${t.id}`}
                      >
                        ×
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {passengerStopIds.map((stopId) => (
                <tr key={stopId}>
                  <td className="schedule-editor-stop-name">{stopName(stopId)}</td>
                  {tripsForDirection.map((t) => {
                    const timing = timingByTrip.get(t.id) ?? null;
                    const clock = clockAtStop(timing, stopId);
                    const unserved = timing != null && clock == null;
                    const anchor = timing != null && timing.timepointIndexes.some((i) => chainStopIds[i] === stopId);
                    const editable = canSetTimepoint(t, timing, stopId);
                    return (
                      <td
                        key={t.id}
                        className={`schedule-editor-cell ${unserved ? 'schedule-editor-cell--unserved' : ''} ${anchor ? 'schedule-editor-cell--timepoint' : ''}`}
                        title={unserved ? 'Рейс тут не зупиняється' : anchor ? 'Опорний час із листка' : undefined}
                      >
                        {timepointsMode && editable ? (
                          <>
                            <input
                              type="time"
                              className="schedule-editor-time-input"
                              value={timepointAt(t, stopId)}
                              aria-label={`Опорний час рейсу ${t.id} на зупинці ${stopName(stopId)}`}
                              title={t.arrivalTime ? '' : 'Порожньо — час за перегонами'}
                              onChange={(e) =>
                                updateTrip(t.id, { timepoints: setTimepoint(t, stopId, e.target.value, passengerStopIds) })
                              }
                            />
                            {!timepointAt(t, stopId) && clock ? <span className="schedule-editor-cell-calc">{clock}</span> : null}
                          </>
                        ) : (
                          (clock ?? '—')
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

        </>
      )}

      {addModalOpen && (
        <div className="schedule-editor-modal-overlay" onClick={() => setAddModalOpen(false)}>
          <form
            className="schedule-editor-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleAddTrip}
          >
            <h3 className="schedule-editor-modal-title">
              Новий рейс — {directionLabel(directionMode)}
              {activeVariant ? ` · шлях «${activeVariant.name}»` : ''}
            </h3>
            <Input
              label="Час відправлення"
              type="time"
              value={addForm.time}
              onChange={(e) => setAddForm((f) => ({ ...f, time: e.target.value }))}
              error={addError || undefined}
              autoFocus
            />
            <Input
              label="Кінцева (headsign)"
              type="text"
              value={addForm.headsign}
              onChange={(e) => setAddForm((f) => ({ ...f, headsign: e.target.value }))}
            />
            <Select
              label="Календар"
              value={addForm.serviceId}
              onChange={(e) => setAddForm((f) => ({ ...f, serviceId: e.target.value }))}
              options={SERVICE_OPTIONS}
            />
            <div className="schedule-editor-modal-buttons">
              <button type="submit" className="admin-kit-btn">
                Додати
              </button>
              <button type="button" className="admin-kit-btn admin-kit-btn--quiet" onClick={() => setAddModalOpen(false)}>
                Скасувати
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
