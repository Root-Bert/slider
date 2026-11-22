import { useLayoutEffect, useRef } from 'react';
import { ENTRANCE_SECONDS } from '@slider/shared';
import { entranceFrames, type EntrancePlan } from './lib/entrances';

const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

const place = (box: { x: number; y: number; w: number; h: number }) => ({
  left: `${box.x * 100}%`,
  top: `${box.y * 100}%`,
  width: `${box.w * 100}%`,
  height: `${box.h * 100}%`,
});

/**
 * The slide's entrances playing (`entrances.ts`) in the slide's box over its picture: its page and
 * its elements, those that come in hidden until their turn – after `after` ms (the transition
 * first). Calls `onDone` once all are in – the slide's own picture, the same, then shows alone.
 */
export function EntranceStage({
  plan,
  aspect,
  after,
  onDone,
}: {
  plan: EntrancePlan;
  /** Width over height of the slides. */
  aspect: number;
  after: number;
  onDone: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  useLayoutEffect(() => {
    done.current = onDone;
  });

  useLayoutEffect(() => {
    const stage = root.current;
    if (!stage) return;
    const animations: Animation[] = [];
    const nodes = stage.querySelectorAll<HTMLElement>('[data-entrance]');
    plan.layers
      .filter((layer) => layer.entrance)
      .forEach((layer, at) => {
        const node = nodes[at];
        if (!node || !layer.entrance) return;
        animations.push(
          node.animate(entranceFrames(layer.entrance, layer.box), {
            duration: ENTRANCE_SECONDS * 1000,
            delay: after + layer.entrance.delay * 1000,
            easing: EASING,
            fill: 'both',
          }),
        );
      });
    const timer = window.setTimeout(() => done.current(), after + plan.seconds * 1000);
    return () => {
      window.clearTimeout(timer);
      for (const animation of animations) animation.cancel();
    };
  }, [plan, after]);

  return (
    <div
      ref={root}
      aria-hidden
      data-entrance-stage
      className="pointer-events-none absolute inset-0 m-auto overflow-hidden"
      style={{ width: `min(100vw, calc(100vh * ${aspect}))`, aspectRatio: `${aspect}` }}
    >
      <img src={plan.background} alt="" draggable={false} className="absolute inset-0 size-full" />
      {plan.layers.map((layer, i) => (
        <img
          key={`${layer.url}-${i}`}
          src={layer.url}
          alt=""
          draggable={false}
          data-entrance={layer.entrance ? '' : undefined}
          className="absolute max-w-none"
          style={place(layer.box)}
        />
      ))}
    </div>
  );
}
