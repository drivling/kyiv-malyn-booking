import type { CSSProperties } from 'react';
import type { PeopleWallSnapshot } from '@/types';
import { PASSENGER_MILESTONES, adWhen, nextPassengerMilestone, pctWidth as pct, plural, whoHue } from './stickerWall';
import { WallFeed, WallTile } from './WallTiles';

/**
 * Вкладка «Люди» на стіні (GET /transport/sticker-wall/people, Docs/stop-stickers.md, «Люди з наклейок»): кожна людина
 * з наклейок має номер пасажира в місті. Читається з кількох метрів:
 * - плитки «сьогодні»: нові пасажири (проти вчора), хто повернувся (сканував знову чи відкрив сайт), і номер
 *   останнього пасажира зі смужкою до найближчого рубежу («до № 400 — ще 88»);
 * - стрічка останніх пасажирів: плашка «№ 37» сталого кольору (той самий відтінок, що «хто» у «Рекламі»), де зараз,
 *   «новий» / «↻ 3-й день» / «↻ на сайті» (повернувся без скану — тоді місце його наклейки), з якої зупинки прийшов
 *   уперше, скільки зупинок, коли;
 * - рядок «90 днів».
 */
type Person = PeopleWallSnapshot['people'][number];

const NEW = '#3ddc97';
const BACK = '#ffb547';
const PASSENGERS = '#00aff5';

const people = (n: number) => plural(n, ['людина', 'людини', 'людей']);
const stopsLabel = (n: number) => `${n} ${plural(n, ['зупинка', 'зупинки', 'зупинок'])}`;

/** Порядковий день: 2-й, 3-й… */
const dayOrdinal = (n: number) => `${n}-й день`;

function status(p: Person): { tag: string; tone: 'new' | 'back' | 'site' } {
  if (p.isNew) return { tag: 'новий', tone: 'new' };
  if (p.kind === 'return') return { tag: '↻ на сайті', tone: 'site' };
  return { tag: p.scanDays >= 2 ? `↻ ${dayOrdinal(p.scanDays)}` : '↻ знову', tone: 'back' };
}

function PersonRow({ p, stopName, now }: { p: Person; stopName: (id: string) => string; now: Date }) {
  const st = status(p);
  // повернувся на сайт без скану — місце: його наклейка; інакше — де відсканував щойно
  const place = stopName(p.kind === 'return' ? p.firstStopId : p.lastStopId);
  const firstElsewhere = p.kind === 'scan' && p.firstStopId !== p.lastStopId;
  return (
    <li className={`wall-ads-item wall-people-item wall-people-item--${st.tone}`} style={{ '--c': st.tone === 'new' ? NEW : BACK } as CSSProperties}>
      <span className="wall-people-no" style={{ '--h': whoHue(p.who) } as CSSProperties} title={`анонімний браузер #${p.who}`}>
        №{p.number}
      </span>
      <span className="wall-ads-place">
        <b>{place}</b>
        <small className="wall-people-tag">{st.tag}</small>
      </span>
      <span className="wall-ads-who">
        {firstElsewhere && <span className="wall-ads-extra">уперше — {stopName(p.firstStopId)}</span>}
        {p.stops >= 2 && (
          <span className="wall-people-stops" title={stopsLabel(p.stops)}>
            <span aria-hidden="true">{'●'.repeat(Math.min(p.stops, 5))}</span> {p.stops}
          </span>
        )}
        {p.teaser && (
          <span className="wall-ads-extra" title="досмотрів тизер «Доведе»">
            ✓ тизер
          </span>
        )}
      </span>
      <time className="wall-ads-when" dateTime={p.at}>
        {adWhen(p.at, now)}
      </time>
    </li>
  );
}

export function WallPeople({ data, stopName, now }: { data: PeopleWallSnapshot | null; stopName: (id: string) => string; now: Date }) {
  if (!data) {
    return (
      <div className="wall-empty">
        <p>Завантажую пасажирів…</p>
      </div>
    );
  }
  const next = nextPassengerMilestone(data.total);
  // смужка — від попереднього рубежу до наступного
  const prev = [0, ...PASSENGER_MILESTONES].filter((m) => m <= data.total).pop() ?? 0;
  const active = data.today.new + data.today.returned;
  const d = data.d90;
  const foot = [
    `нових ${d.new}`,
    `повертались ${d.returned}${d.new ? ` (${Math.round((d.returned / d.new) * 100)} %)` : ''}`,
    `на ≥ 2 зупинках ${d.multiStop}`,
    `досмотріли тизер ${d.teaser}`,
  ];

  return (
    <div className="wall-ads">
      <div className="wall-ads-tiles">
        <WallTile
          title="Нові пасажири"
          color={NEW}
          value={data.today.new}
          unit="сьогодні"
          bar={[{ width: pct(data.today.new, Math.max(data.today.new, data.yesterday.new)), tone: 'solid' }]}
          sub={[`вчора ${data.yesterday.new}`]}
        />
        <WallTile
          title="Повернулись"
          color={BACK}
          value={data.today.returned}
          unit={people(data.today.returned)}
          bar={[{ width: pct(data.today.returned, active), tone: 'solid' }]}
          sub={[`за 7 днів ${data.returned7d}`]}
        />
        <WallTile
          title="Пасажирів"
          color={PASSENGERS}
          prefix="№ "
          value={data.total}
          unit="останній"
          bar={[{ width: pct(data.total - prev, next - prev), tone: 'solid' }]}
          sub={[`до № ${next} — ще ${next - data.total}`]}
        />
      </div>
      {data.people.length === 0 ? (
        <div className="wall-empty wall-ads-empty">
          <p>Ще нікого — чекаємо на першого пасажира з наклейки</p>
        </div>
      ) : (
        <WallFeed items={data.people} label="Останні пасажири" keyOf={(p) => `${p.number}`}>
          {(p) => <PersonRow p={p} stopName={stopName} now={now} />}
        </WallFeed>
      )}
      <p className="wall-ads-foot">
        <span>90 днів</span> {foot.join(' · ')}
      </p>
    </div>
  );
}
