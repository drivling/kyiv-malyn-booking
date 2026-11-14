import type React from 'react';
import { Composition } from 'remotion';
import { FPS, HEIGHT, WIDTH } from './brand/tokens';
import { STUDIO_TEST_FRAMES, StudioTest } from './scenes/StudioTest';
import { Draft, draftFrames, type DraftProps, MASTER_PLACED, SHORT_PLACED, Teaser, Teaser15 } from './teaser/Teaser';
import { totalFrames } from './teaser/timeline';

const size = { fps: FPS, width: WIDTH, height: HEIGHT };

export const Root: React.FC = () => (
  <>
    <Composition id="Teaser" component={Teaser} durationInFrames={totalFrames(MASTER_PLACED)} {...size} defaultProps={{ showSafe: false, click: false }} />
    <Composition id="Teaser15" component={Teaser15} durationInFrames={totalFrames(SHORT_PLACED)} {...size} defaultProps={{ showSafe: false, click: false }} />
    <Composition
      id="Draft"
      component={Draft}
      durationInFrames={draftFrames(['B1', 'B2'])}
      {...size}
      defaultProps={{ showSafe: false, click: false, shots: ['B1', 'B2'] } satisfies DraftProps}
      calculateMetadata={({ props }) => ({ durationInFrames: draftFrames(props.shots) })}
    />
    <Composition id="StudioTest" component={StudioTest} durationInFrames={STUDIO_TEST_FRAMES} {...size} defaultProps={{ showSafe: false }} />
  </>
);
