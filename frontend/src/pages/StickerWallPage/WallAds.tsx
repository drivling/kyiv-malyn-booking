import type { CSSProperties } from 'react';
import type { AdWallSnapshot } from '@/types';
import { agoLabel, plural } from './stickerWall';

/**
 * Вкладка «Реклама» на стіні (GET /ads/wall, Docs/dovede-roadmap.md, «Облік реклами»): міні-тизер «Доведе» перед
 * табло зупинки після скану наклейки й ролик-вступ /dovede — сьогодні й за 90 днів, плюс останні перегляди: де, з
 * чого, чи досмотрів, і хто зайшов на /dovede з доступом. «Хто» — анонімно: останні 4 символи id браузера.
 */
const DEVICE: Record<string, string> = { ios: 'iPhone', android: 'Android', desktop: 'компʼютер', other: 'інше' };
const ACCESS: Record<string, string> = { guest: 'гість із паролем', admin: 'адмін', public: 'усі (відкрито)' };
const TEASER = '#00aff5';
const PAGE = '#7c5cff';

const people = (n: number) => `${n} ${plural(n, ['людина', 'людини', 'людей'])}`;

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
  return (
    <>
      <div className="wall-ads-sum">
        <div className="wall-ads-card" style={{ '--c': TEASER } as CSSProperties}>
          <span className="wall-ads-card-title">Тизер на табло</span>
          <span className="wall-ads-card-main">
            <b>{s.today.completed}</b> досмотріли сьогодні
          </span>
          <span className="wall-ads-card-sub">
            показ {s.today.shown} · дивились {s.today.started}
          </span>
          <span className="wall-ads-card-sub wall-muted">
            за 90 днів: {s.total.completed} з {s.total.shown} · {people(s.people)}
          </span>
        </div>
        <div className="wall-ads-card" style={{ '--c': PAGE } as CSSProperties}>
          <span className="wall-ads-card-title">Ролик «Доведе»</span>
          <span className="wall-ads-card-main">
            <b>{d.today.completed}</b> досмотріли сьогодні
          </span>
          <span className="wall-ads-card-sub">
            показ {d.today.shown} · зайшли на сторінку {d.today.pages}
          </span>
          <span className="wall-ads-card-sub wall-muted">
            за 90 днів: {d.total.completed} з {d.total.shown} · входи: гості {d.access.guest}, адмін {d.access.admin}
            {d.access.public ? `, усі ${d.access.public}` : ''}
          </span>
        </div>
      </div>
      {ads.views.length === 0 ? (
        <div className="wall-empty">
          <p>Ще ніхто не бачив рекламу — чекаємо на перший скан наклейки</p>
        </div>
      ) : (
        <ol className="wall-rows wall-ads-rows">
          {ads.views.map((v) => {
            const isPage = v.kind === 'page';
            const where = v.placement === 'sticker' ? (v.stopId ? stopName(v.stopId) : 'Табло') : isPage ? '/dovede — сторінка' : '/dovede — ролик';
            const status = isPage ? (v.access ? ACCESS[v.access] ?? v.access : 'зайшов') : v.completed ? '✓ досмотрів' : v.started ? '▶ дивився' : 'показ';
            const icon = isPage ? '🔑' : v.placement === 'sticker' ? '▣' : '●';
            return (
              <li key={v.viewId} className={`wall-row wall-ads-row${v.completed ? ' wall-ads-row--done' : ''}`} style={{ '--c': isPage ? PAGE : TEASER } as CSSProperties}>
                <span className="wall-row-bar" style={{ width: v.completed || isPage ? '100%' : v.started ? '55%' : '18%' }} aria-hidden="true" />
                <span className="wall-row-rank" aria-hidden="true">
                  {icon}
                </span>
                <span className="wall-row-main">
                  <span className="wall-row-name">{where}</span>
                  <span className="wall-row-sub wall-ads-who">
                    {[v.device ? DEVICE[v.device] ?? v.device : null, v.who ? `#${v.who}` : null, v.seenBefore > 0 ? 'повернувся' : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="wall-row-value">
                  <b className="wall-ads-status">{status}</b>
                  <small>{agoLabel(v.at, now)}</small>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
