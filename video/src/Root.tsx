import type React from 'react';
import { Composition } from 'remotion';
import { FPS, HEIGHT, WIDTH } from './brand/tokens';
import { STUDIO_TEST_FRAMES, StudioTest } from './scenes/StudioTest';

export const Root: React.FC = () => (
  <>
    <Composition
      id="StudioTest"
      component={StudioTest}
      durationInFrames={STUDIO_TEST_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ showSafe: false }}
    />
  </>
);
