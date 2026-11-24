import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { cn } from './cn';
import type { IconName } from './Icon';
import { IconButton } from './IconButton';
import { Menu, type MenuAction } from './Menu';
import { Toolbar, type ToolbarProps } from './Toolbar';

interface SelectionBarProps extends Omit<ToolbarProps, 'label' | 'role' | 'children'> {
  count: number;
  actions: readonly MenuAction[];
  onClear: () => void;
  /** What is selected, e.g. "Ausgewählte Präsentationen". */
  label: string;
  /** Drawn first, under the controls (e.g. the split handle's line it grows out of). */
  backdrop?: ReactNode;
  /** Hides the action labels (icons stay) where room is short – default: on phones. */
  labelClassName?: string;
  /** Hides "ausgewählt" after the count where room is shorter still. */
  countLabelClassName?: string;
}

/** `gap-1` between the actions (px). */
const GAP = 4;

/**
 * What is selected and what can be done with it – the decks in "Präsentationen" (in the toolbar's
 * place), the comments under the slides (out of the split handle). Several items, one bar: close
 * (Esc), the count, the actions as buttons whose labels give way to their icons on phones.
 *
 * One row: what does not fit beside the count (a panel beside the page, a narrow window) goes,
 * from the end, behind a „…“ menu – measured on invisible copies of the buttons, as `ViewToolbar`
 * measures its parts, so the choice never flips back and forth.
 */
export function SelectionBar({
  count,
  actions,
  onClear,
  label,
  backdrop,
  labelClassName = 'max-sm:hidden',
  countLabelClassName,
  className,
  ...props
}: SelectionBarProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(actions.length);
  const keys = actions.map((action) => action.key ?? action.label).join('\n');

  useLayoutEffect(() => {
    const root = rootRef.current;
    const box = root?.parentElement;
    const closer = closeRef.current;
    const counted = countRef.current;
    const measure = measureRef.current;
    if (!root || !box || !closer || !counted || !measure) return;
    const px = (element: Element, ...sides: ('paddingLeft' | 'paddingRight')[]) => {
      const style = getComputedStyle(element);
      return sides.reduce((sum, side) => sum + parseFloat(style[side]), 0);
    };
    const fit = () => {
      // Layout widths, not what a scale on the way in (`animate-pop-in`) draws at the moment.
      const scale =
        root.offsetWidth > 0 ? root.getBoundingClientRect().width / root.offsetWidth : 1;
      const width = (element: Element | null) =>
        element ? element.getBoundingClientRect().width / (scale || 1) : 0;
      const part = (name: string) => width(measure.querySelector(`[data-measure='${name}']`));
      // The room the bar may take – its container's, not its own: a bar as wide as what it shows
      // (centred under the slides, over a text) would never get back what went behind „…“.
      const style = getComputedStyle(root);
      const frame =
        px(root, 'paddingLeft', 'paddingRight') +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.borderRightWidth);
      const room =
        box.clientWidth -
        px(box, 'paddingLeft', 'paddingRight') -
        frame -
        width(closer) -
        width(counted) -
        2 * GAP;
      const all = measure.querySelectorAll('[data-measure^="action-"]').length;
      const widths = Array.from({ length: all }, (_, index) => part(`action-${index}`));
      const total = widths.reduce((sum, each) => sum + each, 0) + GAP * Math.max(all - 1, 0);
      let next = all;
      if (total > room) {
        let used = part('more');
        next = 0;
        while (next < all && used + GAP + (widths[next] ?? 0) <= room) {
          used += GAP + (widths[next] ?? 0);
          next += 1;
        }
      }
      setShown(next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    observer.observe(counted);
    for (const each of measure.children) observer.observe(each);
    return () => observer.disconnect();
  }, [keys, labelClassName]);

  const button = (action: MenuAction) => (
    <Button
      variant={action.tone === 'danger' ? 'danger' : 'ghost'}
      size="sm"
      // Selection actions use icon names; a node icon (brand mark) only appears in menus.
      icon={typeof action.icon === 'string' ? (action.icon as IconName) : undefined}
      disabled={action.disabled}
      title={action.title ?? action.label}
      aria-label={action.label}
      onClick={action.onSelect}
    >
      <span className={labelClassName}>{action.label}</span>
    </Button>
  );
  const rest = actions.slice(shown);

  return (
    <Toolbar
      ref={rootRef}
      data-selection-bar
      label={label}
      tone="elevated"
      className={cn('min-h-10', className)}
      {...props}
    >
      {backdrop}
      <IconButton
        ref={closeRef}
        icon="close"
        label="Auswahl aufheben (Esc)"
        size="sm"
        onClick={onClear}
      />
      <span
        ref={countRef}
        className="px-2 text-body font-medium whitespace-nowrap text-fg tabular-nums"
        aria-live="polite"
      >
        {count}
        <span className={countLabelClassName}> ausgewählt</span>
      </span>
      <div className="relative ml-auto flex items-center gap-1">
        {actions.slice(0, shown).map((action) => (
          <Fragment key={action.key ?? action.label}>{button(action)}</Fragment>
        ))}
        {rest.length > 0 && <Menu label="Weitere Aktionen" actions={rest} />}
        {/* The invisible copies the row is measured by – out of reach for focus and readers. */}
        <div
          ref={measureRef}
          aria-hidden
          inert
          className="pointer-events-none invisible absolute top-0 right-0 flex h-0 w-max overflow-hidden"
        >
          {actions.map((action, index) => (
            <div
              key={action.key ?? action.label}
              className="flex shrink-0"
              data-measure={`action-${index}`}
            >
              {button(action)}
            </div>
          ))}
          <div className="flex shrink-0" data-measure="more">
            <IconButton icon="moreVert" label="Weitere Aktionen" size="sm" />
          </div>
        </div>
      </div>
    </Toolbar>
  );
}
