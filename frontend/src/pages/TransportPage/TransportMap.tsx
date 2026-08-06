import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length >= 1) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
    }
  }, [map, points]);
  return null;
}

function InvalidateOnMount() {
  const map = useMap();
  useEffect(() => {
    const t = window.setTimeout(() => map.invalidateSize(), 100);
    return () => window.clearTimeout(t);
  }, [map]);
  return null;
}

const pin = (color: string, label?: string) =>
  L.divIcon({
    className: 'tp-marker',
    html: `<span class="tp-marker-pin" style="background:${color}">${label ? `<b>${label}</b>` : ''}</span>`,
    iconSize: [28, 36],
    iconAnchor: [14, 36],
  });

type Props = {
  center: [number, number];
  stops: Record<string, [number, number]>;
  /** Полілінія (усі точки, включно з map_only) */
  lineStopIds?: string[];
  /** Маркери пасажирських зупинок */
  markerStopIds?: string[];
  fromId?: string;
  toId?: string;
  stopLabel?: (id: string) => string;
  onPickStop?: (id: string) => void;
  className?: string;
};

export const TransportMap: React.FC<Props> = ({
  center,
  stops,
  lineStopIds = [],
  markerStopIds,
  fromId,
  toId,
  stopLabel = (id) => id,
  onPickStop,
  className,
}) => {
  const markers = markerStopIds ?? lineStopIds;
  const line = useMemo(
    () => lineStopIds.map((id) => stops[id]).filter(Boolean) as [number, number][],
    [lineStopIds, stops]
  );
  const fitPts = useMemo(() => {
    if (line.length) return line;
    return markers.map((id) => stops[id]).filter(Boolean) as [number, number][];
  }, [line, markers, stops]);

  return (
    <div className={className ?? 'tp-map'}>
      <MapContainer center={center} zoom={13} className="tp-map-leaflet" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <InvalidateOnMount />
        {fitPts.length > 0 && <FitBounds points={fitPts} />}
        {line.length >= 2 && <Polyline positions={line} pathOptions={{ color: '#E30613', weight: 4, opacity: 0.85 }} />}
        {markers.map((id) => {
          const pos = stops[id];
          if (!pos) return null;
          const isFrom = id === fromId;
          const isTo = id === toId;
          const color = isFrom ? '#E30613' : isTo ? '#1a5fb4' : '#3388ff';
          const label = isFrom ? 'З' : isTo ? 'Д' : undefined;
          return (
            <Marker
              key={id}
              position={pos}
              icon={pin(color, label)}
              eventHandlers={
                onPickStop
                  ? {
                      click: () => onPickStop(id),
                    }
                  : undefined
              }
            >
              <Popup>
                <strong>{stopLabel(id)}</strong>
                {onPickStop && (
                  <div className="tp-map-popup-actions">
                    <button type="button" onClick={() => onPickStop(id)}>
                      Обрати
                    </button>
                  </div>
                )}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
};
