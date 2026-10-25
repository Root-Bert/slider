import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { TransitLines } from './TransitLines';

/**
 * The one company workspace of the viewer's domain on the welcome page: big, over a moving
 * transit map in space, mark and name top left, the action bottom right. On hover it grows a
 * little and glows like the website's plan cards – a light following the pointer, the rim lit
 * around it.
 */
export function FeaturedJoinCard({
  leading,
  title,
  subtitle,
  action,
}: {
  leading: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  action: ReactNode;
}) {
  const followPointer = usePointerSpot();
  return (
    <li
      className="group hero-glow relative flex min-h-72 flex-col justify-between gap-20 overflow-hidden rounded-panel p-6 ring-hairline transition-[scale,box-shadow] duration-500 ease-emphasized focus-within:shadow-card-glow hover:shadow-card-glow motion-safe:hover:scale-[1.015] sm:p-8"
      onPointerMove={followPointer}
    >
      {/* First, so the positioned content after it paints on top. */}
      <TransitLines className="absolute inset-0 size-full" />
      <span className="pointer-light pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <span className="pointer-rim pointer-events-none absolute inset-0 rounded-panel opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <span className="relative flex min-w-0 items-center gap-4">
        <span className="flex shrink-0">{leading}</span>
        <span className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-2xl font-semibold tracking-tight text-fg">{title}</span>
          <span className="truncate text-sm text-fg-subtle">{subtitle}</span>
        </span>
      </span>
      <span className="relative flex justify-end">{action}</span>
    </li>
  );
}

/**
 * Where the pointer is on the card, for its light and rim (`--mx`/`--my`): one write per frame,
 * however often the pointer moves.
 */
function usePointerSpot() {
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (event: PointerEvent<HTMLElement>) => {
    const card = event.currentTarget;
    const { clientX, clientY } = event;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const box = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${clientX - box.left}px`);
      card.style.setProperty('--my', `${clientY - box.top}px`);
    });
  };
}
