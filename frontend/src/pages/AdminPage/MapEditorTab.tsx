import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/Button';
import { Select } from '@/components/Select';
import { Alert } from '@/components/Alert/Alert';
import './MapEditorTab.css';
import { displayNameForStopKey, getStopKey } from '../LocalTransportPage/stopCatalog';
import { getRouteStopsWithOrder, type RouteStop, type StopsCoordsData, type TransportData } from './mapEditorModel';
import { apiClient } from '@/api/client';
import {
  datasetToEditor,
  editorToDataset,
  type TransportDataset,
} from '@/api/transportDataset';
import { broadcastTransportDatasetInvalidate } from '../TransportPage/useTransportDataset';
import { getStopArticle } from '@/content/stops';
import { StopsPanel } from './MapEditorStopsPanel';
import {
  applyStopRenamesToDataset,
  buildStopRenameMap,
  countEditorChanges,
  formatChangesLabel,
  formatPropagationSummary,
  renameStopInEditor,
  summarizeRenamePropagation,
  validateStopName,
} from './stopRename';

const MARKER_EXCLUDED_COLOR = '#1e3a5f';

/** Наступний вільний st_XXXX за каталогом і ключами coords */
function nextStopCatalogId(transport: TransportData | null, coords: StopsCoordsData | null): string {
  const nums: number[] = [];
  const cat = transport?.supplement?.stops?.stops_catalog;
  if (cat) {
    for (const k of Object.keys(cat)) {
      const m = k.match(/^st_(\d{4})$/);
      if (m) nums.push(parseInt(m[1], 10));
    }
  }
  if (coords?.stops) {
    for (const k of Object.keys(coords.stops)) {
      const m = k.match(/^st_(\d{4})$/);
      if (m) nums.push(parseInt(m[1], 10));
    }
  }
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `st_${next.toString().padStart(4, '0')}`;
}

/** Наступний індекс для технічної зупинки маршруту (підпис "№{routeId} т.{n}") */
function nextTechnicalStopIndex(routeStops: RouteStop[], routeId: string): number {
  const prefix = `№${routeId} т.`;
  let max = 0;
  routeStops.forEach((s) => {
    if (s.map_only && s.name.startsWith(prefix)) {
      const num = parseInt(s.name.slice(prefix.length), 10);
      if (!Number.isNaN(num) && num > max) max = num;
    }
  });
  return max + 1;
}

function createMarkerIcon(color: string, orderLabel?: string, selected = false) {
  const label = orderLabel != null ? `<span class="map-editor-marker-label">${orderLabel}</span>` : '';
  const pinClass = `map-editor-marker-pin${selected ? ' map-editor-marker-pin--selected' : ''}`;
  return L.divIcon({
    className: 'map-editor-marker',
    html: `<span class="${pinClass}" style="background-color:${color}"><span class="map-editor-marker-inner">${label}</span></span>`,
    iconSize: [32, 42],
    iconAnchor: [16, 42],
  });
}

const MARKER_DEFAULT_COLOR = '#3388ff';
/** Обрана зупинка — бурштин: контрастний і до синього, і до темно-синього «виключена» */
const MARKER_SELECTED_COLOR = '#f97316';

