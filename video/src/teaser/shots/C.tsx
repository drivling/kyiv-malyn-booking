import type React from 'react';
import { useCurrentFrame } from 'remotion';
import { ease } from '../../brand/camera';
import { Capture } from '../../brand/Capture';
import { FILL_ZOOM, PhoneFrame } from '../../brand/PhoneFrame';
import type { Placed } from '../timeline';

/**
 * Своїми словами (script.md, C) — дубль «hero» (capture/scenes/hero.mjs): порожня сторінка 0–9, набір з 10-го,
 * Enter на 96-му, тап «Маршрутка» на 156-му. C1 — телефон в'їжджає; C2 — набір і наїзд на «Розумію…»; C3 — камера
 * відходить, картки «Електричка / Маршрутка»; C4 — тап, і камера «влітає» в екран: наприкінці екран рівно на весь
 * кадр — далі історія без рамки (D1). Камера підіймає телефон (`shiftY`), щоб рядок «Розумію…» і картки були вище
 * нижніх 35 % кадру (там інтерфейс Reels).
 */
const HERO = 'hero';
/** «Розумію: з Київ · Святошин до Малин · вокзал · завтра зранку» — частки екрана */
const UNDERSTAND = { x: 0.42, y: 0.68 };
const UNDERSTAND_ZOOM = 1.32;
const UNDERSTAND_SHIFT = -380;
/** Картки вибору — вище нижньої безпечної межі */
const CARDS_SHIFT = -260;

export const C1: React.FC<{ shot: Placed }> = () => (
  <PhoneFrame enterFrom={0}>
    <Capture name={HERO} from={0} rate={0} />
  </PhoneFrame>
);

export const C2: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const k = ease(frame, shot.dur * 0.5, shot.dur * 0.92, 0, 1);
  return (
    <PhoneFrame zoom={{ scale: 1 + (UNDERSTAND_ZOOM - 1) * k, ...UNDERSTAND, shiftY: UNDERSTAND_SHIFT * k }}>
      <Capture name={HERO} from={8} />
    </PhoneFrame>
  );
};

export const C3: React.FC<{ shot: Placed }> = () => {
  const frame = useCurrentFrame();
  const k = ease(frame, 0, 12, 0, 1);
  return (
    <PhoneFrame zoom={{ scale: UNDERSTAND_ZOOM + (1 - UNDERSTAND_ZOOM) * k, ...UNDERSTAND, shiftY: UNDERSTAND_SHIFT + (CARDS_SHIFT - UNDERSTAND_SHIFT) * k }}>
      <Capture name={HERO} from={94} />
    </PhoneFrame>
  );
};

/** Кадр зйомки, з якого починається C4 (тап — на 156-му, тобто на 6-му кадрі C4) */
export const C4_FROM = 150;

export const C4: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const k = ease(frame, shot.dur * 0.45, shot.dur, 0, 1);
  return (
    <PhoneFrame zoom={{ scale: 1 + (FILL_ZOOM.scale - 1) * k, x: FILL_ZOOM.x, y: FILL_ZOOM.y, shiftY: CARDS_SHIFT * (1 - k) }}>
      <Capture name={HERO} from={C4_FROM} />
    </PhoneFrame>
  );
};
