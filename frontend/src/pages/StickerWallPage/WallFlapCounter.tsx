import type { CSSProperties } from 'react';

/** Третє приземлення крапки в святкуванні новенького (StickerWall.css, `wall-dot-bounce`) — тоді й «клац» (wallSound.ts) */
export const FLAP_AT = 1.13;
/** Перенос: кожна наступна пластинка ліворуч — на стільки секунд пізніше */
export const FLAP_STEP = 0.13;

/**
 * Табло-лічильник із пластинками, як на вокзалі: на святкуванні новенького № 981–1000 (passengerCountdown,
 * stickerWall.ts) показує `from` і з `at` секунди перегортається на `to` — лише ті пластинки, що змінились, справа
 * наліво, як перенос у лічильнику (0999 → 1000 — усі чотири). `goal` — табло досягло круглої тисячі: після
 * перегортання синіє. Номер на екрані вже є в заголовку, тож табло — прикраса (aria-hidden).
 */
export function WallFlapCounter({ from, to, goal = false, at = FLAP_AT }: { from: number; to: number; goal?: boolean; at?: number }) {
  const len = Math.max(4, String(to).length, String(from).length);
  const a = String(from).padStart(len, '0');
  const b = String(to).padStart(len, '0');
  const delays: Array<number | null> = Array(len).fill(null);
  let k = 0;
  for (let i = len - 1; i >= 0; i -= 1) if (a[i] !== b[i]) delays[i] = at + FLAP_STEP * k++;
  const settled = at + FLAP_STEP * Math.max(0, k - 1) + 0.4;
  return (
    <div
      className={`wall-flap-board${goal ? ' wall-flap-board--goal' : ''}`}
      style={{ '--settled': `${settled.toFixed(2)}s` } as CSSProperties}
      data-from={a}
      data-to={b}
      aria-hidden="true"
    >
      {[...b].map((digit, i) => {
        const d = delays[i];
        return (
          <span key={i} className="wall-flap" style={{ '--i': i, ...(d == null ? {} : { '--d': `${d.toFixed(2)}s` }) } as CSSProperties}>
            <span className="wall-flap-half wall-flap-top">
              <span>{digit}</span>
            </span>
            <span className="wall-flap-half wall-flap-bottom">
              <span>{d == null ? digit : a[i]}</span>
            </span>
            {d == null ? null : (
              <>
                <span className="wall-flap-half wall-flap-top wall-flap-fold">
                  <span>{a[i]}</span>
                </span>
                <span className="wall-flap-half wall-flap-bottom wall-flap-unfold">
                  <span>{digit}</span>
                </span>
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}
