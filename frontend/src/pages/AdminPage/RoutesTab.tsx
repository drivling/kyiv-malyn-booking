import React, { useMemo } from 'react';
import type { TripPoint, TripRoute } from '@/types';
import { AdminSectionHeader, EmptyState, StatTile, StatTiles } from './kit';
import './SchedulesTab.css';
import './RoutesTab.css';

export interface RoutesTabProps {
  points: TripPoint[];
  routes: TripRoute[];
  loading: boolean;
  onReload: () => void;
  onAddPoint: () => void;
  onEditPoint: (p: TripPoint) => void;
  onDeletePoint: (p: TripPoint) => void;
  onAddRoute: () => void;
  onEditRoute: (r: TripRoute) => void;
  onDeleteRoute: (r: TripRoute) => void;
}

const viaOf = (r: TripRoute) =>
  (r.stops ?? [])
    .filter((s) => s.role === 'via')
    .sort((a, b) => a.position - b.position)
    .map((s) => s.point?.nameUk ?? `#${s.pointId}`);

/** Проблеми маршруту, які видно одразу: немає точок маршруту; коридор без часу авто (попутки в «Доведе» беруть 95 хв) */
function routeFlags(r: TripRoute, isCorridor: boolean): string[] {
  const out: string[] = [];
  if (!(r.stops ?? []).length) out.push('немає точок маршруту');
  if (isCorridor && r.carDurationMinutes == null) out.push('немає часу авто');
  return out;
}

/**
 * «Маршрути» (/admin/routes): міста (точки маршруту) і маршрути TripRoute. Маршрути — деревом: коридор «Київ →
 * Малин» з часом авто, під ним його варіанти «через Ірпінь / Бучу»; проблеми — жовтими мітками. Місто — рядок:
 * прапорці короткими мітками, швидкі напрямки, скільки маршрутів через нього. Форми й видалення — ті самі.
 */
