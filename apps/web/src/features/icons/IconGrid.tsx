import {
  Fragment,
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { isModKey } from '@/lib/keyboard';
import { cn } from '@/ui';
import type { IconKind, LibraryIcon } from './icon-library';

/**
 * An icon drawn in `color` – the text's colour when none is given, so it follows the theme. Inline
 * SVG, not a CSS mask of a `data:` URL: each of those is an SVG document of its own the browser
 * parses and draws, and a page of them made scrolling stutter. The sets' bodies are only paths and
 * circles (`scripts/icon-sets.ts` refuses anything else that could run or load).
 */
function IconGlyph({
  icon,
  color,
  className,
}: {
  icon: LibraryIcon;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox={icon.viewBox}
      fill={color ?? 'currentColor'}
      color={color ?? 'currentColor'}
      className={cn('block', className)}
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}

/** Shown at first and added each time the end comes near – small, so adding one never stutters. */
const PAGE = 60;
/** How far below the view the end already adds the next page. */
const AHEAD = '800px';

/**
 * Icons as a grid of buttons, a page at a time – more as its end comes into view. The arrows walk
 * it (one stop for Tab), ↵ or a click takes one (`onPick`); ↑ in the first row goes to `onLeaveTop`
 * (the search field above).
 */
export function IconGrid({
  icons,
  color,
  columns,
  onPick,
  onLeaveTop,
  disabled = false,
  title,
  layout = 'tiles',
  heading,
  className,
  ref,
}: {
  icons: readonly LibraryIcon[];
  color?: string;
  columns: number;
  onPick: (icon: LibraryIcon) => void;
  onLeaveTop?: () => void;
  disabled?: boolean;
  /** A button's tooltip after its name: what a click does. */
  title?: string;
  /** Glyphs alone (a panel), each with its name under it (cards) or beside it (rows). */
  layout?: 'tiles' | 'cards' | 'rows';
  /** Above the first icon of each kind, the width of the grid – `icons` grouped by kind. */
  heading?: (kind: IconKind) => ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}) {
  const [shown, setShown] = useState({ icons, count: PAGE });
  // A new search starts at the top again.
  const count = shown.icons === icons ? shown.count : PAGE;
  const [cursor, setCursor] = useState({ icons, index: 0 });
  const current = cursor.icons === icons ? Math.min(cursor.index, icons.length - 1) : 0;
  const gridRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const visible = icons.slice(0, count);

  useEffect(() => {
    const end = endRef.current;
    if (!end || count >= icons.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setShown({ icons, count: count + PAGE });
      },
      { rootMargin: `0px 0px ${AHEAD} 0px` },
    );
    observer.observe(end);
    return () => observer.disconnect();
  }, [icons, count]);

  const focusAt = (index: number) => {
    const next = Math.max(0, Math.min(icons.length - 1, index));
    if (next >= count) setShown({ icons, count: next + PAGE });
    setCursor({ icons, index: next });
    // After a page added, the button is there on the next frame.
    requestAnimationFrame(() =>
      gridRef.current?.querySelectorAll<HTMLButtonElement>('button[data-icon]')[next]?.focus(),
    );
  };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (isModKey(event) || event.altKey) return;
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
      Home: -icons.length,
      End: icons.length,
    };
    const by = step[event.key];
    if (by === undefined) return;
    // Not the viewer's: ← → and Home/End would turn the slides.
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'ArrowUp' && current < columns && onLeaveTop) onLeaveTop();
    else focusAt(current + by);
  };

  return (
    <div
      ref={(node) => {
        gridRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
      }}
      onKeyDown={onKeyDown}
      // Handled here, not on each button: the cells stay as they are while pages are added.
      onClick={(event) => {
        const icon = icons[indexOf(event.target)];
        if (icon) onPick(icon);
      }}
      onFocus={(event) => {
        const index = indexOf(event.target);
        if (index >= 0) setCursor({ icons, index });
      }}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      className={cn('grid content-start', layout === 'cards' ? 'gap-2' : 'gap-1', className)}
    >
      {visible.map((icon, index) => (
        <Fragment key={icon.id}>
          {heading && visible[index - 1]?.kind !== icon.kind && (
            <div style={{ gridColumn: '1 / -1' }}>{heading(icon.kind)}</div>
          )}
          <IconCell
            icon={icon}
            index={index}
            tabbable={index === current}
            disabled={disabled}
            title={title}
            layout={layout}
            color={color}
          />
        </Fragment>
      ))}
      {count < icons.length && (
        <div ref={endRef} aria-hidden className="h-px" style={{ gridColumn: '1 / -1' }} />
      )}
    </div>
  );
}

/** The cell's index in the grid, of the button `target` is in; `-1` for none. */
const indexOf = (target: EventTarget) => {
  const button = (target as Element).closest?.<HTMLButtonElement>('button[data-index]');
  return button && !button.disabled ? Number(button.dataset.index) : -1;
};

/** One icon's button – kept as it is while later pages are added (`memo`, plain props). */
const IconCell = memo(function IconCell({
  icon,
  index,
  tabbable,
  disabled,
  title,
  layout,
  color,
}: {
  icon: LibraryIcon;
  index: number;
  tabbable: boolean;
  disabled: boolean;
  title?: string;
  layout: 'tiles' | 'cards' | 'rows';
  color?: string;
}) {
  return (
    <button
      type="button"
      data-icon={icon.id}
      data-index={index}
      tabIndex={tabbable ? 0 : -1}
      disabled={disabled}
      title={title ? `${icon.label} – ${title}` : icon.label}
      aria-label={icon.label}
      className={cn(
        'flex min-w-0 items-center rounded-control-sm text-fg transition-colors hover:bg-hover focus-visible:bg-selected focus-visible:outline-2 focus-visible:outline-border-focus disabled:opacity-50',
        layout === 'tiles' && 'aspect-square justify-center',
        layout === 'cards' && 'flex-col gap-2 px-1 pt-4 pb-2.5',
        layout === 'rows' && 'gap-3 px-3 py-2 text-left',
      )}
    >
      <IconGlyph
        icon={icon}
        color={color}
        className={
          layout === 'tiles'
            ? icon.kind === 'pictograms'
              ? 'size-[72%]'
              : 'size-[58%]'
            : cn(
                'shrink-0',
                layout === 'cards'
                  ? icon.kind === 'pictograms'
                    ? 'size-12'
                    : 'size-9 my-1.5'
                  : 'size-6',
              )
        }
      />
      {layout !== 'tiles' && (
        <span
          className={cn(
            'min-w-0 truncate text-xs',
            layout === 'cards' ? 'w-full text-center text-fg-muted' : 'flex-1 text-sm',
          )}
        >
          {icon.label}
        </span>
      )}
    </button>
  );
});

/** A grid's buttons while the sets load. */
export function IconGridSkeleton({ columns, rows = 4 }: { columns: number; rows?: number }) {
  return (
    <div
      aria-hidden
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      className="grid gap-1"
    >
      {Array.from({ length: columns * rows }, (_, index) => (
        <div key={index} className="skeleton aspect-square rounded-control-sm" />
      ))}
    </div>
  );
}
