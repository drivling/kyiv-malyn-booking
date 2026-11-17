import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { isoToDateUrl } from '@/pages/LocalTransportPage/dateUrl';
import { routeColorStyle } from '@/pages/LocalTransportPage/routeColors';
import { ZUBASTYK_MAIN_PHONE, zubastykTelHref } from '@/pages/MizhgorodskiPage/phoneOnlyBooking';
import { routeNo } from '@/utils/routeNames';
import { clock } from '../compose/narrate';
import type { Story, StoryLeg } from '../compose/types';
import { FlapTime } from './FlapTime';
import { durationText, metersText, stopsText } from './format';
import { METRO_LINE } from '../data/kyivMetroService';
import { RING_COLOR } from '../data/kyivRing';
import { CityLegCard } from './CityLegCard';
import { MetroCard } from './MetroCard';
import { RingCard } from './RingCard';
import { RideNote } from './RideBoard';

type IntercityLeg = Extract<StoryLeg, { kind: 'intercity' }>;
type BusLeg = Extract<StoryLeg, { kind: 'bus' }>;
type RideLeg = Extract<StoryLeg, { kind: 'ride' }>;

function intercityTitle(l: IntercityLeg): string {
  const dir = l.routeLabel;
  return l.mode === 'elektrichka' ? `Електричка${l.tripNumber ? ` ${l.tripNumber}` : ''} · ${dir}` : `Маршрутка ${dir}`;
}

/**
 * Міжміський рейс — як квиток (у дусі Passbook): кольорова смуга виду транспорту, перфорація і «відривний»
 * корінець з ціною та дією. Лише міжміські: міські автобуси лишаються простими картками, щоб квиток виділявся.
 */
