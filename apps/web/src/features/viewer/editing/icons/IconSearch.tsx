import type { EditableElement, ImageSymbol, TemplateColor } from '@slider/shared';
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { useUploadEditImage } from '@/lib/api';
import { cn, FilterChip, TextField } from '@/ui';
import {
  ICON_PX,
  iconPng,
  IconGrid,
  IconGridSkeleton,
  ICON_KINDS,
  searchIcons,
  useIconLibrary,
  type IconFilter,
  type LibraryIcon,
} from '@/features/icons';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { ColorField } from '../colors/ColorPalette';
import { sameColor, useDeckColors } from '../colors/useDeckColors';
import { useEditing } from '../editing-context';
import { useTypeIntoField } from '../hooks/useTypeIntoField';

/**
 * The icon each frame was filled with here, in which colour and as which picture of the file
 * (`src`) – another colour redraws it while the frame still shows that picture (not after another
 * picture went in, or the icon was undone). `src` `null`: not known, redrawn anyway.
 */
const placed = new Map<string, { icon: LibraryIcon; color: string; src: string | null }>();

/**
 * The picture `file` becomes in the file (`EditableElement.picture.src`): the file names its
 * pictures by their bytes (`picturePath` in `@slider/odp`). `null` where the browser cannot hash
 * (outside a secure context).
 */
async function picturePathOf(file: File): Promise<string | null> {
  if (!crypto.subtle) return null;
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  const hex = [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `Pictures/${hex.slice(0, 32)}.png`;
}
/** The colour picked last: the next icon is drawn in it too. */
let lastColor: string | null = null;

/** The colour an icon is drawn in at first: the template's first accent, else its text's. */
function firstColor(colors: readonly TemplateColor[]): string {
  return (
    colors.find((color) => color.name === 'Akzent 1')?.color ??
    colors.find((color) => color.name === 'Text 1')?.color ??
    '#000000'
  );
}

/**
 * Symbols – icons and pictograms – to pick from: searched in German or English, „Icons“ or
 * „Piktogramme“ switched on right of the field (neither: both), and the colour they go in – the
 * colour dot after them, as every colour is picked („Farben“ of the template, „Eigene“), the one
 * picked last at first. `onPick` gets the
 * symbol and that colour; `onColor` a colour picked.
 */
export function IconPicker({
  large,
  busy,
  title,
  initialColor,
  autoFocus = true,
  initialQuery = '',
  query: given,
  onPick,
  onColor,
}: {
  large: boolean;
  busy: boolean;
  /** A button's tooltip after its name: what a click does. */
  title: string;
  initialColor?: string | undefined;
  /** Into the field as it opens – not in a frame's preview, where the frame's chooser has the keys. */
  autoFocus?: boolean;
  /** Typed into a new frame on „Symbol“ before its panel was there: searched on from there. */
  initialQuery?: string | undefined;
  /** A frame's preview (`FramePanelPreview`): what is typed on „Symbol“, searched as it comes. */
  query?: string | undefined;
  onPick: (icon: LibraryIcon, color: string) => void;
  onColor?: (color: string) => void;
}) {
  const editing = useEditing();
  const library = useIconLibrary();
  const { colors } = useDeckColors();
  const [typed, setQuery] = useState(initialQuery);
  const query = given ?? typed;
  const [filter, setFilter] = useState<IconFilter>('all');
  const [color, setColor] = useState(() => initialColor ?? lastColor ?? firstColor(colors));
  const fieldRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const deferred = useDeferredValue(query);
  const found = useMemo(
    () => searchIcons(library.data?.icons ?? [], deferred, filter),
    [library.data, deferred, filter],
  );
  const columns = large ? 8 : 6;
  // Typing with the focus outside a field (the field comes after the keys of a new frame on
  // „Symbol“, or was left): it writes the search. In a frame's preview the frame's chooser has
  // the keys.
  useTypeIntoField(fieldRef, autoFocus);

  const pickColor = (next: string) => {
    setColor(next);
    lastColor = next;
    onColor?.(next);
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <TextField
          ref={fieldRef}
          icon="search"
          autoFocus={autoFocus}
          aria-label="Symbole suchen"
          placeholder="Suchen"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' || found.length === 0) return;
            event.preventDefault();
            gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus();
          }}
          className="min-w-0 flex-1"
        />
        <div role="group" aria-label="Symbole filtern" className="flex shrink-0 items-center gap-1">
          {ICON_KINDS.map((kind) => (
            <FilterChip
              key={kind.value}
              size="sm"
              selected={filter === kind.value}
              onClick={() => setFilter((now) => (now === kind.value ? 'all' : kind.value))}
            >
              {kind.label}
            </FilterChip>
          ))}
        </div>
        <ColorField label="Farbe der Symbole" value={color} onChange={pickColor} />
      </div>
      <div className={cn('overflow-y-auto pr-0.5', large ? 'max-h-[min(560px,60vh)]' : 'max-h-80')}>
        {library.isPending && <IconGridSkeleton columns={columns} />}
        {library.isError && <p className="text-caption text-danger">{library.error.message}</p>}
        {library.isSuccess && found.length === 0 && (
          <p className="text-caption text-fg-subtle">Nichts gefunden – andere Wörter?</p>
        )}
        {found.length > 0 && (
          <IconGrid
            ref={gridRef}
            icons={found}
            columns={columns}
            disabled={busy || editing.offline}
            title={title}
            onPick={(icon) => onPick(icon, color)}
            onLeaveTop={() => fieldRef.current?.focus()}
          />
        )}
      </div>
    </div>
  );
}

