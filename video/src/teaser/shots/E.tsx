import type React from 'react';
import { useCurrentFrame } from 'remotion';
import { ease } from '../../brand/camera';
import { Capture } from '../../brand/Capture';
import { PhoneFrame } from '../../brand/PhoneFrame';
import type { Placed } from '../timeline';

/**
 * Дошка попуток (script.md, E) — зйомка «rides»: набір 0–28, Enter на 30-му, дошка з шпильками, тап «Відірвати
 * номер» на 118-му. E1 — набір; E2 — дошка, камера підіймає телефон і ледь наближається; E3 — тап, наїзд на
 * корінець з номером (вище нижніх 35 % кадру, де інтерфейс Reels).
 */
const RIDES = 'rides';
/** Де торкнулися «Відірвати номер» (з manifest.json) — туди й наїжджає камера */
const TEAR = { x: 0.36, y: 0.6 };
const BOARD = { scale: 1.12, x: 0.5, y: 0.62, shiftY: -240 };

export const E1: React.FC<{ shot: Placed }> = () => (
  <PhoneFrame>
    <Capture name={RIDES} from={0} />
  </PhoneFrame>
);

export const E2: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const k = ease(frame, shot.dur * 0.25, shot.dur, 0, 1);
  return (
    <PhoneFrame zoom={{ scale: 1 + (BOARD.scale - 1) * k, x: BOARD.x, y: BOARD.y, shiftY: BOARD.shiftY * k }}>
      <Capture name={RIDES} from={28} />
    </PhoneFrame>
  );
};

export const E3: React.FC<{ shot: Placed }> = ({ shot }) => {
  const frame = useCurrentFrame();
  const k = ease(frame, 6, shot.dur * 0.6, 0, 1);
  return (
    <PhoneFrame
      zoom={{
        scale: BOARD.scale + (1.55 - BOARD.scale) * k,
        x: BOARD.x + (TEAR.x - BOARD.x) * k,
        y: BOARD.y + (TEAR.y - BOARD.y) * k,
        shiftY: BOARD.shiftY + (-330 - BOARD.shiftY) * k,
      }}
    >
      <Capture name={RIDES} from={114} />
    </PhoneFrame>
  );
};