const iconCache = new Map<string, L.DivIcon>();
/** Кешовані іконки: однакові параметри → той самий об'єкт, Leaflet не перестворює маркер даремно */
function markerIcon(opts: { excluded?: boolean; selected?: boolean; label?: string }): L.DivIcon {
  const color = opts.selected ? MARKER_SELECTED_COLOR : opts.excluded ? MARKER_EXCLUDED_COLOR : MARKER_DEFAULT_COLOR;
  const label = opts.excluded ? '−' : opts.label;
  const key = `${color}|${label ?? ''}|${opts.selected ? 1 : 0}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = createMarkerIcon(color, label, Boolean(opts.selected));
    iconCache.set(key, icon);
  }
  return icon;
}

function DraggableMarker({
  name,
  position,
  onPositionChange,
  excluded,
  selected,
  onSelect,
  popupLabel,
}: {
  name: string;
  position: [number, number];
  onPositionChange: (name: string, lat: number, lng: number) => void;
  excluded?: boolean;
  selected?: boolean;
  /** Клік або перетягування — зупинка стає обраною (Leaflet не шле click після drag) */
  onSelect?: (name: string) => void;
  popupLabel?: string;
}) {
  const markerRef = useRef<L.Marker | null>(null);

  const eventHandlers = useMemo(
    () => ({
      click() {
        onSelect?.(name);
      },
      dragend() {
        const marker = markerRef.current;
        if (marker != null) {
          const latlng = marker.getLatLng();
          onPositionChange(name, latlng.lat, latlng.lng);
        }
        onSelect?.(name);
      },
    }),
    [name, onPositionChange, onSelect]
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });
    }
  }, []);

  return (
    <Marker
      ref={markerRef}
      position={position}
      draggable
      icon={markerIcon({ excluded, selected })}
      zIndexOffset={selected ? 1000 : 0}
      title={popupLabel ?? name}
      eventHandlers={eventHandlers}
    >
      <Popup>
        Перетягніть маркер для зміни позиції: {popupLabel ?? name}
        {excluded && <span className="map-editor-popup-excluded"> (виключена)</span>}
      </Popup>
    </Marker>
  );
}

function ClickableMarker({
  name,
  position,
  onClick,
  excluded,
  selected,
  order,
  popupLabel,
}: {
  name: string;
  position: [number, number];
  onClick: (name: string) => void;
  excluded?: boolean;
  selected?: boolean;
  order?: number;
  popupLabel?: string;
}) {
  const icon = markerIcon({ excluded, selected, label: order != null ? String(order) : undefined });
  return (
    <Marker
      position={position}
      draggable={false}
      icon={icon}
      zIndexOffset={selected ? 1000 : 0}
      title={popupLabel ?? name}
      eventHandlers={{ click: () => onClick(name) }}
    >
      <Popup>
        <button type="button" className="map-editor-marker-popup-btn" onClick={() => onClick(name)}>
          Редагувати порядок: {popupLabel ?? name}
        </button>
      </Popup>
    </Marker>
  );
}


/**
 * Підганяє зум під зупинки лише при зміні режиму/маршруту (fitKey), а не на кожну правку —
 * інакше карта б'ється з панорамуванням до обраної зупинки.
 */
function MapBounds({ positions, fitKey }: { positions: [number, number][]; fitKey: string }) {
  const map = useMap();
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  useEffect(() => {
    const pts = positionsRef.current;
    if (pts.length > 1) {
      map.fitBounds(pts, { padding: [30, 30], maxZoom: 16 });
    } else if (pts.length === 1) {
      map.setView(pts[0], 16);
    }
  }, [map, fitKey]);
  return null;
}

/** Панорамує до обраної зупинки лише коли вибір зроблено зі списку/клавіатури (nonce), не з карти */
function PanToSelected({ position, nonce }: { position: [number, number] | null; nonce: number }) {
  const map = useMap();
  const positionRef = useRef(position);
  positionRef.current = position;
  useEffect(() => {
    const pos = positionRef.current;
    if (nonce === 0 || !pos) return;
    if (map.getZoom() < 14) map.setView(pos, 15);
    else map.panTo(pos, { animate: true });
  }, [map, nonce]);
  return null;
}

function MapCenterTracker({ onCenterChange }: { onCenterChange: (lat: number, lng: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const update = () => {
      const c = map.getCenter();
      onCenterChange(c.lat, c.lng);
    };
    update();
    map.on('moveend', update);
    return () => {
      map.off('moveend', update);
    };
  }, [map, onCenterChange]);
  return null;
}

type EditorMode = 'coords' | 'direction';

export const MapEditorTab: React.FC = () => {
  const [transportData, setTransportData] = useState<TransportData | null>(null);
  const [coordsData, setCoordsData] = useState<StopsCoordsData | null>(null);
  const [baseDataset, setBaseDataset] = useState<TransportDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<string>('');
  const [editorMode, setEditorMode] = useState<EditorMode>('coords');
  const [directionMode, setDirectionMode] = useState<'there' | 'back'>('there');
  const [mounted, setMounted] = useState(false);
  const [modalStop, setModalStop] = useState<string | null>(null);
  /** Обрана зупинка — спільна для карти і списку в обох режимах */
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  /** Рядок списку в режимі редагування назви */
  const [editingStopId, setEditingStopId] = useState<string | null>(null);
  /** Зростає лише при виборі зі списку/клавіатури — тоді карта панорамує до зупинки */
  const [panNonce, setPanNonce] = useState(0);
  /** Помилка збереження/OSRM — inline; редактор лишається (на відміну від error при завантаженні) */
  const [actionError, setActionError] = useState('');
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const handleMapCenterChange = useCallback((lat: number, lng: number) => {
    setMapCenter([lat, lng]);
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  const stopsCatalog = useMemo(() => transportData?.supplement?.stops?.stops_catalog, [transportData]);

  /** Назви з бази — «було: …», revert і мапа перейменувань для пропагації */
  const dbNameById = useMemo(
    () => new Map((baseDataset?.stops ?? []).map((st) => [st.id, st.name] as const)),
    [baseDataset]
  );
  const renameMap = useMemo(() => buildStopRenameMap(baseDataset?.stops ?? [], stopsCatalog), [baseDataset, stopsCatalog]);
  /** Те, що піде в PUT (ще без пропагації) — джерело лічильника змін */
  const nextDataset = useMemo(() => {
    if (!transportData || !coordsData || !baseDataset) return null;
    // редактор тримає дані в «сирому» вигляді і нормалізує їх у editorToDataset
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return editorToDataset(transportData as any, coordsData, baseDataset);
  }, [transportData, coordsData, baseDataset]);
  const changes = useMemo(() => countEditorChanges(baseDataset, nextDataset), [baseDataset, nextDataset]);
  const isDirty = changes.total > 0;
  const propagationByStopId = useMemo(() => {
    const m = new Map<string, string | null>();
    if (!baseDataset) return m;
    dbNameById.forEach((dbName, id) => {
      if (renameMap.has(dbName)) m.set(id, formatPropagationSummary(summarizeRenamePropagation(baseDataset, dbName)));
    });
    return m;
  }, [baseDataset, dbNameById, renameMap]);

  const applyDataset = useCallback((dataset: TransportDataset) => {
    const { transport, coords } = datasetToEditor(dataset);
    setBaseDataset(dataset);
    setTransportData(transport as TransportData);
    setCoordsData(coords);
  }, []);

  const loadFromDb = useCallback(async () => {
    setLoading(true);
    setError('');
    setActionError('');
    setStatusMsg('');
    setEditingStopId(null);
    try {
      const dataset = await apiClient.getTransportDataset();
      applyDataset(dataset);
      setStatusMsg('Завантажено з бази');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не вдалося завантажити дані з бази');
    } finally {
      setLoading(false);
    }
  }, [applyDataset]);

  useEffect(() => {
    void loadFromDb();
  }, [loadFromDb]);

  const handleSaveToDb = useCallback(async () => {
    if (!transportData || !coordsData || !baseDataset || !nextDataset) return;
    const { dataset, touchedRoutes, touchedTrips } = applyStopRenamesToDataset(nextDataset, renameMap);
    const summary = [
      changes.renamedStops.length ? `перейменовано: ${changes.renamedStops.length}` : '',
      changes.movedStops.length ? `переміщено: ${changes.movedStops.length}` : '',
      changes.addedStops.length ? `нових технічних: ${changes.addedStops.length}` : '',
      changes.routeStopChanges ? `порядок/маршрути: ${changes.routeStopChanges}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    const propagationNote =
      touchedRoutes.length || touchedTrips
        ? `\nСтара назва також заміниться у кінцевих маршрутів (${touchedRoutes.length}) і headsign рейсів (${touchedTrips}).`
        : '';
    if (
      !window.confirm(
        `Зберегти в базу: ${formatChangesLabel(changes.total)} (${summary})?${propagationNote}\n` +
          'Несхоронені правки інших вкладок не торкаються.'
      )
    ) {
      return;
    }
    setSaving(true);
    setActionError('');
    setStatusMsg('');
    try {
      const result = await apiClient.putTransportDataset(dataset);
      applyDataset(dataset);
      broadcastTransportDatasetInvalidate();
      setEditingStopId(null);
      setStatusMsg(
        `Збережено: ${result.counts.stops} зупинок, ${result.counts.routes} маршрутів, ${result.counts.trips} рейсів`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Не вдалося зберегти в базу');
    } finally {
      setSaving(false);
    }
  }, [transportData, coordsData, baseDataset, nextDataset, renameMap, changes, applyDataset]);

  const handleReloadFromDb = useCallback(async () => {
    if (
      !window.confirm(
        'Завантажити з бази? Несхоронені зміни в редакторі буде втрачено.'
      )
    ) {
      return;
    }
    await loadFromDb();
  }, [loadFromDb]);

  const handleRecalculateSegments = useCallback(async () => {
    const scope = selectedRoute
      ? `маршруту №${selectedRoute}`
      : 'усіх перевірених маршрутів (2,3,5,7,8,9,11,12)';
    if (
      !window.confirm(
        `Перерахувати час між зупинками (OSRM) для ${scope}?\n\n` +
          'Береться те, що вже збережено в базі — спочатку натисніть «Зберегти в базу», якщо є несхоронені правки.\n' +
          'Може зайняти кілька хвилин.'
      )
    ) {
      return;
    }
    setRecalculating(true);
    setActionError('');
    setStatusMsg('Перерахунок сегментів через OSRM…');
    try {
      const result = await apiClient.recalculateTransportSegments(selectedRoute || undefined);
      setStatusMsg(
        `Сегменти оновлено: маршрути ${result.routes.join(', ')}, ` +
          `записано ${result.segmentsWritten}, OSRM ${result.osrmRequested}` +
          (result.osrmFailed ? ` (fallback: ${result.osrmFailed})` : '')
      );
      // підтягнути свіжі сегменти в baseDataset (для наступного збереження)
      const dataset = await apiClient.getTransportDataset();
      applyDataset(dataset);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Не вдалося перерахувати сегменти');
      setStatusMsg('');
    } finally {
      setRecalculating(false);
    }
  }, [selectedRoute, applyDataset]);

  const routeOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Всі зупинки / виберіть маршрут' }];
    const sbr = transportData?.supplement?.stops?.stops_by_route;
    if (sbr) {
      Object.keys(sbr)
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
        .forEach((id) => opts.push({ value: id, label: `Маршрут №${id}` }));
    }
    return opts;
  }, [transportData]);

  const displayedStops = useMemo(() => {
    if (!coordsData) return [];
    const allStops = Object.keys(coordsData.stops);
    if (!selectedRoute) return allStops;
    const routeStops = getRouteStopsWithOrder(transportData?.supplement?.stops?.stops_by_route, selectedRoute);
    const routeStopKeys = new Set(routeStops.map((s) => getStopKey(s)));
    return allStops.filter((k) => routeStopKeys.has(k));
  }, [coordsData, transportData, selectedRoute]);

  const isTechnicalStop = useCallback(
    (stopKey: string) => {
      if (!selectedRoute || !transportData) return false;
      const routeStops = getRouteStopsWithOrder(transportData.supplement?.stops?.stops_by_route, selectedRoute);
      return routeStops.some((s) => getStopKey(s) === stopKey && s.map_only);
    },
    [selectedRoute, transportData]
  );

  const routeStopsForDirection = useMemo(() => {
    if (!selectedRoute || !transportData) return [];
    return getRouteStopsWithOrder(transportData.supplement?.stops?.stops_by_route, selectedRoute);
  }, [selectedRoute, transportData]);

  const routeEndpoints = useMemo(() => {
    if (!selectedRoute || !transportData) return { from: '?', to: '?' };
    const r = transportData.supplement?.routes?.[selectedRoute];
    // кінцеві — назви зупинок; перейменована зупинка видна тут одразу, в базі зміниться при збереженні
    const withRename = (v?: string) => (v ? (renameMap.get(v) ?? v) : '?');
    return { from: withRename(r?.from), to: withRename(r?.to) };
  }, [selectedRoute, transportData, renameMap]);

  const orderedStopsForDirection = useMemo(() => {
    const orderKey = directionMode === 'there' ? 'order_there' : 'order_back';
    return [...routeStopsForDirection]
      .filter((s) => {
        const o = s[orderKey];
        return typeof o === 'number' && o > 0;
      })
      .sort((a, b) => (a[orderKey] ?? 0) - (b[orderKey] ?? 0));
  }, [routeStopsForDirection, directionMode]);

  const isStopExcludedInAnyDirection = useCallback(
    (stopKey: string) => {
      const stop = routeStopsForDirection.find((s) => getStopKey(s) === stopKey);
      if (!stop) return false;
      return stop.order_there === -1 || stop.order_back === -1;
    },
    [routeStopsForDirection]
  );

  const handlePositionChange = useCallback(
    (name: string, lat: number, lng: number) => {
      setCoordsData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stops: {
            ...prev.stops,
            [name]: [lat, lng],
          },
        };
      });
    },
    []
  );

  const handleAddTechnicalStop = useCallback(() => {
    if (!selectedRoute || !transportData || !coordsData) return;
    const sbr = transportData.supplement?.stops?.stops_by_route;
    const routeStops = getRouteStopsWithOrder(sbr, selectedRoute);
    if (routeStops.length === 0) return;
    const newId = nextStopCatalogId(transportData, coordsData);
    const label = `№${selectedRoute} т.${nextTechnicalStopIndex(routeStops, selectedRoute)}`;
    const maxThere = Math.max(0, ...routeStops.map((s) => s.order_there ?? 0).filter((n) => n > 0));
    const maxBack = Math.max(0, ...routeStops.map((s) => s.order_back ?? 0).filter((n) => n > 0));
    const firstWithCoords = displayedStops.map((n) => coordsData.stops[n]).find(Boolean);
    const position: [number, number] = mapCenter ?? (firstWithCoords as [number, number]) ?? coordsData.center;
    setCoordsData((prev) =>
      prev ? { ...prev, stops: { ...prev.stops, [newId]: position } } : prev
    );
    const newStop: RouteStop = {
      id: newId,
      name: label,
      order_there: maxThere + 1,
      order_back: maxBack + 1,
      map_only: true,
    };
    const prevCatalog = transportData.supplement?.stops?.stops_catalog ?? {};
    setTransportData({
      ...transportData,
      supplement: {
        ...transportData.supplement,
        stops: {
          ...transportData.supplement?.stops,
          stops_catalog: { ...prevCatalog, [newId]: { name: label } },
          stops_by_route: {
            ...transportData.supplement?.stops?.stops_by_route,
            [selectedRoute]: [...routeStops, newStop],
          },
        },
      },
    });
  }, [selectedRoute, transportData, coordsData, mapCenter, displayedStops]);

  const handleStopOrderChange = useCallback(
    (stopKey: string, newOrder: number) => {
      if (!transportData || !selectedRoute) return;
      const sbr = transportData.supplement?.stops?.stops_by_route;
      if (!sbr?.[selectedRoute]) return;
      const routeStops = [...(sbr[selectedRoute] as RouteStop[])];
      const orderKey = directionMode === 'there' ? 'order_there' : 'order_back';
      const stopIdx = routeStops.findIndex((s) => getStopKey(s) === stopKey);
      if (stopIdx < 0) return;
      const oldOrder = routeStops[stopIdx][orderKey] ?? 0;
      if (newOrder === -1) {
        routeStops[stopIdx] = { ...routeStops[stopIdx], [orderKey]: -1 };
      } else {
        const swapIdx = routeStops.findIndex((s) => (s[orderKey] ?? 0) === newOrder);
        routeStops[stopIdx] = { ...routeStops[stopIdx], [orderKey]: newOrder };
        if (swapIdx >= 0 && swapIdx !== stopIdx) {
          routeStops[swapIdx] = { ...routeStops[swapIdx], [orderKey]: oldOrder };
        }
      }
      setTransportData({
        ...transportData,
        supplement: {
          ...transportData.supplement,
          stops: {
            ...transportData.supplement?.stops,
            stops_by_route: {
              ...transportData.supplement?.stops?.stops_by_route,
              [selectedRoute]: routeStops,
            },
          },
        },
      });
      setModalStop(null);
    },
    [transportData, selectedRoute, directionMode]
  );

  /** Скопіювати зупинку (за назвою) в інший маршрут — додати в кінець, порядок потім підправити в редакторі */
  const handleCopyStopToRoute = useCallback(
    (stopKey: string, targetRouteId: string) => {
      if (!transportData || !selectedRoute || targetRouteId === selectedRoute) return;
      const sbr = transportData.supplement?.stops?.stops_by_route;
      const sourceStop = routeStopsForDirection.find((s) => getStopKey(s) === stopKey);
      if (!sourceStop) return;
      const targetStopsRaw = sbr?.[targetRouteId];
      if (!targetStopsRaw || !Array.isArray(targetStopsRaw)) return;
      const targetStops: RouteStop[] =
        targetStopsRaw.length > 0 && typeof targetStopsRaw[0] === 'object' && 'name' in targetStopsRaw[0]
          ? [...(targetStopsRaw as RouteStop[])]
          : (targetStopsRaw as string[]).map((name, i) => ({
              name,
              order_there: i + 1,
              order_back: targetStopsRaw.length - i,
            }));
      if (targetStops.some((s) => getStopKey(s) === stopKey)) return;
      const maxThere = Math.max(0, ...targetStops.map((s) => s.order_there ?? 0).filter((n) => n > 0));
      const maxBack = Math.max(0, ...targetStops.map((s) => s.order_back ?? 0).filter((n) => n > 0));
      const newEntry: RouteStop = {
        id: sourceStop.id,
        name: sourceStop.name,
        order_there: maxThere + 1,
        order_back: maxBack + 1,
        ...(sourceStop.map_only !== undefined && { map_only: sourceStop.map_only }),
      };
      setTransportData({
        ...transportData,
        supplement: {
          ...transportData.supplement,
          stops: {
            ...transportData.supplement?.stops,
            stops_by_route: {
              ...transportData.supplement?.stops?.stops_by_route,
              [targetRouteId]: [...targetStops, newEntry],
            },
          },
        },
      });
      setModalStop(null);
    },
    [transportData, selectedRoute, routeStopsForDirection]
  );

  /** Увімкнути/вимкнути «технічна зупинка» (map_only) для обраної зупинки в поточному маршруті */
  const handleToggleMapOnly = useCallback(
    (stopKey: string, mapOnly: boolean) => {
      if (!transportData || !selectedRoute) return;
      const sbr = transportData.supplement?.stops?.stops_by_route;
      if (!sbr?.[selectedRoute]) return;
      const routeStops = (sbr[selectedRoute] as RouteStop[]).map((s) =>
        getStopKey(s) === stopKey ? { ...s, map_only: mapOnly } : s
      );
      setTransportData({
        ...transportData,
        supplement: {
          ...transportData.supplement,
          stops: {
            ...transportData.supplement?.stops,
            stops_by_route: {
              ...transportData.supplement?.stops?.stops_by_route,
              [selectedRoute]: routeStops,
            },
          },
        },
      });
    },
    [transportData, selectedRoute]
  );

  /** Застосувати нову назву (в пам'яті); повертає текст помилки валідації або null */
  const handleRenameStop = useCallback(
    (stopId: string, raw: string): string | null => {
      const err = validateStopName(raw, stopsCatalog, stopId);
      if (err) return err;
      setTransportData((prev) => (prev ? renameStopInEditor(prev, stopId, raw) : prev));
      setEditingStopId(null);
      return null;
    },
    [stopsCatalog]
  );

  /** Повернути назву з бази (скасувати незбережене перейменування) */
  const handleRevertStopName = useCallback(
    (stopId: string) => {
      const dbName = dbNameById.get(stopId);
      if (!dbName) return;
      setTransportData((prev) => (prev ? renameStopInEditor(prev, stopId, dbName) : prev));
      setEditingStopId(null);
    },
    [dbNameById]
  );

  const selectStop = useCallback((id: string, source: 'map' | 'list' | 'keyboard') => {
    setSelectedStopId(id);
    // перехід на іншу зупинку закриває незавершене редагування
    setEditingStopId((editing) => (editing && editing !== id ? null : editing));
    if (source !== 'map') setPanNonce((n) => n + 1);
  }, []);
  const handleMarkerSelect = useCallback((id: string) => selectStop(id, 'map'), [selectStop]);
  const handleDirectionMarkerClick = useCallback(
    (id: string) => {
      selectStop(id, 'map');
      setModalStop(id);
    },
    [selectStop]
  );

  // Вибір живе, поки зупинка є у списку (зміна маршруту може її прибрати)
  useEffect(() => {
    if (selectedStopId && !displayedStops.includes(selectedStopId)) {
      setSelectedStopId(null);
      setEditingStopId(null);
    }
  }, [displayedStops, selectedStopId]);
  useEffect(() => {
    setEditingStopId(null);
  }, [editorMode, selectedRoute]);
  // Закриття вкладки браузера з незбереженими правками — стандартний confirm
  useEffect(() => {
    if (!isDirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [isDirty]);

  const positions = useMemo(
    () => displayedStops.map((n) => coordsData?.stops[n]).filter(Boolean) as [number, number][],
    [displayedStops, coordsData]
  );

  if (loading) {
    return <div className="map-editor-loading">Завантаження...</div>;
  }

  if (error || !coordsData) {
    return (
      <div className="map-editor-error">
        {error || 'Дані не завантажені'}
      </div>
    );
  }

  const directionEditorActive = editorMode === 'direction' && selectedRoute;
  const saveLabel = saving
    ? 'Збереження…'
    : isDirty
      ? `Зберегти в базу · ${formatChangesLabel(changes.total)}`
      : 'Зберегти в базу';
  const renderSaveButton = () => (
    <Button
      type="button"
      onClick={handleSaveToDb}
      disabled={saving || recalculating || !baseDataset || !isDirty}
      title={isDirty ? undefined : 'Немає незбережених змін'}
    >
      {saveLabel}
    </Button>
  );

  return (
    <div className="tab-content map-editor-tab">
      <div className="map-editor-mode-switch">
        <div className="map-editor-mode-btns">
          <button
            type="button"
            className={`map-editor-mode-btn ${editorMode === 'coords' ? 'map-editor-mode-btn--active' : ''}`}
            onClick={() => setEditorMode('coords')}
          >
            Редактор координат
          </button>
          <button
            type="button"
            className={`map-editor-mode-btn ${editorMode === 'direction' ? 'map-editor-mode-btn--active' : ''}`}
            onClick={() => setEditorMode('direction')}
            disabled={!selectedRoute}
            title={!selectedRoute ? 'Спочатку виберіть маршрут' : ''}
          >
            Редактор напрямку
          </button>
        </div>
      </div>

      <div className="map-editor-controls">
        <div className="map-editor-select">
          <Select
            label="Маршрут"
            options={routeOptions}
            value={selectedRoute}
            onChange={(e) => setSelectedRoute(e.target.value)}
          />
        </div>
        {editorMode === 'coords' && (
          <div className="map-editor-actions">
            <Button
              type="button"
              onClick={handleAddTechnicalStop}
              disabled={!selectedRoute}
              title={!selectedRoute ? 'Спочатку виберіть маршрут' : 'Додати точку тільки для карти (map_only)'}
            >
              + Техн. зупинка
            </Button>
            {renderSaveButton()}
            <Button type="button" onClick={handleReloadFromDb} disabled={loading || saving || recalculating}>
              Завантажити з бази
            </Button>
            <Button
              type="button"
              onClick={handleRecalculateSegments}
              disabled={loading || saving || recalculating || !baseDataset}
              title={
                selectedRoute
                  ? `OSRM-перерахунок сегментів маршруту №${selectedRoute} (з даних у БД)`
                  : 'OSRM-перерахунок усіх перевірених маршрутів (з даних у БД)'
              }
            >
              {recalculating
                ? 'OSRM…'
                : selectedRoute
                  ? `Перерахувати час №${selectedRoute}`
                  : 'Перерахувати час (усі)'}
            </Button>
          </div>
        )}
      </div>

      {statusMsg && <p className="map-editor-hint">{statusMsg}</p>}
      {actionError && (
        <Alert variant="error" className="map-editor-action-error">
          {actionError}
        </Alert>
      )}

      {editorMode === 'coords' && (
        <p className="map-editor-hint">
          Клік по зупинці на карті або в списку — вибрати; ✎ або Enter у списку — перейменувати (нова назва
          також замінить кінцеві маршрутів і таблички рейсів з такою самою назвою).
          Перетягніть маркер для уточнення позиції. «+ Техн. зупинка» — точка тільки для карти (map_only).
          Темно-синій — виключена (order = -1). Зміни в памʼяті, поки не натиснете «Зберегти в базу».
          «Завантажити з бази» скидає несхоронені правки.
          «Перерахувати час» — OSRM по збережених у БД координатах/порядку (спочатку збережіть).
        </p>
      )}

      {directionEditorActive && (
        <div className="map-editor-direction-controls">
          <div className="map-editor-direction-switch">
            <span className="map-editor-direction-label">Напрямок:</span>
            <button
              type="button"
              className={`map-editor-direction-btn ${directionMode === 'there' ? 'map-editor-direction-btn--active' : ''}`}
              onClick={() => setDirectionMode('there')}
              title={`На ${routeEndpoints.to}`}
            >
              → {routeEndpoints.to}
            </button>
            <button
              type="button"
              className={`map-editor-direction-btn ${directionMode === 'back' ? 'map-editor-direction-btn--active' : ''}`}
              onClick={() => setDirectionMode('back')}
              title={`На ${routeEndpoints.from}`}
            >
              ← {routeEndpoints.from}
            </button>
          </div>
          {renderSaveButton()}
          <Button type="button" onClick={handleReloadFromDb} disabled={loading || saving || recalculating}>
            Завантажити з бази
          </Button>
          <Button
            type="button"
            onClick={handleRecalculateSegments}
            disabled={loading || saving || recalculating || !baseDataset}
          >
            {recalculating ? 'OSRM…' : `Перерахувати час №${selectedRoute}`}
          </Button>
        </div>
      )}

      {directionEditorActive && (
        <p className="map-editor-hint">
          Натисніть на маркер, щоб змінити номер зупинки по напрямку або виключити (-1). Темно-синій — виключена.
          Назву зупинки можна змінити в списку праворуч.
        </p>
      )}

      <div className="map-editor-layout">
        <div className="map-editor-map">
          {mounted && (
            <MapContainer
              center={coordsData.center}
              zoom={13}
              className="map-editor-map-container"
              scrollWheelZoom
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapBounds positions={positions} fitKey={`${editorMode}|${selectedRoute}`} />
              <PanToSelected
                position={selectedStopId ? (coordsData.stops[selectedStopId] ?? null) : null}
                nonce={panNonce}
              />
              <MapCenterTracker onCenterChange={handleMapCenterChange} />
              {editorMode === 'coords'
                ? displayedStops.map((name) => {
                    const pos = coordsData.stops[name];
                    if (!pos) return null;
                    return (
                      <DraggableMarker
                        key={name}
                        name={name}
                        position={pos}
                        onPositionChange={handlePositionChange}
                        excluded={selectedRoute ? isStopExcludedInAnyDirection(name) : false}
                        selected={name === selectedStopId}
                        onSelect={handleMarkerSelect}
                        popupLabel={displayNameForStopKey(name, stopsCatalog)}
                      />
                    );
                  })
                : directionEditorActive &&
                  displayedStops.map((name) => {
                    const pos = coordsData.stops[name];
                    if (!pos) return null;
                    const stop = routeStopsForDirection.find((s) => getStopKey(s) === name);
                    const orderKey = directionMode === 'there' ? 'order_there' : 'order_back';
                    const order = stop?.[orderKey];
                    const excluded = order === -1;
                    return (
                      <ClickableMarker
                        key={name}
                        name={name}
                        position={pos}
                        onClick={handleDirectionMarkerClick}
                        excluded={excluded}
                        selected={name === selectedStopId}
                        order={excluded ? undefined : (order as number)}
                        popupLabel={displayNameForStopKey(name, stopsCatalog)}
                      />
                    );
                  })}
            </MapContainer>
          )}
        </div>
        <StopsPanel
          mode={editorMode}
          stopIds={displayedStops}
          catalog={stopsCatalog}
          coords={coordsData.stops}
          dbNameById={dbNameById}
          propagationByStopId={propagationByStopId}
          selectedStopId={selectedStopId}
          editingStopId={editingStopId}
          panNonce={panNonce}
          isExcluded={(id) => (selectedRoute ? isStopExcludedInAnyDirection(id) : false)}
          isTechnical={isTechnicalStop}
          hasArticle={(id) => Boolean(getStopArticle(id))}
          onSelect={selectStop}
          onStartEdit={setEditingStopId}
          onCancelEdit={() => setEditingStopId(null)}
          onApplyRename={handleRenameStop}
          onRevert={handleRevertStopName}
          orderedStops={directionEditorActive ? orderedStopsForDirection : undefined}
          excludedStops={
            directionEditorActive
              ? routeStopsForDirection.filter((st) => (directionMode === 'there' ? st.order_there : st.order_back) === -1)
              : undefined
          }
          directionTitle={
            directionEditorActive
              ? `Порядок зупинок (${directionMode === 'there' ? `→ ${routeEndpoints.to}` : `← ${routeEndpoints.from}`})`
              : undefined
          }
          onOpenOrderModal={directionEditorActive ? setModalStop : undefined}
        />
      </div>

      {modalStop && directionEditorActive && (
        <div className="map-editor-modal-overlay" onClick={() => setModalStop(null)}>
          <div className="map-editor-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="map-editor-modal-title">
              Зупинка: {displayNameForStopKey(modalStop, stopsCatalog)}
            </h3>

            <p className="map-editor-modal-hint">Назву зупинки можна змінити в списку праворуч.</p>

            <div className="map-editor-modal-field map-editor-modal-field--checkbox">
              <label className="map-editor-modal-checkbox-label">
                <input
                  type="checkbox"
                  checked={routeStopsForDirection.find((s) => getStopKey(s) === modalStop)?.map_only ?? false}
                  onChange={(e) => handleToggleMapOnly(modalStop, e.target.checked)}
                />
                <span>Технічна зупинка (тільки для карти, map_only)</span>
              </label>
            </div>

            <p className="map-editor-modal-hint">Номер по напрямку або -1 (виключити):</p>
            <div className="map-editor-modal-options">
              {Array.from({ length: Math.max(routeStopsForDirection.length, 20) }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  className="map-editor-modal-opt"
                  onClick={() => handleStopOrderChange(modalStop, n)}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                className="map-editor-modal-opt map-editor-modal-opt--exclude"
                onClick={() => handleStopOrderChange(modalStop, -1)}
              >
                -1 (виключити)
              </button>
            </div>
            <p className="map-editor-modal-hint map-editor-modal-copy-heading">Скопіювати зупинку в маршрут:</p>
            <div className="map-editor-modal-copy-routes">
              {routeOptions
                .filter((o) => o.value && o.value !== selectedRoute)
                .map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="map-editor-modal-opt map-editor-modal-opt--copy"
                    onClick={() => handleCopyStopToRoute(modalStop, o.value)}
                  >
                    {o.label}
                  </button>
                ))}
            </div>
            <button type="button" className="map-editor-modal-close" onClick={() => setModalStop(null)}>
              Скасувати
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