/** As kept with the picture (`ImageSymbol`) – a colour the file cannot name goes without. */
const symbolOf = (icon: LibraryIcon, color: string): ImageSymbol | null =>
  /^#[0-9a-f]{6}$/i.test(color) ? { id: icon.id, label: icon.label, color } : null;

/**
 * Symbols for a picture frame (its panel's „Symbole“; all of a symbol's panel, and open from the
 * start in a frame taken as „Symbol“): a click puts one into the frame, fitted whole, as a picture
 * sharp enough for a slide – a symbol there is swapped. Another colour picked redraws the symbol
 * it shows.
 */
export function IconSearch({
  element,
  large,
  autoFocus,
  initialQuery,
  query,
  onPicked,
}: {
  element: EditableElement;
  large: boolean;
  autoFocus?: boolean;
  initialQuery?: string | undefined;
  query?: string | undefined;
  onPicked: () => void;
}) {
  const editing = useEditing();
  const library = useIconLibrary();
  const { deck } = useViewerData();
  const toast = useViewerToast();
  const upload = useUploadEditImage(deck.id);
  const [busy, setBusy] = useState(false);
  // The symbol it shows: put in here just now (while the frame still shows that picture – not
  // after another went in, or it was undone), else as the file names it.
  const shows = (): { icon: LibraryIcon; color: string } | null => {
    const last = placed.get(element.id);
    if (last && (last.src === null || last.src === (element.picture?.src ?? null))) return last;
    const { symbol } = element;
    const icon = symbol && library.data?.icons.find((item) => item.id === symbol.id);
    return icon ? { icon, color: symbol.color } : null;
  };

  const put = async (icon: LibraryIcon, color: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const file = await iconPng(icon, color, ICON_PX);
      const symbol = symbolOf(icon, color);
      const [image, src] = await Promise.all([
        upload.mutateAsync(symbol ? { file, symbol } : file),
        picturePathOf(file),
      ]);
      const ok = await editing.apply([
        { type: 'replaceImage', elementId: element.id, imageId: image.imageId },
      ]);
      if (!ok) return;
      placed.set(element.id, { icon, color, src });
      onPicked();
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'Das Symbol ließ sich nicht einfügen.',
        'danger',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <IconPicker
      large={large}
      busy={busy}
      title="in den Rahmen setzen"
      initialColor={placed.get(element.id)?.color ?? element.symbol?.color}
      autoFocus={autoFocus ?? true}
      initialQuery={initialQuery}
      query={query}
      onPick={(icon, color) => void put(icon, color)}
      onColor={(color) => {
        const now = shows();
        if (now && !sameColor(now.color, color)) void put(now.icon, color);
      }}
    />
  );
}
