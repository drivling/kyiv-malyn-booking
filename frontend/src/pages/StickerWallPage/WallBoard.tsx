import type { CSSProperties } from 'react';
import type { StickerWallSnapshot } from '@/types';
import { WallBadges } from './WallBadges';
import {
  SCHEME_PALETTE,
  TAB_ROTATE_MS,
  agoLabel,
  growingStops,
  kyivClock,
  kyivHour,
  plural,
  recentHours,
  topStops,
  type WallStop,
} from './stickerWall';

export type WallTab = 'top' | 'growing';

const opens = (n: number) => plural(n, ['відкриття', 'відкриття', 'відкриттів']);

/** Головний екран віджета: ліворуч — сьогодні разом і по годинах, праворуч — «Топ дня» / «Зараз ростуть» */
export function WallBoard({
  snapshot,
  stops,
  now,
  tab,
  onTab,
  tabCycle,
  awake,
  offline,
  soundOn,
}: {
  snapshot: StickerWallSnapshot | null;
  stops: WallStop[];
  now: Date;
  tab: WallTab;
  onTab: (t: WallTab) => void;
  /** Лічильник перемикань — перезапускає смужку автоперемикання */
  tabCycle: number;
  awake: boolean;
  offline: boolean;
  soundOn: boolean;
}) {
  const clock = kyivClock(now);
  const hour = kyivHour(now);
  const total = snapshot?.total ?? 0;
  const delta = snapshot ? total - snapshot.yesterdaySameTime : 0;
  const hourly = snapshot?.hourly ?? Array.from({ length: 24 }, () => 0);
  const peak = Math.max(1, ...hourly);
  const last = [...stops].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))[0] ?? null;
  const list = tab === 'top' ? topStops(stops) : growingStops(stops);
  const listMax = Math.max(1, ...list.map((s) => (tab === 'top' ? s.today : s.last3h)));
  const accent = topStops(stops, 1)[0]?.color ?? SCHEME_PALETTE[0] ?? '#2a78d6';
  const best = snapshot?.bestDay ?? null;

  return (
    <div className="wall-board" style={{ '--accent': accent } as CSSProperties}>
      <header className="wall-top">
        <div className="wall-brand">
          <span className="wall-brand-name">МАЛИН</span>
          <span className="wall-brand-sub">відкриття з QR-наклейок</span>
        </div>
        <div className="wall-status" aria-label="Стан віджета">
          {offline && <span className="wall-chip wall-chip--warn">немає зв'язку</span>}
          {awake && (
            <span className="wall-chip" title="Екран не гасне">
              ☀
            </span>
          )}
          <span className="wall-chip" title={soundOn ? 'Звук увімкнено' : 'Без звуку'}>
            {soundOn ? '♪' : '🔇'}
          </span>
        </div>
        <div className="wall-clock">
          <span className="wall-clock-time">{clock.time}</span>
          <span className="wall-clock-date">{clock.date}</span>
        </div>
      </header>

      <section className="wall-today" aria-label="Сьогодні">
        <div className="wall-stripe" aria-hidden="true">
          {SCHEME_PALETTE.map((c) => (
            <span key={c} style={{ background: c }} />
          ))}
        </div>
        <p className="wall-today-label">Сьогодні</p>
        <p className="wall-today-total" data-testid="wall-total">
          {total}
        </p>
        <p className="wall-today-unit">{opens(total)} з QR</p>
        {snapshot && (
          <p className={`wall-today-delta${delta > 0 ? ' wall-today-delta--up' : ''}`}>
            {delta > 0 ? `▲ +${delta}` : delta < 0 ? `▼ ${delta}` : '='} до вчора на цю пору
            {best && <span className="wall-muted"> · рекорд {best.count}</span>}
          </p>
        )}
        <div className="wall-hours" aria-label="Сьогодні по годинах">
          {hourly.map((v, h) => (
            <span
              key={h}
              className={`wall-hour${h === hour ? ' wall-hour--now' : ''}${h > hour ? ' wall-hour--future' : ''}`}
              style={{ height: `${Math.max(v > 0 ? 8 : 3, (v / peak) * 100)}%` }}
              title={`${String(h).padStart(2, '0')}:00 — ${v}`}
            />
          ))}
        </div>
        <div className="wall-hours-axis" aria-hidden="true">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
        {last && (
          <p className="wall-last">
            <span className="wall-muted">Останнє відкриття · {agoLabel(last.lastAt, now)}</span>
            <b>{last.name}</b>
          </p>
        )}
      </section>

      <section className="wall-list" aria-label={tab === 'top' ? 'Топ дня' : 'Зараз ростуть'}>
        <div className="wall-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'top'}
            className="wall-tab"
            onClick={(e) => {
              e.stopPropagation(); // дотик до вкладки не відкриває налаштування
              onTab('top');
            }}
          >
            Топ дня
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'growing'}
            className="wall-tab"
            onClick={(e) => {
              e.stopPropagation();
              onTab('growing');
            }}
          >
            Зараз ростуть
          </button>
          <span
            key={`${tab}-${tabCycle}`}
            className="wall-tabs-timer"
            style={{ animationDuration: `${TAB_ROTATE_MS}ms` }}
            aria-hidden="true"
          />
        </div>
        {list.length === 0 ? (
          <div className="wall-empty">
            <span className="wall-empty-qr" aria-hidden="true" />
            {tab === 'top' ? (
              <p>Сьогодні ще ніхто не сканував — чекаємо на перше відкриття</p>
            ) : (
              <p>
                Останні 3 години тихо
                {last ? (
                  <>
                    {' '}
                    — востаннє «{last.name}», {agoLabel(last.lastAt, now)}
                  </>
                ) : null}
              </p>
            )}
          </div>
        ) : (
          <ol className="wall-rows">
            {list.map((s, i) => {
              const value = tab === 'top' ? s.today : s.last3h;
              return (
                <li key={s.stopId} className="wall-row" style={{ '--c': s.color } as CSSProperties}>
                  {/* частка від лідера — заливкою тла рядка */}
                  <span className="wall-row-bar" style={{ width: `${(value / listMax) * 100}%` }} aria-hidden="true" />
                  <span className="wall-row-rank">{i + 1}</span>
                  <span className="wall-row-main">
                    <span className="wall-row-name">{s.name}</span>
                    <span className="wall-row-sub">
                      <WallBadges lines={s.lines} max={5} />
                      {tab === 'growing' && (
                        <span className="wall-row-spark" aria-hidden="true">
                          {recentHours(s.hourly, hour).map((h) => (
                            <span key={h.hour} style={{ height: `${Math.max(h.value > 0 ? 18 : 6, (h.value / Math.max(1, ...s.hourly)) * 100)}%` }} />
                          ))}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="wall-row-value">
                    {tab === 'top' ? (
                      <>
                        <b>{s.today}</b>
                        {s.lastHour > 0 && <small>+{s.lastHour} за год</small>}
                      </>
                    ) : (
                      <>
                        <b>▲ {s.lastHour > 0 ? s.lastHour : s.last3h}</b>
                        <small>{s.lastHour > 0 ? 'за годину' : 'за 3 год'}</small>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
