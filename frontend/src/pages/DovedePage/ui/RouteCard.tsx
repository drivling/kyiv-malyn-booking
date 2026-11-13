import { Link } from 'react-router-dom';
import { isoToDateUrl } from '@/pages/LocalTransportPage/dateUrl';
import { routeColorStyle } from '@/pages/LocalTransportPage/routeColors';
import { clock } from '../compose/narrate';
import type { ComposeOutcome, RouteInfoItem } from '../compose/types';

type RouteInfo = Extract<ComposeOutcome, { kind: 'route_info' }>;

/**
 * Відповідь на питання про маршрут («куди їде №5», «коли 9-ка з Царського села»; Docs/dovede-roadmap.md,
 * фаза 4): кінцеві, найближчі відправлення й посилання на сторінку маршруту. Кілька названих маршрутів
 * («коли їдуть 5 і 7 з лікарні») — одна картка з розділом на кожен. Час — з розкладу сайту.
 */
export function RouteCard({ info, date, today, stopName }: { info: RouteInfo; date: string; today: boolean; stopName: (id: string) => string }) {
  const many = info.items.length > 1;
  const section = (item: RouteInfoItem) => {
    const ends = [item.fromName, item.toName].filter(Boolean).join(' — ');
    const none = item.boards.length === 0;
    // у спільній картці — коротше: два напрямки й чотири найближчі рейси на маршрут
    const boards = many ? item.boards.slice(0, 2) : item.boards;
    return (
      <div className="dv-route__item" key={item.routeId}>
        <div className="dv-card__top">
          <span className="dv-badge" style={routeColorStyle(item.routeId)}>
            №{item.no}
          </span>
          <span className="dv-card__title">{many ? ends || `Міський автобус №${item.no}` : `Міський автобус №${item.no}`}</span>
        </div>
        {ends && !many ? <p className="dv-card__place">{ends}</p> : null}
        {info.atStopLabel && none ? <p className="dv-meta">Через «{info.atStopLabel}» цей автобус не ходить або звідси вже не везе.</p> : null}
        {!info.atStopLabel && none ? <p className="dv-meta">На цей день рейсів у розкладі немає.</p> : null}
        {boards.map((b) => (
          <div className="dv-route__dir" key={`${b.fromStopId}>${b.towardStopId}`}>
            <p className="dv-route__head">
              {info.atStopId ? 'від' : 'з кінцевої'} «{stopName(b.fromStopId)}» → до «{stopName(b.towardStopId)}»
            </p>
            {b.next.length ? (
              <p className="dv-route__times">
                {(many ? b.next.slice(0, 4) : b.next).map((m) => (
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
        <Link className={many ? 'dv-route__more' : 'dv-btn'} to={`/transport/route/${encodeURIComponent(item.routeId)}?d=${isoToDateUrl(date)}`}>
          {many ? `Розклад і зупинки №${item.no} →` : 'Розклад і зупинки маршруту →'}
        </Link>
      </div>
    );
  };
  return (
    <div className={`dv-card dv-route${many ? ' dv-route--many' : ''}`}>
      {many ? <p className="dv-route__lead">Міські автобуси №{info.items.map((i) => i.no).join(', №')}{info.atStopLabel ? ` — від «${info.atStopLabel}»` : ''}</p> : null}
      {info.items.map(section)}
    </div>
  );
}
