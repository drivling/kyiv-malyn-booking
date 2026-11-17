import type { CSSProperties } from 'react';
import type { AdWallSnapshot } from '@/types';
import { adWhen, pctWidth as pct, plural, whoHue } from './stickerWall';
import { WallFeed, WallTile as Tile } from './WallTiles';

/**
 * Вкладка «Реклама» на стіні (GET /ads/wall, Docs/dovede-roadmap.md, «Облік реклами»). Читається з кількох метрів:
 * - три плитки «сьогодні» — тизер перед табло, ролик /dovede, сторінка /dovede з доступом: одне велике число й смужка
 *   (показали → почали → до кінця; для сторінки — гості проти адміна);
 * - стрічка останніх переглядів — по рядку на перегляд: що з ним сталося, де, з чого, хто (анонімно: кольорова
 *   крапка й останні 4 символи id браузера — та сама людина впізнається в різних рядках). Рядків рівно стільки,
 *   скільки вміщається цілими (WallFeed у WallTiles.tsx міряє висоту), решта не стискається;
 * - внизу тихим рядком — 90 днів.
 */
type View = AdWallSnapshot['views'][number];

const TEASER = '#00aff5';
const INTRO = '#8b6cff';
const PAGE = '#ffb547';
const DEVICE: Record<string, string> = { ios: 'iPhone', android: 'Android', desktop: 'ПК', other: 'інше' };
const ACCESS: Record<string, string> = { guest: 'гість', admin: 'адмін', public: 'усі' };

const shows = (n: number) => plural(n, ['показу', 'показів', 'показів']);
const people = (n: number) => `${n} ${plural(n, ['людина', 'людини', 'людей'])}`;

/** Смужка перегляду: частка «до кінця» і «почали» від показів (сегменти йдуть один за одним) */
function funnel(c: { shown: number; started: number; completed: number }) {
  const whole = Math.max(c.shown, c.started, c.completed);
  return [
    { width: pct(c.completed, whole), tone: 'solid' as const },
    { width: pct(Math.max(0, c.started - c.completed), whole), tone: 'soft' as const },
  ];
}

function status(v: View): { glyph: string; label: string; tone: string } {
  if (v.kind === 'page') return { glyph: '🔑', label: `відкрив сторінку (${ACCESS[v.access ?? ''] ?? 'з доступом'})`, tone: 'page' };
  if (v.punched) return { glyph: '🎫', label: v.completed ? 'досмотрів і прокомпостував квиток' : 'прокомпостував квиток', tone: 'done' };
  if (v.completed) return { glyph: '✓', label: 'досмотрів', tone: 'done' };
  if (v.started) return { glyph: '▶', label: 'почав, не досмотрів', tone: 'started' };
  return { glyph: '·', label: 'лише показ', tone: 'shown' };
}

function FeedRow({ v, stopName, now }: { v: View; stopName: (id: string) => string; now: Date }) {
  const st = status(v);
  const place =
    v.placement === 'sticker' ? (v.stopId ? stopName(v.stopId) : 'Табло зупинки') : v.kind === 'page' ? 'Сторінка «Доведе»' : 'Ролик «Доведе»';
  const where = v.placement === 'sticker' ? 'табло' : v.kind === 'page' ? ACCESS[v.access ?? ''] ?? null : v.punched ? 'квиток' : null;
  const color = v.placement === 'sticker' ? TEASER : v.kind === 'page' ? PAGE : INTRO;
  return (
    <li className={`wall-ads-item wall-ads-item--${st.tone}`} style={{ '--c': color } as CSSProperties}>
      <span className="wall-ads-status" title={st.label}>
        <span aria-hidden="true">{st.glyph}</span>
        <span className="wall-sr">{st.label}</span>
      </span>
      <span className="wall-ads-place">
        <b>{place}</b>
        {where && <small>{where}</small>}
      </span>
      <span className="wall-ads-who">
        {v.device && <span className="wall-ads-extra">{DEVICE[v.device] ?? v.device}</span>}
        {v.who && (
          <span className="wall-ads-id" style={{ '--h': whoHue(v.who) } as CSSProperties}>
            #{v.who}
          </span>
        )}
        {v.seenBefore > 0 && (
          <span className="wall-ads-again" title={`уже бачив рекламу: ${v.seenBefore}`}>
            ↻ {v.seenBefore + 1}
            <span className="wall-ads-extra">-й раз</span>
          </span>
        )}
      </span>
      <time className="wall-ads-when" dateTime={v.at}>
        {adWhen(v.at, now)}
      </time>
    </li>
  );
}

export function WallAds({ ads, stopName, now }: { ads: AdWallSnapshot | null; stopName: (id: string) => string; now: Date }) {
  if (!ads) {
    return (
      <div className="wall-empty">
        <p>Завантажую перегляди реклами…</p>
      </div>
    );
  }
  const s = ads.sticker;
  const d = ads.dovede;
  // todayAccess — з новішого бекенду; без нього розкладу «гості / адмін» за сьогодні немає
  const ta = d.todayAccess ?? null;
  const pages = Math.max(1, d.today.pages);
  const guests = ta ? ta.guest + ta.public : 0;
  const total90 = [
    `тизер ${s.total.completed} з ${s.total.shown}`,
    `ролик ${d.total.completed} з ${d.total.shown}${d.total.punched ? ` (квитків ${d.total.punched})` : ''}`,
    `сторінка ${d.total.pages}${d.access.guest + d.access.public ? ` (гості ${d.access.guest + d.access.public})` : ''}`,
    `${people(s.people)} з наклейок`,
  ];

  return (
    <div className="wall-ads">
      <div className="wall-ads-tiles">
        <Tile
          title="Тизер на табло"
          color={TEASER}
          value={s.today.completed}
          unit="до кінця"
          bar={funnel(s.today)}
          sub={s.today.shown ? [`з ${s.today.shown} ${shows(s.today.shown)}`, `почали ${s.today.started}`] : ['ще не показували']}
        />
        <Tile
          title="Ролик «Доведе»"
          color={INTRO}
          value={d.today.completed}
          unit="до кінця"
          bar={funnel(d.today)}
          sub={
            d.today.shown
              ? // квитки (прокомпостували талон після ролика) — крок після «до кінця»; «почали» видно на смужці
                [`з ${d.today.shown} ${shows(d.today.shown)}`, d.today.punched != null ? `квитків ${d.today.punched}` : `почали ${d.today.started}`]
              : ['ще не показували']
          }
        />
        <Tile
          title="Сторінка «Доведе»"
          color={PAGE}
          value={d.today.pages}
          unit={plural(d.today.pages, ['вхід', 'входи', 'входів'])}
          bar={ta ? [{ width: pct(guests, pages), tone: 'solid' }, { width: pct(ta.admin, pages), tone: 'muted' }] : []}
          sub={[!d.today.pages ? 'ще ніхто не заходив' : ta ? `гості ${guests} · адмін ${ta.admin}` : 'з паролем або адмін']}
        />
      </div>
      {ads.views.length === 0 ? (
        <div className="wall-empty wall-ads-empty">
          <p>Ще ніхто не бачив рекламу — чекаємо на перший скан наклейки</p>
        </div>
      ) : (
        <WallFeed items={ads.views} label="Останні перегляди" keyOf={(v) => v.viewId}>
          {(v) => <FeedRow v={v} stopName={stopName} now={now} />}
        </WallFeed>
      )}
      <p className="wall-ads-foot">
        <span>90 днів</span> {total90.join(' · ')}
      </p>
    </div>
  );
}
