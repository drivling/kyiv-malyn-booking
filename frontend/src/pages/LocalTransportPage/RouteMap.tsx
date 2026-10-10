import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Pane, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { resolveMapTiles } from './mapTiles';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { pickBoundsStops, type LatLng, type RouteLine } from './routeGeometry';
import { routeColorStyle } from './routeColors';
import { routeNo } from '@/utils/routeNames';

export interface RouteMapCoordsData {
  center: LatLng;
  stops: Record<string, LatLng>;
}

export interface RouteMapProps {
  /** Координати з dataset (GET /transport/dataset) */
  coordsData?: RouteMapCoordsData | null;
  /** Точки в порядку руху (сторінка маршруту: ланцюжок із технічними точками) або всі зупинки міста */
  stopNames: string[];
  /** Маркери лише для цих зупинок (без технічних map_only); без пропа — для всіх stopNames */
  markerStopNames?: string[];
  fromStopName?: string;
  toStopName?: string;
  /** Підпис зупинки (id → назва) */
  resolveStopLabel?: (stopKey: string) => string;
  /** Полілінії у кольорах схеми: усі перевірені маршрути (огляд) або одна (сторінка маршруту) */
  routeLines?: RouteLine[];
  /** Лінії, що лишаються яскравими (кандидати для пари, обраний маршрут); порожньо — усі однаково */
  highlightRouteIds?: string[];
  /** Головні зупинки вузлів схеми: більший маркер і постійний підпис */
  nodeStopIds?: string[];
  /** Лінії через зупинку — чіпи у картці зупинки */
  routesAtStop?: (stopId: string) => string[];
  onPickFromStop?: (stopName: string) => void;
  onPickToStop?: (stopName: string) => void;
  onSwapStops?: () => void;
  /** Тап по маркеру одразу віддає зупинку сторінці (табло) — картки «Звідси / Сюди» немає */
  onStopMarkerClick?: (stopName: string) => void;
  /** Часті кінцеві (id) — чіпи «Часто їду в…» у картці зупинки */
  frequentToStops?: string[];
  /** Посилання «Табло» у картці зупинки */
  boardHref?: (stopId: string) => string;
  /** Світла смужка «З … ⇄ До …» над картою (десктоп) */
  showStrip?: boolean;
  /** Зміна значення → invalidateSize (карта зʼявилась у overlay після display:none) */
  resizeToken?: number;
}

/** Центр Малина — поки координати не завантажились */
const MALYN_CENTER: LatLng = [50.768, 29.242];
const DEFAULT_ZOOM = 13;
/** Підписи вузлів видно з цього зуму (ближче — не накладаються) */
const LABELS_FROM_ZOOM = 13;
/** Підкладка: OSM за замовчуванням або провайдер зі змінних середовища (див. mapTiles.ts) */
const TILES = resolveMapTiles({
  url: import.meta.env.VITE_MAP_TILES_URL,
  attribution: import.meta.env.VITE_MAP_TILES_ATTRIBUTION,
});

/**
 * Підганяє видиму область під зупинки. Залежить від рядкового ключа, а не від масивів-пропів:
 * інакше кожен рендер батька (зокрема щохвилинний тік відліку) знову викликав би fitBounds і карта
 * «відстрибувала» з місця, куди її посунула людина.
 */
function MapBounds({
  stopNames,
  stops,
  padding,
  resizeToken,
}: {
  stopNames: string[];
  stops: Record<string, LatLng>;
  padding: [number, number];
  /** Після появи в overlay розмір контейнера змінюється — межі треба підігнати ще раз */
  resizeToken?: number;
}) {
  const map = useMap();
  const boundsKey = `${stopNames.join('\u001f')}|${padding.join(',')}|${resizeToken ?? ''}`;
  useEffect(() => {
    const names = boundsKey.split('|')[0];
    const withCoords = (names ? names.split('\u001f') : []).filter((n) => stops[n]);
    if (withCoords.length < 1) return;
    const fit = () => map.fitBounds(withCoords.map((n) => stops[n]), { padding, maxZoom: 16 });
    fit();
    // після invalidateSize (overlay) контейнер уже має справжній розмір
    const t = window.setTimeout(fit, 300);
    return () => window.clearTimeout(t);
    // padding бере участь у boundsKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, boundsKey, stops]);
  return null;
}

/** Після появи з display:none (overlay) Leaflet має нульовий розмір — invalidateSize двічі */
function MapResize({ token }: { token?: number }) {
  const map = useMap();
  useEffect(() => {
    if (token === undefined) return;
    const refresh = () => map.invalidateSize({ animate: false, pan: false });
    refresh();
    const t = window.setTimeout(refresh, 250);
    return () => window.clearTimeout(t);
  }, [map, token]);
  return null;
}

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => {
    onZoom(map.getZoom());
  }, [map, onZoom]);
  return null;
}

