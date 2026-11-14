import { Easing, interpolate } from 'remotion';

const smooth = Easing.bezier(0.45, 0, 0.2, 1);

/** Плавний перехід значення `a → b` між кадрами `f0` і `f1` (поза ними — крайні значення) */
export const ease = (frame: number, f0: number, f1: number, a: number, b: number) =>
  interpolate(frame, [f0, f1], [a, b], { easing: smooth, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
