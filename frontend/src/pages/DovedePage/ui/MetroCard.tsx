import { Fragment, type CSSProperties } from 'react';
import type { StoryLeg } from '../compose/types';
import { METRO_LINE, METRO_SERVICE } from '../data/kyivMetroService';
import type { TripSegment } from '../data/kyiv';
import { durationText } from './format';

type MetroLeg = Extract<StoryLeg, { kind: 'metro' }>;

function stationsText(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} станція`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} станції`;
  return `${n} станцій`;
}

const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/**
 * Відрізок однією лінією: емальована табличка, як на платформі (смуга кольору лінії, «М», станція посадки,
 * напрямок за кінцевою), і під нею — лінійна схема «як у вагоні»: крапка на кожну станцію, підписані перша й остання.
 */
function Segment({ sg, n }: { sg: TripSegment; n: number }) {
  const line = METRO_LINE[sg.line];
  const last = sg.stations.length - 1;
  return (
    <div className={`dv-metro__seg${sg.bus ? ' dv-metro__seg--bus' : ''}`} style={{ '--dv-m': line.color, '--dv-m-ink': line.ink, '--dv-n': n } as CSSProperties}>
      <div className="dv-metro__plate">
        <span className="dv-metro__m" aria-hidden="true">
          {sg.bus ? 'А' : 'М'}
        </span>
        <span className="dv-metro__name">{sg.from.name}</span>
        <span className="dv-metro__dir">
          {sg.bus ? (
            <>
              <span className="dv-metro__line">№{sg.bus}</span> автобус замість метро, у бік «{sg.towards.name}»
            </>
          ) : (
            <>
              <span className="dv-metro__line">{line.no}</span> у бік «{sg.towards.name}»
            </>
          )}
        </span>
      </div>
      <ol className="dv-metro__strip" aria-label={`${line.no}: від «${sg.from.name}» до «${sg.to.name}», ${stationsText(sg.hops)}`}>
        {sg.stations.map((st, k) => (
          <li key={st.id} className={k === 0 || k === last ? 'is-end' : undefined} title={st.name} style={{ '--dv-k': k } as CSSProperties}>
            <span className="dv-metro__dot" aria-hidden="true" />
            {k === 0 || k === last ? <span className="dv-metro__st">{st.name}</span> : null}
          </li>
        ))}
      </ol>
      <p className="dv-metro__count">
        {stationsText(sg.hops)} · вийти на «{sg.to.name}»
      </p>
    </div>
  );
}

/**
 * Київське метро в історії (Docs/dovede-roadmap.md, «Картка метро»): табличка й схема на кожен відрізок, пересадка —
 * два зчеплені кільця кольорів ліній, унизу — жетон з ціною поїздки. Дані свої; час завжди приблизний.
 */
export function MetroCard({ l }: { l: MetroLeg }) {
  // уся дорога — автобусом-замінником (поїзди на цій дільниці не ходять): без жетона, турнікета й інтервалу поїздів
  const busOnly = l.segments.every((sg) => sg.bus);
  return (
    <div className={`dv-metro${l.closed ? ' dv-metro--closed' : ''}`}>
      {l.closed ? (
        <p className="dv-metro__closed">
          Метро о цій порі не працює: вхід {hhmm(METRO_SERVICE.openMins)}–{hhmm(METRO_SERVICE.closeMins)}. Ось шлях на інший час.
        </p>
      ) : null}
      {l.segments.map((sg, i) => {
        const prev = l.segments[i - 1];
        const t = prev ? l.transfers.find((x) => x.from.id === prev.to.id && x.to.id === sg.from.id) : undefined;
        // та сама лінія без пересадки — це стик поїзда з автобусом-замінником
        const swap =
          prev && !t
            ? sg.bus
              ? `Далі поїзди не ходять — автобус №${sg.bus} від «${sg.from.name}»`
              : `Далі метро від «${sg.from.name}»`
            : !prev && sg.bus
              ? `Поїзди метро тут не ходять — автобус №${sg.bus} від «${sg.from.name}»`
              : null;
        return (
          <Fragment key={`${sg.from.id}-${sg.bus ?? 'm'}`}>
            {swap ? (
              <div className="dv-metro__change dv-metro__change--bus" style={{ '--dv-a': METRO_LINE[sg.line].color, '--dv-b': METRO_LINE[sg.line].color } as CSSProperties}>
                <span className="dv-metro__rings" aria-hidden="true">
                  <i />
                  <i />
                </span>
                <span>
                  {swap}
                  <small>зупинка біля виходу з метро</small>
                </span>
              </div>
            ) : null}
            {i > 0 && t ? (
              <div className="dv-metro__change" style={{ '--dv-a': METRO_LINE[t.from.line].color, '--dv-b': METRO_LINE[t.to.line].color } as CSSProperties}>
                <span className="dv-metro__rings" aria-hidden="true">
                  <i />
                  <i />
                </span>
                <span>
                  Пересадка: «{t.from.name}» → «{t.to.name}»
                  <small>пішки під землею, ≈ {durationText(METRO_SERVICE.transferSeconds / 60)}</small>
                </span>
              </div>
            ) : null}
            <Segment sg={sg} n={i} />
          </Fragment>
        );
      })}
      <div className={`dv-metro__foot${busOnly ? ' dv-metro__foot--plain' : ''}`}>
        {busOnly ? null : (
          <span className="dv-metro__token" aria-label={`Одна поїздка — ${l.priceUah} гривень`}>
            <b>{l.priceUah}</b>
            <small>грн</small>
          </span>
        )}
        <p className="dv-metro__facts">
          {l.closed ? 'У дорозі' : 'Разом'} ≈ {durationText(l.minutes)} — {busOnly ? 'з очікуванням автобуса' : 'з входом, очікуванням і виходом'}
          <small>{busOnly ? 'автобус їде замість поїздів метро, зупинки — біля станцій' : `поїзди кожні ≈ ${l.headwayMin} хв · оплата карткою чи QR-квитком на турнікеті`}</small>
        </p>
        <a className="dv-metro__maps" href={l.mapsUrl} target="_blank" rel="noopener noreferrer">
          Google Maps ↗
        </a>
      </div>
    </div>
  );
}
