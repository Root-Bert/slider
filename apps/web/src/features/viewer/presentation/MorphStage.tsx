import { useLayoutEffect, useRef } from 'react';
import type { MorphPart, MorphPlan } from './lib/morph';

const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

const place = (box: { x: number; y: number; w: number; h: number }) => ({
  left: `${box.x * 100}%`,
  top: `${box.y * 100}%`,
  width: `${box.w * 100}%`,
  height: `${box.h * 100}%`,
});

/**
 * The morph playing over the slide show (`morph.ts`): the slide's box on screen, the slide left's
 * page under the new one's fading in, the elements gliding and fading over them. Calls `onDone`
 * once over – the new slide's own picture then shows alone.
 */
export function MorphStage({
  plan,
  aspect,
  duration,
  onDone,
}: {
  plan: MorphPlan;
  /** Width over height of the slides. */
  aspect: number;
  duration: number;
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
    const timing = (extra: KeyframeAnimationOptions = {}): KeyframeAnimationOptions => ({
      duration,
      easing: EASING,
      fill: 'both',
      ...extra,
    });
    const animations: Animation[] = [];
    const animate = (selector: string, frames: Keyframe[], extra?: KeyframeAnimationOptions) => {
      for (const node of stage.querySelectorAll<HTMLElement>(selector))
        animations.push(node.animate(frames, timing(extra)));
    };
    animate('[data-morph="ground-to"]', [{ opacity: 0 }, { opacity: 1 }]);
    animate('[data-morph="out"]', [{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.6 });
    animate('[data-morph="in"]', [{ opacity: 0 }, { opacity: 1 }], {
      delay: duration * 0.4,
      duration: duration * 0.6,
    });
    for (const node of stage.querySelectorAll<HTMLElement>('[data-morph="glide"]')) {
      const from = JSON.parse(node.dataset.from as string) as Record<string, string>;
      const to = JSON.parse(node.dataset.to as string) as Record<string, string>;
      animations.push(node.animate([from, to], timing()));
    }
    // The new look comes in over the old one, which goes once it is mostly there.
    animate('[data-morph="look-to"]', [{ opacity: 0 }, { opacity: 1 }], {
      duration: duration * 0.6,
    });
    animate('[data-morph="look-from"]', [{ opacity: 1 }, { opacity: 0 }], {
      delay: duration * 0.4,
      duration: duration * 0.6,
    });
    const timer = window.setTimeout(() => done.current(), duration);
    return () => {
      window.clearTimeout(timer);
      for (const animation of animations) animation.cancel();
    };
  }, [plan, duration]);

  return (
    <div
      ref={root}
      aria-hidden
      data-morph-stage
      className="pointer-events-none absolute inset-0 z-2 m-auto overflow-hidden"
      style={{ width: `min(100vw, calc(100vh * ${aspect}))`, aspectRatio: `${aspect}` }}
    >
      <Picture url={plan.from} className="absolute inset-0 size-full" />
      <Picture url={plan.to} className="absolute inset-0 size-full" morph="ground-to" />
      {plan.leaving.map((part, i) => (
        <Picture
          key={`out-${part.key}-${i}`}
          url={part.from!.url}
          className="absolute max-w-none"
          style={place(part.from!.box)}
          morph="out"
        />
      ))}
      {plan.coming.map((part, i) => (
        <Coming key={`in-${part.key}-${i}`} part={part} />
      ))}
    </div>
  );
}

function Coming({ part }: { part: MorphPart }) {
  const to = part.to!;
  if (!part.from) {
    return (
      <Picture url={to.url} className="absolute max-w-none" style={place(to.box)} morph="in" />
    );
  }
  return (
    <div
      data-morph="glide"
      data-from={JSON.stringify(place(part.from.box))}
      data-to={JSON.stringify(place(to.box))}
      className="absolute"
      style={place(to.box)}
    >
      <Picture url={part.from.url} className="absolute inset-0 size-full" morph="look-from" />
      <Picture url={to.url} className="absolute inset-0 size-full" morph="look-to" />
    </div>
  );
}

function Picture({
  url,
  className,
  style,
  morph,
}: {
  url: string;
  className: string;
  style?: React.CSSProperties;
  morph?: string;
}) {
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      data-morph={morph}
      className={className}
      style={style}
    />
  );
}