export const RoutesTab: React.FC<RoutesTabProps> = ({ points, routes, loading, onReload, onAddPoint, onEditPoint, onDeletePoint, onAddRoute, onEditRoute, onDeleteRoute }) => {
  const nameOf = useMemo(() => {
    const m = new Map(points.map((p) => [p.id, p.nameUk]));
    return (id: number) => m.get(id) ?? `#${id}`;
  }, [points]);

  const sortOf = useMemo(() => new Map(points.map((p) => [p.id, p.sortOrder])), [points]);

  const tree = useMemo(() => {
    const variants = new Map<number, TripRoute[]>();
    for (const r of routes) {
      if (r.corridorTripRouteId) variants.set(r.corridorTripRouteId, [...(variants.get(r.corridorTripRouteId) ?? []), r]);
    }
    const ids = new Set(routes.map((r) => r.id));
    // коридор — без `corridorTripRouteId`; варіант, чий коридор зник, показуємо як окремий
    const corridors = routes.filter((r) => !r.corridorTripRouteId || !ids.has(r.corridorTripRouteId));
    const order = (r: TripRoute) => [sortOf.get(r.startPointId) ?? 999, sortOf.get(r.endPointId) ?? 999];
    corridors.sort((a, b) => {
      const [a1, a2] = order(a);
      const [b1, b2] = order(b);
      return a1 - b1 || a2 - b2 || a.labelUk.localeCompare(b.labelUk, 'uk');
    });
    return corridors.map((c) => ({ corridor: c, variants: (variants.get(c.id) ?? []).sort((a, b) => a.labelUk.localeCompare(b.labelUk, 'uk')) }));
  }, [routes, sortOf]);

  /** скільки маршрутів починається, закінчується або йде через місто */
  const usage = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of routes) {
      const ids = new Set([r.startPointId, r.endPointId, ...(r.stops ?? []).map((s) => s.pointId)]);
      for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [routes]);

  const corridorsCount = routes.filter((r) => !r.corridorTripRouteId).length;
  const noCar = routes.filter((r) => !r.corridorTripRouteId && r.carDurationMinutes == null).length;
  const noStops = routes.filter((r) => !(r.stops ?? []).length).length;
  const sortedPoints = [...points].sort((a, b) => a.sortOrder - b.sortOrder || a.nameUk.localeCompare(b.nameUk, 'uk'));

  return (
    <div className="sched-tab">
      <AdminSectionHeader
        title="Маршрути"
        purpose="Міста й маршрути, з яких складаються рейси. Варіант «через …» — під своїм коридором."
        actions={
          <>
            <button type="button" className="admin-kit-btn" onClick={onAddRoute}>
              Додати маршрут
            </button>
            <button type="button" className="admin-kit-chip" onClick={onAddPoint}>
              Додати місто
            </button>
            <button type="button" className="admin-kit-chip" onClick={onReload}>
              Оновити
            </button>
          </>
        }
      />

      <StatTiles label="Маршрути й міста">
        <StatTile label="Маршрутів" value={routes.length} sub={routes.length ? `коридорів ${corridorsCount}` : undefined} />
        <StatTile label="Міст" value={points.length} sub={`у пошуку ${points.filter((p) => p.appearInFromTo).length}`} />
        <StatTile label="Без часу авто" value={noCar} tone={noCar ? 'warn' : 'default'} />
        <StatTile label="Без точок маршруту" value={noStops} tone={noStops ? 'warn' : 'default'} />
      </StatTiles>

      {loading ? (
        <p className="sched-note" aria-live="polite">
          Завантаження…
        </p>
      ) : (
        <>
          <section className="sched-group" aria-label="Маршрути">
            <header className="sched-group-head">
              <h3>Маршрути</h3>
              <span className="sched-note">коридор і його варіанти «через …»</span>
            </header>
            {tree.length === 0 ? (
              <EmptyState
                action={
                  <button type="button" className="admin-kit-btn" onClick={onAddRoute}>
                    Додати перший маршрут
                  </button>
                }
              >
                Ще немає маршрутів.
              </EmptyState>
            ) : (
              <ul className="sched-rows">
                {tree.flatMap(({ corridor, variants }) =>
                  [corridor, ...variants].map((r, i) => {
                    const isVariant = i > 0;
                    const via = viaOf(r);
                    const flags = routeFlags(r, !isVariant);
                    return (
                      <li key={r.id} className={`sched-row route-row${isVariant ? ' route-row--variant' : ''}`}>
                        <span className="route-name">
                          {isVariant ? (
                            <span className="route-via">через {via.join(', ') || '…'}</span>
                          ) : (
                            <strong>
                              {nameOf(r.startPointId)} → {nameOf(r.endPointId)}
                            </strong>
                          )}
                          <code className="route-slug">{r.slug}</code>
                        </span>
                        <span className="sched-tags">
                          {!isVariant && variants.length ? <span className="sched-tag">варіантів {variants.length}</span> : null}
                          {!isVariant && via.length ? <span className="sched-tag">через {via.join(', ')}</span> : null}
                          {flags.map((f) => (
                            <span key={f} className="sched-flag">
                              {f}
                            </span>
                          ))}
                        </span>
                        <span className="sched-meta">{r.carDurationMinutes != null ? <span className="sched-note">авто {r.carDurationMinutes} хв</span> : null}</span>
                        <span className="sched-actions">
                          <button type="button" className="admin-kit-linkbtn" onClick={() => onEditRoute(r)} aria-label={`Змінити маршрут ${r.labelUk}`}>
                            Змінити
                          </button>
                          <button type="button" className="admin-kit-dangerbtn" onClick={() => onDeleteRoute(r)} aria-label={`Видалити маршрут ${r.labelUk}`} title="Видалити маршрут">
                            ×
                          </button>
                        </span>
                      </li>
                    );
                  }),
                )}
              </ul>
            )}
          </section>

          <section className="sched-group" aria-label="Міста">
            <header className="sched-group-head">
              <h3>Міста</h3>
              <span className="sched-note">точки маршрутів; порядок — як у списках сайту</span>
            </header>
            {sortedPoints.length === 0 ? (
              <EmptyState>Ще немає міст.</EmptyState>
            ) : (
              <ul className="sched-rows">
                {sortedPoints.map((p) => {
                  const quick = (p.quickDirectPointIds ?? []).map(nameOf);
                  return (
                    <li key={p.id} className="sched-row point-row">
                      <span className="route-name">
                        <strong>{p.nameUk}</strong>
                        <code className="route-slug">
                          {p.code} · {p.sortOrder}
                        </code>
                      </span>
                      <span className="sched-tags">
                        {p.appearInFromTo ? <span className="sched-tag sched-tag--days">у «звідки / куди»</span> : null}
                        {p.appearInPoputky ? <span className="sched-tag">у попутках</span> : null}
                        {p.hasLocalTransport ? <span className="sched-tag">міський транспорт</span> : null}
                        {p.requiredOnTrip ? <span className="sched-tag">обовʼязкова</span> : null}
                        {quick.length ? <span className="sched-tag">швидкі: {quick.join(', ')}</span> : null}
                      </span>
                      <span className="sched-meta">
                        <span className="sched-note">маршрутів {usage.get(p.id) ?? 0}</span>
                      </span>
                      <span className="sched-actions">
                        <button type="button" className="admin-kit-linkbtn" onClick={() => onEditPoint(p)} aria-label={`Змінити місто ${p.nameUk}`}>
                          Змінити
                        </button>
                        <button type="button" className="admin-kit-dangerbtn" onClick={() => onDeletePoint(p)} aria-label={`Видалити місто ${p.nameUk}`} title="Видалити місто">
                          ×
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};
