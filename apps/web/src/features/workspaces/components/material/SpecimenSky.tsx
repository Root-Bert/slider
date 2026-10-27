import { useId } from 'react';
import { usePrefersReducedMotion } from '@/lib/motion';
import { stars } from '../../lib/stars';
import { Stars } from '../Stars';

/*
 * The space behind a font's specimen: a few stars and one of four scenes after the welcome
 * page's sky – an orbit, a ringed planet, a constellation, a comet. Which one, where and at what
 * pace follows from the font's name, so every card has its own sky and keeps it. All of it moves
 * slowly and little (SMIL, so it stays within its own `<svg>`); at rest under reduced motion and
 * in the blurred halo copy.
 *
 * Drawn in a 320 × 180 box anchored at the top right. The text sits in the middle band
 * (y ≈ 50–130) and the chips in the bottom corners: the scenes keep to the top strip and the
 * right edge.
 */

const W = 320;
const H = 180;

/** Numbers in [0, 1) from a name – the same font always gets the same sky. */
function randomFor(name: string): () => number {
  let state = 2166136261;
  for (const char of name) state = Math.imul(state ^ (char.codePointAt(0) ?? 0), 16777619);
  state >>>= 0;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const between = (random: () => number, min: number, max: number) => min + random() * (max - min);
const fixed = (n: number) => Number(n.toFixed(1));
const point = (cx: number, cy: number, r: number, deg: number) => {
  const rad = (deg * Math.PI) / 180;
  return [fixed(cx + r * Math.cos(rad)), fixed(cy + r * Math.sin(rad))] as const;
};

interface SceneProps {
  random: () => number;
  moving: boolean;
  id: string;
}

/** Hairline arcs around a centre beyond the top-right corner, a satellite drifting on one. */
function Orbit({ random, moving }: SceneProps) {
  const cx = W + between(random, 10, 30);
  const cy = -between(random, 20, 40);
  const radii = [45, 80, 115].map((r) => r + between(random, -6, 6));
  const track = radii[1] as number;
  const end = between(random, 132, 148);
  const [x, y] = point(cx, cy, track, end);
  const [sx, sy] = point(cx, cy, track, end - 30);
  const swing = between(random, 4, 8);
  const dur = between(random, 22, 36);
  return (
    <>
      {radii.map((r, i) => {
        const [ax, ay] = point(cx, cy, r, 90);
        const [bx, by] = point(cx, cy, r, 180);
        return (
          <path
            key={r}
            d={`M${ax} ${ay}A${r} ${r} 0 0 1 ${bx} ${by}`}
            stroke={i === 0 ? 'var(--color-hairline-strong)' : 'var(--color-hairline)'}
          />
        );
      })}
      <g>
        {moving && (
          <animateTransform
            attributeName="transform"
            type="rotate"
            values={`${-swing} ${cx} ${cy};${swing} ${cx} ${cy};${-swing} ${cx} ${cy}`}
            keyTimes="0;0.5;1"
            calcMode="spline"
            keySplines="0.45 0 0.55 1;0.45 0 0.55 1"
            dur={`${dur}s`}
            begin={`${-between(random, 0, dur)}s`}
            repeatCount="indefinite"
          />
        )}
        <path
          d={`M${sx} ${sy}A${track} ${track} 0 0 1 ${x} ${y}`}
          stroke="var(--color-sage)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <Satellite x={x} y={y} moving={moving} random={random} />
      </g>
    </>
  );
}

/** The sage dot with its soft halo, breathing. */
function Satellite({
  x,
  y,
  moving,
  random,
  r = 3.5,
}: {
  x: number;
  y: number;
  moving: boolean;
  random: () => number;
  r?: number;
}) {
  const dur = between(random, 6, 9);
  return (
    <>
      <circle cx={x} cy={y} r={r * 2.3} fill="var(--color-sage)" opacity={0.17}>
        {moving && (
          <>
            <animate
              attributeName="r"
              values={`${r * 2.1};${r * 2.9};${r * 2.1}`}
              dur={`${dur}s`}
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.12;0.24;0.12"
              dur={`${dur}s`}
              repeatCount="indefinite"
            />
          </>
        )}
      </circle>
      <circle cx={x} cy={y} r={r} fill="var(--color-sage)" />
    </>
  );
}

/**
 * A mission diagram: two orbits round a centre beyond the top-right corner and the dashed
 * transfer between them, a craft crossing it slowly and resting on the outer one.
 */
function Transfer({ random, moving }: SceneProps) {
  const cx = W + between(random, 0, 20);
  const cy = -between(random, 10, 30);
  const inner = between(random, 38, 50);
  const outer = between(random, 100, 118);
  const [ax, ay] = point(cx, cy, inner, between(random, 95, 110));
  const [bx, by] = point(cx, cy, outer, between(random, 150, 162));
  const [qx, qy] = point(cx, cy, (inner + outer) * 0.62, between(random, 112, 125));
  const course = `M${ax} ${ay}Q${qx} ${qy} ${bx} ${by}`;
  const dur = between(random, 24, 36);
  const begin = `${-between(random, 0, dur)}s`;
  return (
    <>
      {[inner, outer].map((r) => {
        const [sx, sy] = point(cx, cy, r, 90);
        const [ex, ey] = point(cx, cy, r, 180);
        return (
          <path
            key={r}
            d={`M${sx} ${sy}A${r} ${r} 0 0 1 ${ex} ${ey}`}
            stroke="var(--color-hairline-strong)"
          />
        );
      })}
      <path
        d={course}
        stroke="var(--color-sage)"
        strokeOpacity={0.55}
        strokeDasharray="3 4"
        strokeLinecap="round"
      />
      <circle cx={ax} cy={ay} r={1.6} fill="var(--color-fg)" opacity={0.6} />
      <g transform={moving ? undefined : `translate(${bx} ${by})`}>
        {moving && (
          <animateMotion
            path={course}
            dur={`${dur}s`}
            keyPoints="0;1;1"
            keyTimes="0;0.55;1"
            calcMode="spline"
            keySplines="0.45 0 0.55 1;0 0 1 1"
            begin={begin}
            repeatCount="indefinite"
          />
        )}
        <Satellite x={0} y={0} r={2.6} moving={moving} random={random} />
      </g>
    </>
  );
}

/** Four or five stars joined by hairlines, drawing themselves in and out, one of them sage. */
function Constellation({ random, moving }: SceneProps) {
  const count = 4 + Math.floor(random() * 2);
  const points = Array.from({ length: count }, (_, i) => {
    const x = fixed(W - 20 - (count - 1 - i) * between(random, 18, 26));
    const y = fixed(between(random, 12, 44));
    return [x, y] as const;
  });
  const path = `M${points.map(([x, y]) => `${x} ${y}`).join('L')}`;
  const length = points.slice(1).reduce((total, [x, y], i) => {
    const [px, py] = points[i] as readonly [number, number];
    return total + Math.hypot(x - px, y - py);
  }, 0);
  const lit = Math.floor(random() * count);
  const dur = between(random, 18, 30);
  return (
    <>
      <path
        d={path}
        stroke="var(--color-fg-faint)"
        strokeDasharray={fixed(length)}
        strokeDashoffset={0}
      >
        {moving && (
          <animate
            attributeName="stroke-dashoffset"
            values={`${fixed(length)};0;0;${fixed(-length)}`}
            keyTimes="0;0.35;0.7;1"
            dur={`${dur}s`}
            begin={`${-between(random, 0, dur)}s`}
            repeatCount="indefinite"
          />
        )}
      </path>
      {points.map(([x, y], i) =>
        i === lit ? (
          <g key={i}>
            <Satellite x={x} y={y} r={2.4} moving={moving} random={random} />
            <Reticle x={x} y={y} moving={moving} />
          </g>
        ) : (
          <circle key={i} cx={x} cy={y} r={1.4} fill="var(--color-fg)" opacity={0.6} />
        ),
      )}
    </>
  );
}

/** Four corner marks round a star, as a tracking display locks on – fading in and out. */
function Reticle({ x, y, moving }: { x: number; y: number; moving: boolean }) {
  const d = 7;
  const l = 3;
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const;
  return (
    <g stroke="var(--color-fg-subtle)" strokeWidth={0.8} opacity={0.7}>
      {moving && (
        <animate attributeName="opacity" values="0.15;0.7;0.15" dur="9s" repeatCount="indefinite" />
      )}
      {corners.map(([sx, sy]) => (
        <path
          key={`${sx}${sy}`}
          d={`M${x + sx * d} ${y + sy * (d - l)}V${y + sy * d}H${x + sx * (d - l)}`}
        />
      ))}
    </g>
  );
}

/** Now and then a comet crosses the top strip, slowly, its tail fading behind it. */
function Comet({ random, moving, id }: SceneProps) {
  const from = between(random, 18, 40);
  const to = between(random, 4, 26);
  const path = `M-30 ${fixed(from)}Q${fixed(between(random, 120, 200))} ${fixed(between(random, -10, 10))} ${W + 30} ${fixed(to)}`;
  const dur = between(random, 26, 40);
  const begin = `${-between(random, 0, dur)}s`;
  const gradient = `${id}-tail`;
  return (
    <>
      <defs>
        <linearGradient id={gradient} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="rgb(255 255 255 / 0)" />
          <stop offset="100%" stopColor="rgb(255 255 255 / 0.7)" />
        </linearGradient>
      </defs>
      {/* Its course, barely there. */}
      <path d={path} stroke="var(--color-hairline)" strokeDasharray="2 5" />
      <g
        opacity={moving ? 0 : 1}
        transform={moving ? undefined : `translate(${W - 70} ${fixed(to + 4)})`}
      >
        {moving && (
          <>
            <animateMotion
              path={path}
              rotate="auto"
              dur={`${dur}s`}
              keyPoints="0;1;1"
              keyTimes="0;0.4;1"
              calcMode="linear"
              begin={begin}
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0;0"
              keyTimes="0;0.06;0.34;0.4;1"
              dur={`${dur}s`}
              begin={begin}
              repeatCount="indefinite"
            />
          </>
        )}
        <path d="M-26 0L0 0" stroke={`url(#${gradient})`} strokeWidth={1.4} strokeLinecap="round" />
        <circle r={1.8} fill="var(--color-primary-hover)" />
        <circle r={4.5} fill="var(--color-sage)" opacity={0.25} />
      </g>
    </>
  );
}

const SCENES = [Orbit, Transfer, Constellation, Comet];

/** The space of a font's specimen card: stars and its scene, slightly out of focus. */
export function SpecimenSky({ name, still = false }: { name: string; still?: boolean }) {
  const reduced = usePrefersReducedMotion();
  const moving = !still && !reduced;
  // A fresh, colon-free id per card: gradient ids must be unique on the page.
  const id = `sky${useId().replace(/:/g, '')}`;
  const random = randomFor(name);
  const Scene = SCENES[Math.floor(random() * SCENES.length)] as (typeof SCENES)[number];
  const sky = stars(8, W, H, Math.floor(random() * 2 ** 31));
  return (
    <div aria-hidden className="specimen-sky pointer-events-none absolute inset-0 blur-[1.5px]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMaxYMin slice"
        fill="none"
        className="absolute inset-0 size-full"
      >
        {moving ? (
          <Stars sky={sky} opacity={0.4} />
        ) : (
          sky.map((star) => (
            <circle
              key={`${star.x}-${star.y}`}
              cx={star.x}
              cy={star.y}
              r={star.r}
              fill="var(--color-fg)"
              opacity={0.4}
            />
          ))
        )}
        <Scene random={random} moving={moving} id={id} />
      </svg>
    </div>
  );
}
