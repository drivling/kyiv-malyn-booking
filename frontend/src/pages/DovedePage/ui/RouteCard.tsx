import { Link } from 'react-router-dom';
import { isoToDateUrl } from '@/pages/LocalTransportPage/dateUrl';
import { routeColorStyle } from '@/pages/LocalTransportPage/routeColors';
import { clock } from '../compose/narrate';
import type { ComposeOutcome } from '../compose/types';

type RouteInfo = Extract<ComposeOutcome, { kind: 'route_info' }>;

/**
 * Відповідь на питання про маршрут («куди їде №5», «коли 9-ка з Царського села»; Docs/dovede-roadmap.md,
 * фаза 4): кінцеві, найближчі відправлення й посилання на сторінку маршруту. Час — з розкладу сайту.
 */
export function RouteCard({ info, date, today, stopName }: { info: RouteInfo; date: string; today: boolean; stopName: (id: string) => string }) {
  const ends = [info.fromName, info.toName].filter(Boolean).join(' — ');
  const none = info.boards.length === 0;
  return (
    <div className="dv-card dv-route">
      <div className="dv-card__top">
        <span className="dv-badge" style={routeColorStyle(info.routeId)}>
          №{info.no}
        </span>
        <span className="dv-card__title">Міський автобус №{info.no}</span>
      </div>
      {ends ? <p className="dv-card__place">{ends}</p> : null}
      {info.atStopLabel && none ? <p className="dv-meta">Через «{info.atStopLabel}» цей автобус не ходить або звідси вже не везе.</p> : null}
      {!info.atStopLabel && none ? <p className="dv-meta">На цей день рейсів у розкладі немає.</p> : null}
      {info.boards.map((b) => (
        <div className="dv-route__dir" key={`${b.fromStopId}>${b.towardStopId}`}>
          <p className="dv-route__head">
            {info.atStopId ? 'від' : 'з кінцевої'} «{stopName(b.fromStopId)}» → до «{stopName(b.towardStopId)}»
          </p>
          {b.next.length ? (
            <p className="dv-route__times">
              {b.next.map((m) => (
                <span key={m}>{clock(m)}</span>
              ))}
            </p>
          ) : (
            <p className="dv-meta">{today ? 'Сьогодні рейсів більше немає.' : 'Рейсів немає.'}</p>
          )}
          <p className="dv-meta">
            перший {clock(b.first)} · останній {clock(b.last)}
          </p>
        </div>
      ))}
      <Link className="dv-btn" to={`/transport/route/${encodeURIComponent(info.routeId)}?d=${isoToDateUrl(date)}`}>
        Розклад і зупинки маршруту →
      </Link>
    </div>
  );
}
