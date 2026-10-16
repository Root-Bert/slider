import type { CSSProperties } from 'react';
import { cn } from '@/ui';
import type { SlideSketch } from '../lib/import-skeleton';
import { STAGE_TONE } from './stage-tones';

const BAR = cn('absolute rounded-mark', STAGE_TONE.sketchBar);
const SOFT = cn('absolute rounded-mark', STAGE_TONE.sketchSoft);
const pct = (left: number, top: number, width: number, height: number): CSSProperties => ({
  left: `${left}%`,
  top: `${top}%`,
  width: `${width}%`,
  height: `${height}%`,
});

/** Abstract slide content, in % of the slide so it scales with the track. */
export function Sketch({ kind }: { kind: SlideSketch }) {
  const title = <span className={BAR} style={pct(7, 10, 44, 7)} />;
  switch (kind) {
    case 'cover':
      return (
        <>
          <span className={BAR} style={pct(24, 38, 52, 9)} />
          <span className={SOFT} style={pct(32, 53, 36, 4)} />
        </>
      );
    case 'bullets':
      return (
        <>
          {title}
          {[64, 52, 70, 42].map((width, i) => (
            <span key={i}>
              <span
                className={cn('absolute rounded-full', STAGE_TONE.sketchBar)}
                style={pct(8, 31.5 + i * 12, 1.6, 2.8)}
              />
              <span className={SOFT} style={pct(12, 31 + i * 12, width, 3.8)} />
            </span>
          ))}
        </>
      );
    case 'chart':
      return (
        <>
          {title}
          {[26, 38, 32, 50, 44, 60].map((height, i) => (
            <span key={i} className={BAR} style={pct(8 + i * 7.4, 86 - height, 5, height)} />
          ))}
          {[30, 24, 28].map((width, i) => (
            <span key={i} className={SOFT} style={pct(60, 34 + i * 11, width, 3.8)} />
          ))}
        </>
      );
    case 'columns':
      return (
        <>
          {title}
          {[7, 52].map((left) => (
            <span key={left} className={SOFT} style={pct(left, 28, 41, 60)} />
          ))}
          {[7, 52].map((left) => (
            <span key={left} className={BAR} style={pct(left + 4, 36, 22, 5)} />
          ))}
        </>
      );
  }
}
