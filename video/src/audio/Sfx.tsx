import type React from 'react';
import { Audio, Sequence, staticFile } from 'remotion';

/** Звуки з `npm run sound` (public/audio/sfx/<назва>.wav) */
export type SfxName =
  | 'key0' | 'key1' | 'key2' | 'tap' | 'whoosh' | 'riser' | 'impact' | 'hit' | 'tup' | 'ding' | 'bonk'
  | 'pin' | 'rip' | 'tick' | 'flap' | 'beep' | 'pop' | 'ting' | 'clack' | 'thud'
  | `plink${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

export type SfxCue = { name: SfxName; at: number; volume?: number };

/** Звуки кадру: `at` — кадр усередині поточної Sequence */
export const SfxCues: React.FC<{ cues: SfxCue[] }> = ({ cues }) => (
  <>
    {cues.map((c, i) => (
      <Sequence key={`${c.name}-${c.at}-${i}`} from={Math.max(0, Math.round(c.at))} name={`sfx ${c.name}`} layout="none">
        <Audio src={staticFile(`audio/sfx/${c.name}.wav`)} volume={c.volume ?? 0.5} />
      </Sequence>
    ))}
  </>
);
