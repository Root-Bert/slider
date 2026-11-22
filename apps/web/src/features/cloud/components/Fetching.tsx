import { cn, Icon } from '@/ui';

/** A file on its way to this computer, and that it arrived. */
export type FetchState = 'loading' | 'done';

const RING = 2 * Math.PI * 10;

/**
 * Shown on the file itself while „Öffnen“ fetches it: a ring running round an arrow that falls
 * into it again and again; once it is there the ring closes and a tick pops in.
 */
export function Fetching({
  state,
  size = 44,
  className,
}: {
  state: FetchState;
  size?: number;
  className?: string;
}) {
  const done = state === 'done';
  return (
    <span
      role="status"
      aria-label={done ? 'Geöffnet' : 'Wird geholt'}
      className={cn(
        'pointer-events-none relative flex shrink-0 animate-pop-in items-center justify-center rounded-full bg-scrim-strong text-white backdrop-blur-sm',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 24 24" fill="none" className="absolute inset-0 size-full -rotate-90">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={RING}
          strokeDashoffset={done ? 0 : RING * 0.72}
          className={cn(
            'origin-center transition-[stroke-dashoffset] duration-300 ease-out',
            !done && 'animate-spin motion-reduce:animate-none',
          )}
        />
      </svg>
      {done ? (
        <Icon name="check" size={size * 0.5} className="animate-fetch-tick" />
      ) : (
        <span className="flex overflow-hidden" style={{ height: size * 0.5 }}>
          <svg
            viewBox="0 0 24 24"
            width={size * 0.5}
            height={size * 0.5}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-fetch-drop motion-reduce:animate-none"
          >
            <path d="M12 4v15M6 13l6 6 6-6" />
          </svg>
        </span>
      )}
    </span>
  );
}
