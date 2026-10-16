import { cn, GlassPanel } from '@/ui';
import { CONTROLS_DELAY } from '../lib/import-skeleton';
import { EASE_OUT, type StagePhase } from './stage-motion';

/** Controls row in outline: tool bar, filter, upload – and the slide counter, already counting. */
export function GhostControls({ count, phase }: { count: number | null; phase: StagePhase }) {
  const rise = (index: number) =>
    phase === 'reveal'
      ? `import-fade-out 300ms ease-out ${180 + index * 40}ms forwards`
      : `import-rise 680ms ${EASE_OUT} ${CONTROLS_DELAY + index * 80}ms both`;
  return (
    <div className="flex flex-wrap items-center gap-3 md:flex-nowrap">
      <GlassPanel
        className="flex h-10 w-[265px] shrink-0 items-center p-1"
        style={{ animation: rise(0) }}
      >
        {Array.from({ length: 7 }, (_, i) => (
          <GhostIcon key={i} className={i === 5 ? 'ml-2' : undefined} />
        ))}
      </GlassPanel>
      <GlassPanel
        className="flex h-10 w-[360px] max-w-full min-w-0 items-center gap-3 px-3"
        style={{ animation: rise(1) }}
      >
        {[52, 64, 72].map((width, i) => (
          <span key={i} className="h-3 shrink-0 rounded-full bg-white/10" style={{ width }} />
        ))}
      </GlassPanel>
      <GlassPanel className="flex size-10 shrink-0 items-center p-1" style={{ animation: rise(2) }}>
        <GhostIcon />
      </GlassPanel>
      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        <GlassPanel
          className="flex h-10 shrink-0 items-center gap-2 py-1 pr-4 pl-1 text-base leading-5 tabular-nums max-md:pr-3"
          style={{ animation: rise(3) }}
        >
          <span className="flex h-8 min-w-8 items-center justify-center px-1.5 text-fg-muted">
            1
          </span>
          <span className="text-fg-subtle">/</span>
          {count === null ? (
            <span className="skeleton h-3 w-4 rounded-full" />
          ) : (
            <span key={count} className="animate-pop-in text-fg-muted">
              {count}
            </span>
          )}
        </GlassPanel>
        <GlassPanel className="flex h-10 w-[76px] items-center p-1" style={{ animation: rise(4) }}>
          <GhostIcon />
          <GhostIcon />
        </GlassPanel>
      </div>
    </div>
  );
}

function GhostIcon({ className }: { className?: string }) {
  return (
    <span className={cn('flex size-8 shrink-0 items-center justify-center', className)}>
      <span className="size-4 rounded-[5px] bg-white/10" />
    </span>
  );
}
