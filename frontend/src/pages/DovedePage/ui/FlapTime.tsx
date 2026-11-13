import { useEffect, useState } from 'react';

const TICK_MS = 75;

function motionAllowed(): boolean {
  // jsdom і старі браузери matchMedia не мають — там час показуємо одразу
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Цифра, з якої «перекидач» починає крутитися до потрібної: на `steps` кроків раніше по колу */
function before(digit: string, steps: number): string {
  return String((Number(digit) + 10 - (steps % 10)) % 10);
}

/**
 * Час як на вокзальному табло-перекидачі (Docs/dovede-roadmap.md, фаза 3): кожна цифра кілька разів
 * «перегортається» й зупиняється на своїй, зліва направо. Один раз, коли картка лягає (`delayMs`), і лише для
 * часу на лінії маршруту — решта тексту спокійна. Читачам екрана й тестам — звичайний текст.
 */
export function FlapTime({ text, delayMs = 0 }: { text: string; delayMs?: number }) {
  const approx = text.startsWith('≈');
  const value = approx ? text.slice(1) : text;
  const chars = [...value];
  const digitCount = chars.filter((c) => /\d/.test(c)).length;
  // tick: скільки «перегортань» уже відбулося; null — анімації немає, показуємо одразу
  const [tick, setTick] = useState<number | null>(() => (motionAllowed() ? 0 : null));

  useEffect(() => {
    if (tick === null) return;
    const total = digitCount + 2;
    if (tick >= total) return;
    const t = window.setTimeout(() => setTick(tick + 1), tick === 0 ? delayMs : TICK_MS);
    return () => window.clearTimeout(t);
  }, [tick, delayMs, digitCount]);

  if (!text) return null;
  let di = -1;
  return (
    <span className="dv-flap">
      <span className="dv-sr-only">{text}</span>
      <span className="dv-flap__row" aria-hidden="true">
        {approx ? <span className="dv-flap__pre">≈</span> : null}
        {chars.map((c, i) => {
          if (!/\d/.test(c)) return <span key={i} className="dv-flap__colon">{c}</span>;
          di++;
          // цифра № di зупиняється після (2 + di) перегортань
          const left = tick === null ? 0 : Math.max(0, 2 + di - tick);
          const shown = left ? before(c, left) : c;
          return (
            <span key={i} className="dv-flap__cell">
              {/* key змінюється разом із цифрою — «пластинка» перегортається наново */}
              <span key={shown} className={`dv-flap__face${tick !== null && tick > 0 ? ' is-flip' : ''}`}>
                {shown}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
