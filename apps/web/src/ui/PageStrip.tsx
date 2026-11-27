import { useRef, useState, type KeyboardEvent } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

/**
 * A file's pages one at a time – swiped, scrolled sideways, stepped with the arrows beside it or
 * ← → once in it, „Seite 2 von 6“ under it. The first page is its small picture (`small`), the
 * sharp one drawn over it; the box takes the pages' shape (`ratio`), so nothing jumps. Cloud's
 * preview of a file and a document sent in Sender are this one strip; they say where the pages
 * come from.
 */
export function PageStrip({
  count,
  ratio,
  pageSrc,
  small,
  onShape,
  maxHeight,
  maxWidth = Infinity,
  className,
}: {
  /** How many pages; one until known. */
  count: number;
  /** The pages' width / height. */
  ratio: number;
  /** Where page `index` (0-based) is drawn sharp; `null` while it cannot be asked for yet. */
  pageSrc: (index: number) => string | null;
  /** The first page drawn small, shown until the sharp one is there. */
  small: string | null;
  /** The small picture's shape once it loaded. */
  onShape?: (ratio: number) => void;
  /**
   * Sized by its pages rather than its place (a message): at most this tall (px), as wide as its
   * pages' shape makes it then – at most `maxWidth` and its place.
   */
  maxHeight?: number;
  maxWidth?: number;
  className?: string;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);

  const go = (index: number) => {
    const box = strip.current;
    if (!box) return;
    const to = Math.max(0, Math.min(count - 1, index));
    box.scrollTo({ left: to * box.clientWidth, behavior: 'smooth' });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step || event.metaKey || event.altKey || event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    go(current + step);
  };

  return (
    <section
      aria-label="Vorschau"
      className={cn('flex max-w-full flex-col gap-2', className)}
      style={
        maxHeight
          ? { width: Math.round(Math.min(maxHeight * ratio, maxWidth)), maxWidth: '100%' }
          : undefined
      }
    >
      <div className="group relative">
        <div
          ref={strip}
          tabIndex={0}
          aria-roledescription="Seiten"
          aria-label={`Seite ${current + 1} von ${count}`}
          onKeyDown={onKeyDown}
          onScroll={(event) => {
            const box = event.currentTarget;
            setCurrent(Math.round(box.scrollLeft / Math.max(1, box.clientWidth)));
          }}
          className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-thumb bg-surface-1 ring-hairline outline-none focus-visible:ring-2 focus-visible:ring-focus"
          style={{ aspectRatio: ratio }}
        >
          {Array.from({ length: count }, (_, index) => (
            <Page
              key={index}
              src={pageSrc(index)}
              under={index === 0 ? small : null}
              label={`Seite ${index + 1}`}
              onShape={index === 0 ? onShape : undefined}
            />
          ))}
        </div>
        {count > 1 && (
          <>
            <Step
              icon="chevronLeft"
              label="Vorige Seite"
              disabled={current === 0}
              onClick={() => go(current - 1)}
              className="left-2"
            />
            <Step
              icon="chevronRight"
              label="Nächste Seite"
              disabled={current === count - 1}
              onClick={() => go(current + 1)}
              className="right-2"
            />
          </>
        )}
      </div>
      {count > 1 && (
        <p className="text-center text-xs text-fg-subtle tabular-nums">
          Seite {current + 1} von {count}
        </p>
      )}
    </section>
  );
}

/** An arrow over the page, on its scrim as everything over a slide (light in either theme). */
function Step({
  icon,
  label,
  disabled,
  onClick,
  className,
}: {
  icon: IconName;
  label: string;
  disabled: boolean;
  onClick: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      tabIndex={-1}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'glass-dark absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-fg opacity-0 transition-opacity group-hover:opacity-100 hover:bg-scrim-strong disabled:invisible pointer-coarse:hidden',
        className,
      )}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

/** One page: its picture once drawn, over the small one (the first page) or a quiet ground. */
function Page({
  src,
  under,
  label,
  onShape,
}: {
  src: string | null;
  under: string | null;
  label: string;
  onShape?: ((ratio: number) => void) | undefined;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div
      className={cn('relative h-full w-full shrink-0 snap-center', !under && !shown && 'skeleton')}
    >
      {under && (
        <img
          src={under}
          alt=""
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth && image.naturalHeight) {
              onShape?.(image.naturalWidth / image.naturalHeight);
            }
          }}
          className="absolute inset-0 size-full object-contain"
        />
      )}
      {src && (
        <img
          src={src}
          alt={label}
          loading="lazy"
          draggable={false}
          onLoad={() => setShown(true)}
          className={cn(
            'absolute inset-0 size-full object-contain transition-opacity duration-200',
            shown ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
    </div>
  );
}
