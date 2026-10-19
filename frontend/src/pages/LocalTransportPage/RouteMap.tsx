import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useOnline } from '@/pwa/useOnline';
import { CircleMarker, MapContainer, TileLayer, Marker, Pane, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { resolveMapTiles } from './mapTiles';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { pickBoundsStops, type LatLng, type RouteLine } from './routeGeometry';
import { routeColor, routeColorStyle } from './routeColors';
import type { MapJourney } from './journey/mapData';
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
  /** «Звідки» / «Куди» не зупинка, а точка (геолокація, клік на карті) */
  fromPoint?: LatLng | null;
  toPoint?: LatLng | null;
  fromPointLabel?: string;
  toPointLabel?: string;
  /** Клік по порожньому місцю карти відкриває картку «Звідси / Сюди» для цієї точки */
  onPickPoint?: (slot: 'from' | 'to', lat: number, lng: number) => void;
  /** Обрана поїздка: кольорові ділянки рейсів, пішки — пунктиром; карта підганяється під неї */
  journey?: MapJourney | null;
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

/** Підганяє карту під ділянки обраної поїздки (ключ — геометрія, а не посилання на об'єкт) */
function JourneyFit({ journey }: { journey: MapJourney }) {
  const map = useMap();
  const key = JSON.stringify(journey.legs.map((l) => l.positions));
  useEffect(() => {
    const all = (JSON.parse(key) as LatLng[][]).flat();
    if (all.length < 1) return;
    const fit = () => map.fitBounds(all, { padding: [50, 50], maxZoom: 16 });
    fit();
    const t = window.setTimeout(fit, 300);
    return () => window.clearTimeout(t);
  }, [map, key]);
  return null;
}

/** Клік по карті → точка (маркери зупинок не пропускають клік далі) */
function MapClick({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) });
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
const ICON_PICK = createNodeIcon('#054752', 15, 3);

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
  fromPoint = null,
  toPoint = null,
  fromPointLabel = 'Точка на карті',
  toPointLabel = 'Точка на карті',
  onPickPoint,
  journey = null,
}) => {
  // Тайли OSM не кешуємо (політика OSM) — без мережі замість сірого поля чесна підказка
  const online = useOnline();
  const [mounted, setMounted] = useState(false);
  const [selectedStop, setSelectedStop] = useState('');
  /** Точка, на яку клікнули: картка «Звідси / Сюди» */
  const [pickedPoint, setPickedPoint] = useState<LatLng | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMounted(true);
    // Власні divIcon-и — дефолтні URL іконок Leaflet не потрібні
    delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
  }, []);

  useEffect(() => {
    if (selectedStop || pickedPoint) closeRef.current?.focus();
  }, [selectedStop, pickedPoint]);

  useEffect(() => {
    if (!selectedStop && !pickedPoint) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setSelectedStop('');
      setPickedPoint(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedStop, pickedPoint]);

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
  // Точка замість зупинки — під псевдо-ключем, щоб межі карти й підписи працювали однаково
  const allStops = useMemo(
    () => ({ ...stops, ...(fromPoint ? { __from: fromPoint } : {}), ...(toPoint ? { __to: toPoint } : {}) }),
    [stops, fromPoint, toPoint]
  );
  const effFrom = fromPoint ? '__from' : fromStopName;
  const effTo = toPoint ? '__to' : toStopName;
  const bounds = pickBoundsStops({ chain, stops: allStops, fromStopName: effFrom, toStopName: effTo, hasLine: Boolean(singleLine) });
  const fromShown = fromPoint ? fromPointLabel : fromStopName ? resolveStopLabel(fromStopName) : '';
  const toShown = toPoint ? toPointLabel : toStopName ? resolveStopLabel(toStopName) : '';

  const hasBoth = Boolean(effFrom && effTo);
  const hint = effFrom && !effTo ? 'Обрано «Звідки». Тепер виберіть «Куди».' : effTo && !effFrom ? 'Обрано «Куди». Тепер виберіть «Звідки».' : '';
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
          <span className={`lt-chip lt-chip--static ${effFrom ? 'lt-chip--origin' : ''}`}>
            Звідки: {fromShown || '—'}
          </span>
          <button type="button" className="lt-icon-btn" onClick={onSwapStops} disabled={!hasBoth} title="Поміняти місцями" aria-label="Поміняти місцями Звідки та Куди">
            ⇅
          </button>
          <span className={`lt-chip lt-chip--static ${effTo ? 'lt-chip--destination' : ''}`}>
            Куди: {toShown || '—'}
          </span>
          {hint && <span className="lt-map-strip__hint">{hint}</span>}
        </div>
      )}
      <h3 className="lt-map-heading lt-visually-hidden">Карта маршруту</h3>
      {!online && (
        <p className="lt-map-offline" role="note">
          Без мережі карта не завантажується — скористайтесь схемою маршрутів.
        </p>
      )}
      <div className={`lt-map-container${TILES.isDefault ? ' lt-map-container--osm' : ''}`}>
        <MapContainer center={center} zoom={DEFAULT_ZOOM} className="lt-map" scrollWheelZoom style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution={TILES.attribution} url={TILES.url} maxZoom={19} updateWhenIdle={false} keepBuffer={2} />
          <ZoomWatcher onZoom={setZoom} />
          <MapResize token={resizeToken} />
          {onPickPoint && (
            <MapClick
              onClick={(lat, lng) => {
                setSelectedStop('');
                setPickedPoint([lat, lng]);
              }}
            />
          )}
          {journey && journey.legs.length > 0 ? (
            <JourneyFit journey={journey} />
          ) : (
            bounds.names.length > 0 && <MapBounds stopNames={bounds.names} stops={allStops} padding={bounds.padding} resizeToken={resizeToken} />
          )}
          {/* Порядок шарів задають pane-и, а не порядок монтування: притьмарені лінії → біла підкладка → яскраві → відрізок З→До */}
          <Pane name="lt-lines-dim" style={{ zIndex: 402 }} />
          <Pane name="lt-lines-casing" style={{ zIndex: 404 }} />
          <Pane name="lt-lines" style={{ zIndex: 406 }} />
          <Pane name="lt-segment" style={{ zIndex: 408 }} />
          <Pane name="lt-journey-casing" style={{ zIndex: 410 }} />
          <Pane name="lt-journey" style={{ zIndex: 411 }} />
          <Pane name="lt-journey-walk" style={{ zIndex: 412 }} />
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
          {journey?.legs.map((leg, i) =>
            leg.kind === 'transit' ? (
              <React.Fragment key={`journey-${i}`}>
                <Polyline pane="lt-journey-casing" positions={leg.positions} pathOptions={{ color: '#fff', weight: 11, opacity: 0.95 }} interactive={false} />
                <Polyline
                  pane="lt-journey"
                  positions={leg.positions}
                  pathOptions={{ color: (leg.routeId && routeColor(leg.routeId)) || '#054752', weight: 6, opacity: 1 }}
                  interactive={false}
                />
              </React.Fragment>
            ) : (
              <Polyline
                key={`journey-${i}`}
                pane="lt-journey-walk"
                positions={leg.positions}
                pathOptions={{ color: '#054752', weight: 4, opacity: 0.85, dashArray: '2 8', lineCap: 'round' }}
                interactive={false}
              />
            )
          )}
          {journey?.nodes.map((p, i) => (
            <CircleMarker
              key={`journey-node-${i}`}
              center={p}
              radius={6}
              pane="lt-journey-walk"
              pathOptions={{ color: '#054752', weight: 3, fillColor: '#fff', fillOpacity: 1 }}
              interactive={false}
            />
          ))}
          {fromPoint && (
            <Marker position={fromPoint} icon={ICON_FROM} zIndexOffset={400}>
              <Tooltip direction="top" offset={[0, -10]} className="lt-map-label">
                {fromPointLabel}
              </Tooltip>
            </Marker>
          )}
          {toPoint && (
            <Marker position={toPoint} icon={ICON_TO} zIndexOffset={400}>
              <Tooltip direction="top" offset={[0, -10]} className="lt-map-label">
                {toPointLabel}
              </Tooltip>
            </Marker>
          )}
          {pickedPoint && <Marker position={pickedPoint} icon={ICON_PICK} zIndexOffset={450} />}
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
                    else {
                      setPickedPoint(null);
                      setSelectedStop(n);
                    }
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
        {pickedPoint && onPickPoint && (
          <div className="lt-map-card" role="dialog" aria-label="Точка на карті">
            <div className="lt-map-card__head">
              <strong className="lt-map-card__title">Точка на карті</strong>
              <button ref={closeRef} type="button" className="lt-icon-btn" onClick={() => setPickedPoint(null)} aria-label="Закрити">
                ✕
              </button>
            </div>
            <div className="lt-map-card__actions">
              <button
                type="button"
                className="lt-btn lt-btn--origin"
                onClick={() => {
                  onPickPoint('from', pickedPoint[0], pickedPoint[1]);
                  setPickedPoint(null);
                }}
              >
                Звідси
              </button>
              <button
                type="button"
                className="lt-btn lt-btn--destination"
                onClick={() => {
                  onPickPoint('to', pickedPoint[0], pickedPoint[1]);
                  setPickedPoint(null);
                }}
              >
                Сюди
              </button>
            </div>
          </div>
        )}
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
