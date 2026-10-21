import { memo, useState } from 'react';
import { cn } from '@/ui';
import { stars } from '../lib/stars';
import { Stars } from './Stars';

/**
 * The lines in a 640×240 box: colour, path, stations, how long a train takes end to end without
 * stopping, its head start, and where along the line (share of its length) its stops are –
 * stations and interchanges, measured once from the path.
 */
const LINES = [
  {
    color: 'var(--color-sage)',
    d: 'M-20 100H208Q220 100 228.5 108.5L261.5 141.5Q270 150 282 150H660',
    stations: [
      [90, 100],
      [470, 150],
      [600, 150],
    ],
    seconds: 18,
    offset: 4,
    stops: [0.157, 0.342, 0.403, 0.57, 0.727],
  },
  {
    color: 'var(--color-sky)',
    d: 'M-20 170H138Q150 170 158.5 161.5L221.5 98.5Q230 90 242 90H408Q420 90 428.5 81.5L441.5 68.5Q450 60 462 60H660',
    stations: [
      [60, 170],
      [330, 90],
      [550, 60],
    ],
    seconds: 24,
    offset: 12,
    stops: [0.313, 0.37, 0.528, 0.848],
  },
  {
    color: 'var(--color-lagoon)',
    d: 'M-20 130H328Q340 130 348.5 138.5L371.5 161.5Q380 170 392 170H660',
    stations: [
      [110, 130],
      [520, 170],
    ],
    seconds: 20,
    offset: 0,
    stops: [0.188, 0.303, 0.389, 0.558, 0.799],
  },
] as const;

/** Where two lines cross: interchanges, drawn bigger and lighter than the other stops. */
const INTERCHANGES = [
  [219, 101],
  [190, 130],
  [250, 130],
  [360, 150],
] as const;

const SKY = stars(28, 640, 240, 3);

/** How long a train waits at a stop it halts at. */
const DWELL_S = 2;

/**
 * The colour a train leaves on the track: layers ending at the train, longer ones fainter, so the
 * colour fades out behind it (length as share of the line, opacity).
 */
const TRAIL = [
  [6, 0.5],
  [14, 0.3],
  [24, 0.18],
  [36, 0.1],
] as const;

type Line = (typeof LINES)[number];

/**
 * One lap of a train: where it is (share of the line) at which share of the lap, halting at about
 * half of its stops – picked at random, so every visit runs a little differently. Gives the SMIL
 * timing the train (`animateMotion`) and its trail layers (`animate`) share, so they pause
 * together, and each trail layer's dash offsets.
 */
function timetable(line: Line) {
  const halts = line.stops.filter(() => Math.random() < 0.5);
  const points = [0];
  const times = [0];
  let at = 0;
  for (const stop of halts) {
    at += (stop - points[points.length - 1]!) * line.seconds;
    points.push(stop);
    times.push(at);
    at += DWELL_S;
    points.push(stop);
    times.push(at);
  }
  at += (1 - points[points.length - 1]!) * line.seconds;
  points.push(1);
  times.push(at);
  return {
    line,
    timing: {
      keyTimes: times.map((time) => (time / at).toFixed(4)).join(';'),
      dur: `${at.toFixed(2)}s`,
      begin: `-${line.offset}s`,
      calcMode: 'linear',
      repeatCount: 'indefinite',
    } as const,
    keyPoints: points.map((point) => point.toFixed(4)).join(';'),
    // Each layer's dash ends at the train: offset = its length minus where the train is.
    trails: TRAIL.map(([length, opacity]) => {
      const offsets = points.map((point) => (length - point * 100).toFixed(2));
      return { length, opacity, from: offsets[0], values: offsets.join(';') };
    }),
  };
}

/**
 * A transit map in space behind the featured card on the welcome page: lines with straight runs,
 * 45° bends and stations, under a few stars. On each a train – the Slider mark, two stacked
 * slides – runs along, halts at some stops and colours the track behind it in the line's colour
 * for a while. SMIL (`animateMotion`), so trains and their trails pause together. The network
 * fades out towards the card's sides (a CSS mask: cheap, unlike an SVG mask redrawn with every
 * frame). Decorative; with reduced motion there are no trains and the stars stand still.
 */
export const TransitLines = memo(function TransitLines({ className }: { className?: string }) {
  const [laps] = useState(() => LINES.map(timetable));
  const box = { viewBox: '0 0 640 240', preserveAspectRatio: 'xMidYMid slice' } as const;
  return (
    <span aria-hidden className={cn('pointer-events-none', className)}>
      <svg {...box} className="absolute inset-0 size-full">
        <Stars sky={SKY} opacity={0.4} />
      </svg>
      <svg
        {...box}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="fade-x absolute inset-0 size-full opacity-70 transition-opacity duration-300 group-hover:opacity-100"
      >
        {LINES.map((line) => (
          <path key={line.d} d={line.d} stroke={line.color} strokeOpacity={0.28} strokeWidth={4} />
        ))}
        {laps.map(({ line, timing, trails }) => (
          <g key={line.d} className="motion-reduce:hidden">
            {trails.map((trail) => (
              <path
                key={trail.length}
                d={line.d}
                pathLength={100}
                stroke={line.color}
                strokeWidth={4}
                strokeLinecap="butt"
                strokeDasharray={`${trail.length} ${100 - trail.length}`}
                strokeDashoffset={trail.from}
                opacity={trail.opacity}
              >
                <animate attributeName="stroke-dashoffset" values={trail.values} {...timing} />
              </path>
            ))}
          </g>
        ))}
        {LINES.flatMap((line) =>
          line.stations.map(([x, y]) => (
            <circle
              key={`${x}-${y}`}
              cx={x}
              cy={y}
              r={3}
              fill="var(--color-canvas)"
              stroke={line.color}
              strokeWidth={1.5}
            />
          )),
        )}
        {INTERCHANGES.map(([x, y]) => (
          <circle
            key={`${x}-${y}`}
            cx={x}
            cy={y}
            r={4.5}
            fill="var(--color-canvas)"
            stroke="var(--color-fg-muted)"
            strokeWidth={2}
          />
        ))}
        {laps.map(({ line, timing, keyPoints }) => (
          <g key={line.d} className="motion-reduce:hidden">
            <animateMotion path={line.d} keyPoints={keyPoints} {...timing} />
            {/* The Slider mark (`ui/Logo`), centred on the track: the line's colour behind white. */}
            <g transform="translate(-8.25 -6.75) scale(0.75)">
              <rect x="1" y="5" width="15" height="11" rx="2.5" fill={line.color} />
              <rect x="5" y="1" width="15" height="11" rx="2.5" fill="var(--color-fg)" />
            </g>
          </g>
        ))}
      </svg>
    </span>
  );
});
