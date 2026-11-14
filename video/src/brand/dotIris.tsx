import type React from 'react';
import { AbsoluteFill, Easing } from 'remotion';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions';
import { COLORS, HEIGHT, WIDTH } from './tokens';

type DotIrisProps = {
  /** Центр крапки, частки кадру */
  x: number;
  y: number;
};

/**
 * Склейка «через крапку»: крапка логотипа росте колом і відкриває наступну сцену, по краю — кільце кольору крапки.
 */
const DotIris: React.FC<TransitionPresentationComponentProps<DotIrisProps>> = ({ children, presentationDirection, presentationProgress, passedProps }) => {
  if (presentationDirection === 'exiting') return <AbsoluteFill>{children}</AbsoluteFill>;
  const { x, y } = passedProps;
  const cx = x * WIDTH;
  const cy = y * HEIGHT;
  const maxR = Math.hypot(Math.max(cx, WIDTH - cx), Math.max(cy, HEIGHT - cy)) + 40;
  const r = Easing.bezier(0.7, 0, 0.3, 1)(presentationProgress) * maxR + 14;
  const edge = Math.max(4, 22 * (1 - presentationProgress));
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `circle(${r}px at ${cx}px ${cy}px)` }}>{children}</AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: cx - r,
          top: cy - r,
          width: r * 2,
          height: r * 2,
          borderRadius: '50%',
          border: `${edge}px solid ${COLORS.accent}`,
          boxSizing: 'border-box',
          opacity: 1 - presentationProgress * 0.6,
        }}
      />
    </AbsoluteFill>
  );
};

export const dotIris = (props: DotIrisProps): TransitionPresentation<DotIrisProps> => ({ component: DotIris, props });
