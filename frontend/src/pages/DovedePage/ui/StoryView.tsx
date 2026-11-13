import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { isoToDateUrl } from '@/pages/LocalTransportPage/dateUrl';
import { routeColorStyle } from '@/pages/LocalTransportPage/routeColors';
import { ZUBASTYK_MAIN_PHONE, zubastykTelHref } from '@/pages/MizhgorodskiPage/phoneOnlyBooking';
import { routeNo } from '@/utils/routeNames';
import { clock } from '../compose/narrate';
import type { Story, StoryLeg } from '../compose/types';
import { durationText, metersText } from './format';

type IntercityLeg = Extract<StoryLeg, { kind: 'intercity' }>;
type BusLeg = Extract<StoryLeg, { kind: 'bus' }>;

function stopsText(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} зупинка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} зупинки`;
  return `${n} зупинок`;
}

function intercityTitle(l: IntercityLeg): string {
  const dir = l.schedule.route.startsWith('Kyiv') ? 'Київ — Малин' : 'Малин — Київ';
  return l.mode === 'elektrichka' ? `Електричка${l.tripNumber ? ` ${l.tripNumber}` : ''} · ${dir}` : `Маршрутка ${dir}`;
}

function IntercityCard({ l }: { l: IntercityLeg }) {
  return (
    <div className="dv-card">
      <div className="dv-card__top">
        <span className="dv-card__title">{intercityTitle(l)}</span>
        {l.via ? <span className="dv-tag">{l.via}</span> : null}
        {l.usual ? <span className="dv-tag dv-tag--usual">зазвичай</span> : null}
        {l.mode === 'elektrichka' && !l.alightApprox ? <span className="dv-tag">розклад УЗ</span> : null}
      </div>
      <p className="dv-card__place">Відправлення {l.boardLabel}</p>
      <p className="dv-meta">
        <span>
          Вийти {l.alightLabel} {clock(l.alightMins, l.alightApprox)}
        </span>
        <span>у дорозі {l.alightApprox || l.boardApprox ? '≈ ' : ''}{durationText(l.alightMins - l.boardMins)}</span>
        {l.priceUah ? <span>{l.priceUah} ₴</span> : null}
      </p>
      {l.phoneOnly ? (
        <p className="dv-note">
          Зараз місця бронюють лише телефоном: <b>{ZUBASTYK_MAIN_PHONE.label}</b>
        </p>
      ) : null}
      {l.phoneOnly || l.ticketUrl ? (
        <div className="dv-actions">
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
      {l.later.length ? <p className="dv-more">Інші рейси: {l.later.join(' · ')}</p> : null}
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
  if (l.kind === 'bus') return clock(l.depMins);
  return '';
}

function legStyle(l: StoryLeg): CSSProperties | undefined {
  if (l.kind === 'intercity') return { '--dv-c': l.mode === 'elektrichka' ? 'var(--dv-train)' : 'var(--dv-marsh)' } as CSSProperties;
  if (l.kind === 'bus') return { ...routeColorStyle(l.routeId), '--dv-c': 'var(--lt-route-color, var(--dv-ink))' } as CSSProperties;
  return undefined;
}

function LegBody({ l, date, stopName }: { l: StoryLeg; date: string; stopName: (id: string) => string }) {
  switch (l.kind) {
    case 'intercity':
      return <IntercityCard l={l} />;
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
          <span className="dv-kyiv__head">Київ</span>
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
        const dots = l.kind === 'walk' || l.kind === 'wait' || l.kind === 'kyiv';
        return (
          <li key={i} className={`dv-leg${dots ? ' dv-leg--dots' : ''}`} style={legStyle(l)}>
            <span className="dv-leg__time">{legTime(l)}</span>
            <span className="dv-leg__rail" aria-hidden="true" />
            <div className="dv-leg__body">
              <LegBody l={l} date={story.date} stopName={stopName} />
            </div>
          </li>
        );
      })}
      <li className="dv-leg dv-leg--end">
        <span className="dv-leg__time">{clock(story.arriveMins, story.arriveApprox)}</span>
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
