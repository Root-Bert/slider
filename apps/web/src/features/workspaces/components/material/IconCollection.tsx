import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ICON_KINDS,
  iconPng,
  IconGrid,
  IconGridSkeleton,
  type IconKind,
  type LibraryIcon,
} from '@/features/icons';
import { pluralize } from '@/lib/format';
import { isApplePlatform } from '@/lib/platform';
import { cn, type ShowToast } from '@/ui';
import type { MaterialView } from '../../lib/font-families';

/** Pixels on the longer side of the picture copied: about 10 cm on a slide, pasted with ⌘V. */
const COPY_PX = 384;
/** The colour it is copied in – the slide's colours are picked where it is put in (its panel). */
const COPY_COLOR = '#000000';
/** A card's width at least, in the grid; the columns fill the width. */
const CARD_PX = 104;

/** One of a kind, in its heading's count („1 Piktogramm“). */
const ONE: Record<IconKind, string> = { icons: 'Icon', pictograms: 'Piktogramm' };

interface IconCollectionProps {
  /** Found by the search, best first – A–Z while nothing is typed. */
  icons: readonly LibraryIcon[];
  view: MaterialView;
  onNotify: ShowToast;
}

/**
 * The symbols Slider brings along (`features/icons`) – icons, then pictograms, each under its
 * heading with how many; the toolbar's filter picks a kind. Both sets free to use without naming
 * them, so no credit there.
 * A click copies one as a picture – ⌘V puts it on a slide; in the editor a picture's panel
 * („Symbole“) draws them in the deck's colours.
 */
export function IconCollection({ icons, view, onNotify }: IconCollectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);
  const columns = view === 'list' ? 1 : Math.max(2, Math.floor(width / CARD_PX));
  // Grouped by kind, each in the search's order.
  const grouped = useMemo(
    () => ICON_KINDS.flatMap(({ value }) => icons.filter((icon) => icon.kind === value)),
    [icons],
  );

  const copy = (icon: LibraryIcon) => {
    // Handed over as a promise: Safari copies only within the click.
    const png = iconPng(icon, COPY_COLOR, COPY_PX);
    navigator.clipboard
      ?.write([new ClipboardItem({ 'image/png': png })])
      .then(() =>
        onNotify(
          `„${icon.label}“ kopiert – mit ${isApplePlatform() ? '⌘V' : 'Strg V'} in eine Folie einfügen`,
        ),
      )
      .catch(() => onNotify('Konnte nicht in die Zwischenablage kopieren.', 'danger'));
  };

  return (
    <div ref={ref}>
      {width > 0 && (
        <IconGrid
          icons={grouped}
          columns={columns}
          layout={view === 'list' ? 'rows' : 'cards'}
          title="Klick kopiert"
          onPick={copy}
          heading={(kind) => {
            const title = ICON_KINDS.find((each) => each.value === kind)?.label ?? kind;
            const count = grouped.filter((icon) => icon.kind === kind).length;
            return (
              <header
                className={cn(
                  'flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-1',
                  view === 'list' && 'px-2 pt-1.5',
                  kind !== grouped[0]?.kind && 'mt-6',
                )}
              >
                <h3 className="text-lg font-medium text-fg">{title}</h3>
                <span className="text-sm text-fg-subtle">{pluralize(count, ONE[kind], title)}</span>
              </header>
            );
          }}
          className={view === 'list' ? 'glass rounded-panel p-1.5' : undefined}
        />
      )}
    </div>
  );
}

export function IconCollectionSkeleton() {
  return <IconGridSkeleton columns={10} rows={3} />;
}
