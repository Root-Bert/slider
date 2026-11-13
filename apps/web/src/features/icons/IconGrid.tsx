import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from 'react';
import { isModKey } from '@/lib/keyboard';
import { cn } from '@/ui';
import { iconDataUrl, type LibraryIcon } from './icon-library';

const masks = new WeakMap<LibraryIcon, string>();
/** The icon's shape as a CSS mask's URL (black on clear), made once per icon. */
function maskOf(icon: LibraryIcon): string {
  let mask = masks.get(icon);
  if (!mask) {
    mask = `url("${iconDataUrl(icon)}")`;
    masks.set(icon, mask);
  }
  return mask;
}

/** An icon drawn in `color` – the text's colour when none is given, so it follows the theme. */
function IconGlyph({
  icon,
  color,
  className,
}: {
  icon: LibraryIcon;
  color?: string;
  className?: string;
}) {
  const mask = maskOf(icon);
  return (
    <span
      aria-hidden
      className={cn('block', className)}
      style={{
        maskImage: mask,
        WebkitMaskImage: mask,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        backgroundColor: color ?? 'currentColor',
      }}
    />
  );
}

/** Shown at first and added each time the end scrolls into view. */
const PAGE = 120;

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
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setShown({ icons, count: count + PAGE });
    });
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
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      className={cn('grid content-start', layout === 'cards' ? 'gap-2' : 'gap-1', className)}
    >
      {visible.map((icon, index) => (
        <button
          key={icon.id}
          type="button"
          data-icon={icon.id}
          tabIndex={index === current ? 0 : -1}
          disabled={disabled}
          title={title ? `${icon.label} – ${title}` : icon.label}
          aria-label={icon.label}
          onFocus={() => setCursor({ icons, index })}
          onClick={() => onPick(icon)}
          className={cn(
            'flex min-w-0 items-center rounded-control-sm text-fg transition-colors hover:bg-hover focus-visible:bg-selected focus-visible:outline-2 focus-visible:outline-border-focus disabled:opacity-50',
            layout === 'tiles' && 'aspect-square justify-center',
            layout === 'cards' && 'flex-col gap-2 px-1 pt-4 pb-2.5',
            layout === 'rows' && 'gap-3 px-3 py-2 text-left',
          )}
        >
          {layout === 'tiles' ? (
            <IconGlyph
              icon={icon}
              color={color}
              className={icon.kind === 'pictograms' ? 'size-[72%]' : 'size-[58%]'}
            />
          ) : (
            <IconGlyph
              icon={icon}
              color={color}
              className={cn(
                'shrink-0',
                layout === 'cards'
                  ? icon.kind === 'pictograms'
                    ? 'size-12'
                    : 'size-9 my-1.5'
                  : 'size-6',
              )}
            />
          )}
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
      ))}
      {count < icons.length && (
        <div ref={endRef} aria-hidden className="h-px" style={{ gridColumn: '1 / -1' }} />
      )}
    </div>
  );
}

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