/** Маркер-коло: біле з кільцем у кольорі (вузол — темне, З/До — origin/destination) */
function createNodeIcon(ring: string, size: number, ringWidth: number) {
  return L.divIcon({
    className: 'lt-map-marker',
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:#fff;border:${ringWidth}px solid ${ring};box-sizing:border-box;box-shadow:0 1px 3px rgba(5,71,82,.3)"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const ICON_STOP = createNodeIcon('#708c91', 9, 2);
const ICON_NODE = createNodeIcon('#054752', 15, 3);
const ICON_FROM = createNodeIcon('#0fa573', 19, 3);
const ICON_TO = createNodeIcon('#00aff5', 19, 3);

export const RouteMap: React.FC<RouteMapProps> = ({
  coordsData = null,
  stopNames,
  markerStopNames,
  fromStopName,
  toStopName,
  resolveStopLabel = (k) => k,
  routeLines = [],
  highlightRouteIds = [],
  nodeStopIds = [],
  routesAtStop,
  onPickFromStop,
  onPickToStop,
  onSwapStops,
  onStopMarkerClick,
  frequentToStops = [],
  boardHref,
  showStrip = false,
  resizeToken,
}) => {
  const [mounted, setMounted] = useState(false);
  const [selectedStop, setSelectedStop] = useState('');
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
    // Власні divIcon-и — дефолтні URL іконок Leaflet не потрібні
    delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
  }, []);

  useEffect(() => {
    if (selectedStop) closeRef.current?.focus();
  }, [selectedStop]);

  useEffect(() => {
    if (!selectedStop) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedStop('');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedStop]);

  const center = coordsData?.center ?? MALYN_CENTER;
  const stops = useMemo(() => coordsData?.stops ?? {}, [coordsData]);
  const chain = useMemo(() => stopNames.filter((n) => stops[n]), [stopNames, stops]);
  const markerNames = useMemo(
    () => (markerStopNames && markerStopNames.length > 0 ? markerStopNames : stopNames).filter((n) => stops[n]),
    [markerStopNames, stopNames, stops]
  );
  const nodeSet = useMemo(() => new Set(nodeStopIds), [nodeStopIds]);
  const highlight = useMemo(() => new Set(highlightRouteIds), [highlightRouteIds]);

  // Відрізок З→До вздовж єдиної (обраної) лінії — сторінка маршруту
  const singleLine = routeLines.length === 1 ? routeLines[0] : null;
  const fromIdx = fromStopName ? chain.indexOf(fromStopName) : -1;
  const toIdx = toStopName ? chain.indexOf(toStopName) : -1;
  const segment: LatLng[] =
    singleLine && fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx
      ? chain.slice(Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx) + 1).map((n) => stops[n])
      : [];
  const bounds = pickBoundsStops({ chain, stops, fromStopName, toStopName, hasLine: Boolean(singleLine) });

  const hasBoth = Boolean(fromStopName && toStopName);
  const hint = fromStopName && !toStopName ? 'Обрано «Звідки». Тепер виберіть «Куди».' : toStopName && !fromStopName ? 'Обрано «Куди». Тепер виберіть «Звідки».' : '';
  const frequent = frequentToStops.filter((n) => n && n !== fromStopName && n !== toStopName && n !== selectedStop).slice(0, 3);
  const selectedLines = selectedStop && routesAtStop ? routesAtStop(selectedStop) : [];

  if (!mounted) return null;

  const lineStyle = (line: RouteLine) => {
    if (highlight.size === 0) return { color: line.color, weight: 3, opacity: 0.55 };
    return highlight.has(line.routeId) ? { color: line.color, weight: 5, opacity: 1 } : { color: line.color, weight: 3, opacity: 0.2 };
  };

  return (
    <div className="lt-map-wrapper">
      {showStrip && (
        <div className="lt-map-strip" aria-label="Обрані зупинки">
          <span className={`lt-chip lt-chip--static ${fromStopName ? 'lt-chip--origin' : ''}`}>
            Звідки: {fromStopName ? resolveStopLabel(fromStopName) : '—'}
          </span>
          <button type="button" className="lt-icon-btn" onClick={onSwapStops} disabled={!hasBoth} title="Поміняти місцями" aria-label="Поміняти місцями Звідки та Куди">
            ⇅
          </button>
          <span className={`lt-chip lt-chip--static ${toStopName ? 'lt-chip--destination' : ''}`}>
            Куди: {toStopName ? resolveStopLabel(toStopName) : '—'}
          </span>
          {hint && <span className="lt-map-strip__hint">{hint}</span>}
        </div>
      )}
      <h3 className="lt-map-heading lt-visually-hidden">Карта маршруту</h3>
      <div className={`lt-map-container${TILES.isDefault ? ' lt-map-container--osm' : ''}`}>
        <MapContainer center={center} zoom={DEFAULT_ZOOM} className="lt-map" scrollWheelZoom style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution={TILES.attribution} url={TILES.url} maxZoom={19} updateWhenIdle={false} keepBuffer={2} />
          <ZoomWatcher onZoom={setZoom} />
          <MapResize token={resizeToken} />
          {bounds.names.length > 0 && <MapBounds stopNames={bounds.names} stops={stops} padding={bounds.padding} resizeToken={resizeToken} />}
          {/* Порядок шарів задають pane-и, а не порядок монтування: притьмарені лінії → біла підкладка → яскраві → відрізок З→До */}
          <Pane name="lt-lines-dim" style={{ zIndex: 402 }} />
          <Pane name="lt-lines-casing" style={{ zIndex: 404 }} />
          <Pane name="lt-lines" style={{ zIndex: 406 }} />
          <Pane name="lt-segment" style={{ zIndex: 408 }} />
          {routeLines.map((line) =>
            highlight.has(line.routeId) ? (
              <Polyline
                key={`${line.routeId}-casing`}
                pane="lt-lines-casing"
                positions={line.positions}
                pathOptions={{ color: '#fff', weight: 9, opacity: 0.9 }}
                interactive={false}
              />
            ) : null
          )}
          {routeLines.map((line) => {
            // pane — опція шару при створенні, тому зміна яскравості перемонтовує лінію (ключ містить pane)
            const pane = highlight.size === 0 || highlight.has(line.routeId) ? 'lt-lines' : 'lt-lines-dim';
            return <Polyline key={`${line.routeId}-${pane}`} pane={pane} positions={line.positions} pathOptions={lineStyle(line)} interactive={false} />;
          })}
          {segment.length >= 2 && singleLine && (
            <Polyline pane="lt-segment" positions={segment} pathOptions={{ color: singleLine.color, weight: 7, opacity: 1 }} interactive={false} />
          )}
          {markerNames.map((n) => {
            const isFrom = n === fromStopName;
            const isTo = n === toStopName;
            const isNode = nodeSet.has(n);
            const icon = isFrom ? ICON_FROM : isTo ? ICON_TO : isNode ? ICON_NODE : ICON_STOP;
            return (
              <Marker
                key={n}
                position={stops[n]}
                icon={icon}
                zIndexOffset={isFrom || isTo ? 300 : isNode ? 100 : 0}
                eventHandlers={{
                  click: () => {
                    if (onStopMarkerClick) onStopMarkerClick(n);
                    else setSelectedStop(n);
                  },
                }}
              >
                {isNode && zoom >= LABELS_FROM_ZOOM ? (
                  <Tooltip permanent direction="right" offset={[9, 0]} className="lt-map-label lt-map-label--node">
                    {resolveStopLabel(n)}
                  </Tooltip>
                ) : (
                  <Tooltip direction="top" offset={[0, -8]} className="lt-map-label">
                    {resolveStopLabel(n)}
                  </Tooltip>
                )}
              </Marker>
            );
          })}
        </MapContainer>
        {selectedStop && (
          <div className="lt-map-card" role="dialog" aria-label={`Зупинка ${resolveStopLabel(selectedStop)}`}>
            <div className="lt-map-card__head">
              <strong className="lt-map-card__title">{resolveStopLabel(selectedStop)}</strong>
              <button ref={closeRef} type="button" className="lt-icon-btn" onClick={() => setSelectedStop('')} aria-label="Закрити">
                ✕
              </button>
            </div>
            {selectedLines.length > 0 && (
              <div className="lt-map-card__lines" aria-label="Лінії через зупинку">
                {selectedLines.map((id) => (
                  <span key={id} className="lt-badge" style={routeColorStyle(id)}>
                    {routeNo(id)}
                  </span>
                ))}
              </div>
            )}
            <div className="lt-map-card__actions">
              {onPickFromStop && (
                <button type="button" className="lt-btn lt-btn--origin" onClick={() => { onPickFromStop(selectedStop); setSelectedStop(''); }}>
                  Звідси
                </button>
              )}
              {onPickToStop && (
                <button type="button" className="lt-btn lt-btn--destination" onClick={() => { onPickToStop(selectedStop); setSelectedStop(''); }}>
                  Сюди
                </button>
              )}
              {boardHref && (
                <a className="lt-btn" href={boardHref(selectedStop)}>
                  Табло
                </a>
              )}
            </div>
            {onPickToStop && frequent.length > 0 && (
              <div className="lt-map-card__frequent">
                <span>Часто їду в…</span>
                {frequent.map((stop) => (
                  <button key={stop} type="button" className="lt-chip" onClick={() => { onPickToStop(stop); setSelectedStop(''); }}>
                    {resolveStopLabel(stop)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