function IntercityCard({ l }: { l: IntercityLeg }) {
  const hasStub = Boolean(l.priceUah || l.phoneOnly || l.ticketUrl);
  return (
    <div className={`dv-card dv-ticket dv-ticket--${l.mode}`}>
      <div className="dv-ticket__main">
        <div className="dv-card__top">
          <span className="dv-card__title">{intercityTitle(l)}</span>
          {l.via ? <span className="dv-tag">{l.via}</span> : null}
          {l.transit ? <span className="dv-tag">{l.transit}</span> : null}
          {l.usual ? <span className="dv-tag dv-tag--usual">зазвичай</span> : null}
          {l.mode === 'elektrichka' && !l.alightApprox ? <span className="dv-tag">розклад УЗ</span> : null}
        </div>
        <p className="dv-card__place">Відправлення {l.boardLabel}</p>
        <p className="dv-meta">
          <span>
            Вийти {l.alightLabel} {clock(l.alightMins, l.alightApprox)}
          </span>
          <span>у дорозі {l.alightApprox || l.boardApprox ? '≈ ' : ''}{durationText(l.alightMins - l.boardMins)}</span>
        </p>
        {l.phoneOnly ? (
          <p className="dv-note">
            Зараз місця бронюють лише телефоном: <b>{ZUBASTYK_MAIN_PHONE.label}</b>
          </p>
        ) : null}
        {l.later.length ? <p className="dv-more">Інші рейси: {l.later.join(' · ')}</p> : null}
      </div>
      {hasStub ? (
        <div className="dv-ticket__stub">
          {l.priceUah ? (
            <p className="dv-ticket__price">
              {l.priceUah} ₴<small>за місце</small>
            </p>
          ) : (
            <span />
          )}
          {l.phoneOnly ? (
            <a className="dv-btn dv-btn--primary" href={zubastykTelHref()}>
              Подзвонити
            </a>
          ) : null}
          {l.ticketUrl ? (
            <a className="dv-btn dv-btn--primary" href={l.ticketUrl} target="_blank" rel="noopener noreferrer">
              Квиток ↗
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Попутка — та сама записка зі шпилькою й відривним корінцем, що й на дошці, і під нею чесний підпис:
 * де сісти (зі слів водія або «зазвичай»), скільки їхати і що час приблизний.
 */
function RideCard({ l }: { l: RideLeg }) {
  return (
    <div className="dv-ride">
      <RideNote ride={l.ride} n={0} as="div" />
      <dl className="dv-ride__facts">
        <div>
          <dt>Посадка</dt>
          <dd>
            {l.boardLabel}
            {l.boardAssumed ? <small> — водій місця не назвав, уточніть</small> : null}
          </dd>
        </div>
        <div>
          <dt>Висадка</dt>
          <dd>
            {l.alightLabel} {clock(l.arrMins, true)}
            {l.alightAssumed ? <small> — уточніть у водія</small> : null}
          </dd>
        </div>
        <div>
          <dt>У дорозі</dt>
          <dd>
            ≈ {durationText(l.driveMinutes)}
            <small>{l.traffic ? ' — із заторами' : ' — звичайний час авто'}</small>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function busHref(l: BusLeg, date: string): string {
  const p = new URLSearchParams({ d: isoToDateUrl(date), h: clock(l.depMins), stop: l.fromStopId, to: l.toStopId, dir: l.direction });
  return `/transport/route/${encodeURIComponent(l.routeId)}?${p.toString()}`;
}

function BusCard({ l, date, stopName }: { l: BusLeg; date: string; stopName: (id: string) => string }) {
  return (
    <Link className="dv-card dv-bus" to={busHref(l, date)} aria-label={`Автобус №${routeNo(l.routeId)} о ${clock(l.depMins)}: розклад і зупинки`}>
      <span className="dv-card__top">
        <span className="dv-badge" style={routeColorStyle(l.routeId)}>
          №{routeNo(l.routeId)}
        </span>
        <span className="dv-card__title">Міський автобус о {clock(l.depMins)}</span>
      </span>
      <span className="dv-stops">
        <b>{stopName(l.fromStopId)}</b> → <b>{stopName(l.toStopId)}</b>
      </span>
      <span className="dv-meta">
        <span>{stopsText(l.stops)}</span>
        <span>{durationText(l.arrMins - l.depMins)}</span>
      </span>
      {l.note ? <span className="dv-more">{l.note}</span> : null}
    </Link>
  );
}

function legTime(l: StoryLeg): string {
  if (l.kind === 'intercity') return clock(l.boardMins, l.boardApprox);
  if (l.kind === 'bus' || l.kind === 'ride' || l.kind === 'ring') return clock(l.depMins);
  if (l.kind === 'metro') return l.closed ? '' : clock(l.depMins, true);
  if (l.kind === 'city') return l.depMins != null ? clock(l.depMins, true) : '';
  return '';
}

function legStyle(l: StoryLeg): CSSProperties | undefined {
  if (l.kind === 'intercity') return { '--dv-c': l.mode === 'elektrichka' ? 'var(--dv-train)' : 'var(--dv-marsh)' } as CSSProperties;
  if (l.kind === 'ride') return { '--dv-c': 'var(--dv-ride)' } as CSSProperties;
  if (l.kind === 'city' && l.route) return { '--dv-c': 'var(--dv-city)' } as CSSProperties;
  if (l.kind === 'metro') return { '--dv-c': METRO_LINE[l.segments[0].line].color } as CSSProperties;
  if (l.kind === 'ring') return { '--dv-c': l.ride.extra ? RING_COLOR.extra : RING_COLOR.main } as CSSProperties;
  if (l.kind === 'bus') return { ...routeColorStyle(l.routeId), '--dv-c': 'var(--lt-route-color, var(--dv-ink))' } as CSSProperties;
  return undefined;
}

function LegBody({ l, date, stopName }: { l: StoryLeg; date: string; stopName: (id: string) => string }) {
  switch (l.kind) {
    case 'intercity':
      return <IntercityCard l={l} />;
    case 'metro':
      return <MetroCard l={l} />;
    case 'ring':
      return <RingCard l={l} />;
    case 'ride':
      return <RideCard l={l} />;
    case 'city':
      return <CityLegCard l={l} />;
    case 'bus':
      return <BusCard l={l} date={date} stopName={stopName} />;
    case 'walk':
      return (
        <p className={`dv-line-note${l.late ? ' dv-line-note--warn' : ''}`}>
          {l.late ? 'Міські автобуси вже не ходять. ' : ''}Пішки {metersText(l.meters)}, ≈ {durationText(l.minutes)}
          {l.toLabel ? ` до «${l.toLabel}»` : ''}.
        </p>
      );
    case 'wait':
      return <p className="dv-line-note">{l.text}</p>;
    case 'kyiv':
      return (
        <div className="dv-kyiv">
          <span className="dv-kyiv__head">{l.city ?? 'Київ'}</span>
          <span>{l.text}</span>
          <a href={l.mapsUrl} target="_blank" rel="noopener noreferrer">
            Маршрут у Google Maps ↗
          </a>
        </div>
      );
  }
}

/** Історія — вертикальна «лінія маршруту» в кольорах відрізків, як на схемі */
export function StoryView({ story, stopName }: { story: Story; stopName: (id: string) => string }) {
  return (
    <ol className="dv-story">
      {story.legs.map((l, i) => {
        const dots = l.kind === 'walk' || l.kind === 'wait' || l.kind === 'kyiv' || (l.kind === 'city' && (!l.route || l.route.steps.every((x) => x.kind === 'walk')));
        return (
          <li key={i} className={`dv-leg${dots ? ' dv-leg--dots' : ''}`} style={legStyle(l)}>
            <span className="dv-leg__time">
              {/* перекидач спрацьовує, коли лягає картка цього кроку (ті самі 340 + i·260 мс, що в CSS) */}
              <FlapTime text={legTime(l)} delayMs={480 + i * 260} />
            </span>
            <span className="dv-leg__rail" aria-hidden="true" />
            <div className="dv-leg__body">
              <LegBody l={l} date={story.date} stopName={stopName} />
            </div>
          </li>
        );
      })}
      <li className="dv-leg dv-leg--end">
        <span className="dv-leg__time">
          <FlapTime text={clock(story.arriveMins, story.arriveApprox)} delayMs={480 + story.legs.length * 260} />
        </span>
        <span className="dv-leg__rail" aria-hidden="true" />
        <div className="dv-leg__body">
          <p className="dv-end">
            {story.endLabel}
            {story.endNote ? <small>{story.endNote}</small> : null}
          </p>
        </div>
      </li>
    </ol>
  );
}
