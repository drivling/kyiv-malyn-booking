import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Button } from '@/components/Button';
import { Select } from '@/components/Select';
import './MapEditorTab.css';

const TRANSPORT_URL = '/data/malyn_transport.json';
const STOPS_COORDS_URL = '/data/stops_coords.json';

interface StopsCoordsData {
  center: [number, number];
  stops: Record<string, [number, number]>;
}

interface RouteStop {
  name: string;
  order_there?: number;
  order_back?: number;
}

interface TransportData {
  supplement?: {
    stops?: {
      stops_by_route?: Record<string, RouteStop[] | string[]>;
    };
  };
}

function getStopNames(stops: RouteStop[] | string[]): string[] {
  if (!stops?.length) return [];
  const first = stops[0];
  return typeof first === 'string' ? (stops as string[]) : (stops as RouteStop[]).map((s) => s.name);
}

function DraggableMarker({
  name,
  position,
  onPositionChange,
}: {
  name: string;
  position: [number, number];
  onPositionChange: (name: string, lat: number, lng: number) => void;
}) {
  const markerRef = useRef<L.Marker | null>(null);

  const eventHandlers = useMemo(
    () => ({
      dragend() {
        const marker = markerRef.current;
        if (marker != null) {
          const latlng = marker.getLatLng();
          onPositionChange(name, latlng.lat, latlng.lng);
        }
      },
    }),
    [name, onPositionChange]
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
      eventHandlers={eventHandlers}
    >
      <Popup>Перетягніть маркер для зміни позиції: {name}</Popup>
    </Marker>
  );
}

function MapBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 1) {
      map.fitBounds(positions as [number, number][], { padding: [30, 30], maxZoom: 16 });
    } else if (positions.length === 1) {
      map.setView(positions[0], 16);
    }
  }, [map, positions]);
  return null;
}

export const MapEditorTab: React.FC = () => {
  const [transportData, setTransportData] = useState<TransportData | null>(null);
  const [coordsData, setCoordsData] = useState<StopsCoordsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<string>('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(TRANSPORT_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Transport')))),
      fetch(STOPS_COORDS_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error('Coords')))),
    ])
      .then(([transport, coords]) => {
        setTransportData(transport);
        setCoordsData(coords);
      })
      .catch((err) => setError(err.message || 'Не вдалося завантажити дані'))
      .finally(() => setLoading(false));
  }, []);

  const routeOptions = useMemo(() => {
    const opts = [{ value: '', label: 'Всі зупинки' }];
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
    const sbr = transportData?.supplement?.stops?.stops_by_route;
    if (!sbr?.[selectedRoute]) return allStops;
    const routeStopNames = new Set(getStopNames(sbr[selectedRoute]));
    return allStops.filter((n) => routeStopNames.has(n));
  }, [coordsData, transportData, selectedRoute]);

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

  const handleDownload = useCallback(() => {
    if (!coordsData) return;
    const blob = new Blob([JSON.stringify(coordsData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stops_coords.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [coordsData]);

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

  return (
    <div className="tab-content map-editor-tab">
      <div className="map-editor-controls">
        <div className="map-editor-select">
          <Select
            label="Маршрут"
            options={routeOptions}
            value={selectedRoute}
            onChange={(e) => setSelectedRoute(e.target.value)}
          />
        </div>
        <div className="map-editor-actions">
          <Button onClick={handleDownload}>
            ⬇ Завантажити stops_coords.json
          </Button>
        </div>
      </div>
      <p className="map-editor-hint">
        Перетягніть маркер на карті для уточнення позиції зупинки. Потім завантажте файл і замініть{' '}
        <code>frontend/public/data/stops_coords.json</code> у проекті.
      </p>
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
              <MapBounds positions={positions} />
              {displayedStops.map((name) => {
                const pos = coordsData.stops[name];
                if (!pos) return null;
                return (
                  <DraggableMarker
                    key={name}
                    name={name}
                    position={pos}
                    onPositionChange={handlePositionChange}
                  />
                );
              })}
            </MapContainer>
          )}
        </div>
        <div className="map-editor-list">
          <h3 className="map-editor-list-title">Зупинки ({displayedStops.length})</h3>
          <ul className="map-editor-stops-list">
            {displayedStops.map((name) => {
              const pos = coordsData.stops[name];
              return (
                <li key={name} className="map-editor-stop-item">
                  <span className="map-editor-stop-name">{name}</span>
                  {pos && (
                    <span className="map-editor-stop-coords">
                      {pos[0].toFixed(6)}, {pos[1].toFixed(6)}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
};
