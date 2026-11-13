import { useLayoutEffect, useRef, useState } from 'react';
import { iconPng, IconGrid, IconGridSkeleton, type LibraryIcon } from '@/features/icons';
import { isApplePlatform } from '@/lib/platform';
import type { ShowToast } from '@/ui';
import type { MaterialView } from '../../lib/font-families';

/** Pixels on the longer side of the picture copied: about 10 cm on a slide, pasted with ⌘V. */
const COPY_PX = 384;
/** The colour it is copied in – the slide's colours are picked where it is put in (its panel). */
const COPY_COLOR = '#000000';
/** A card's width at least, in the grid; the columns fill the width. */
const CARD_PX = 104;

interface IconCollectionProps {
  /** Found by the search, best first – A–Z while nothing is typed. */
  icons: readonly LibraryIcon[];
  view: MaterialView;
  onNotify: ShowToast;
}

/**
 * The symbols Slider brings along (`features/icons`) – icons and pictograms in one grid, the
 * toolbar's filter picks a kind; both sets free to use without naming them, so no credit there.
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
          icons={icons}
          columns={columns}
          layout={view === 'list' ? 'rows' : 'cards'}
          title="Klick kopiert"
          onPick={copy}
          className={view === 'list' ? 'glass rounded-panel p-1.5' : undefined}
        />
      )}
    </div>
  );
}

export function IconCollectionSkeleton() {
  return <IconGridSkeleton columns={10} rows={3} />;
}
