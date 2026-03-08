import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const STOPS_COORDS_URL = '/data/stops_coords.json';

interface RouteMapProps {
  stopNames: string[];
}

interface CoordsData {
  center: [number, number];
  stops: Record<string, [number, number]>;
}

function MapBounds({ stopNames, stops }: { stopNames: string[]; stops: Record<string, [number, number]> }) {
  const map = useMap();
  useEffect(() => {
    const withCoords = stopNames.filter((n) => stops[n]);
    if (withCoords.length > 1) {
      const bounds = withCoords.map((n) => stops[n] as [number, number]);
      map.fitBounds(bounds as [number, number][], { padding: [30, 30], maxZoom: 15 });
    }
  }, [map, stopNames, stops]);
  return null;
}

export const RouteMap: React.FC<RouteMapProps> = ({ stopNames }) => {
  const [coords, setCoords] = useState<CoordsData | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    fetch(STOPS_COORDS_URL)
      .then((r) => r.json())
      .then(setCoords)
      .catch(() => setCoords(null));
  }, []);

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

  if (!mounted || !coords || stopNames.length === 0) return null;

  const stopsWithCoords = stopNames.filter((n) => coords.stops[n]);

  return (
    <div className="lt-map-wrapper">
      <h3 className="lt-map-heading">Карта маршруту</h3>
      <div className="lt-map-container">
        <MapContainer
          center={coords.center}
          zoom={13}
          className="lt-map"
          scrollWheelZoom
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapBounds stopNames={stopNames} stops={coords.stops} />
          {stopsWithCoords.map((n) => (
            <Marker key={n} position={coords.stops[n] as [number, number]}>
              <Popup>{n}</Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
};
