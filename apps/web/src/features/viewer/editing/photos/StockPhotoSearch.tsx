import {
  PROVIDER_LABELS,
  STOCK_HOMES,
  stockLink,
  stockPhotoUrl,
  type EditableElement,
  type StockPhoto,
} from '@slider/shared';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { usePickStockPhoto, useStockSearch } from '@/lib/api';
import { isTypingTarget } from '@/lib/dom';
import { isModKey, typesCharacter } from '@/lib/keyboard';
import { cn, Spinner, TextField, useDebounced } from '@/ui';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { useEditing } from '../editing-context';
import { photoPreviews } from './photo-previews';

/**
 * Searching the workspace's photo service (Unsplash, Pexels) for a picture frame (in the format bar): the photos found, small – each
 * with its photographer – and a click puts one into the frame, cut to its proportions. The
 * photo shows in the frame at once; the slide is drawn anew behind. Before a search is typed,
 * photos at random. Opened by hand („Foto suchen“), typing anywhere starts a search and Tab or ↓
 * goes into the photos; opened with the panel (a picture picked), the keys stay the editor's – R,
 * E, L and the viewer's letters – until the field is clicked. The arrows walk the photos, Enter
 * takes one.
 */
export function StockPhotoSearch({
  element,
  slideId,
  large,
  autoFocus,
  initialQuery = '',
  query,
  onPicked,
}: {
  element: EditableElement;
  slideId: string;
  /** The panel is made big: more photos a row, and taller. */
  large: boolean;
  /**
   * Opened by hand: the field has the focus, typing anywhere goes to the search and Tab or ↓ into
   * the photos. Not when it opens with the panel – the editor's letter keys stay its own then.
   */
  autoFocus: boolean;
  /** Typed already (into the new frame): searched for at once. */
  initialQuery?: string;
  /** Set from outside (a frame's preview): the field shows it, it is searched. */
  query?: string;
  onPicked: () => void;
}) {
  const editing = useEditing();
  const { deck } = useViewerData();
  const pickPhoto = usePickStockPhoto(deck.id);
  const { w, h } = element.bbox;
  const aspect = h > 0 ? (w * editing.pageSize.width) / (h * editing.pageSize.height) : undefined;

  const take = async (photo: StockPhoto) => {
    const key = photoPreviews.show(
      slideId,
      element.bbox,
      stockPhotoUrl(photo, Math.max(400, Math.min(1600, w * 1600)), aspect),
    );
    try {
      const image = await pickPhoto.mutateAsync({ photoId: photo.id, aspect });
      const ok = await editing.apply([
        { type: 'replaceImage', elementId: element.id, imageId: image.imageId },
      ]);
      if (!ok) {
        photoPreviews.clear(slideId, key);
        return;
      }
      photoPreviews.settle(slideId, key);
      onPicked();
    } catch (error) {
      photoPreviews.clear(slideId, key);
      throw error;
    }
  };
  return (
    <PhotoSearch
      large={large}
      autoFocus={autoFocus}
      initialQuery={initialQuery}
      query={query}
      columns={large ? 4 : 2}
      take={take}
    />
  );
}

/**
 * The photo search itself: a field, the photos found as a grid – `take` puts the one clicked
 * where it goes (a frame, a slide's background), a spinner on it meanwhile.
 */
export function PhotoSearch({
  large,
  autoFocus,
  initialQuery = '',
  query: given,
  columns,
  take,
}: {
  large: boolean;
  autoFocus: boolean;
  initialQuery?: string;
  query?: string;
  columns: number;
  take: (photo: StockPhoto) => Promise<void>;
}) {
  const editing = useEditing();
  const source = editing.state?.photoSource ?? 'unsplash';
  const { deck } = useViewerData();
  const toast = useViewerToast();
  const [typed, setQuery] = useState(initialQuery);
  const query = given ?? typed;
  const settled = useDebounced(query, 400);
  // Photos at random stay until there is a search: two letters.
  const term = settled.trim().length >= 2 ? settled : '';
  const search = useStockSearch(deck.id, term);
  const [picking, setPicking] = useState<string | null>(null);

  const photos = search.data?.photos ?? [];
  // The photo the arrows are on – the photos' one stop for Tab; back to the first for a new search.
  const [cursor, setCursor] = useState({ term, index: 0 });
  const current = cursor.term === term ? Math.min(cursor.index, photos.length - 1) : 0;
  const gridRef = useRef<HTMLDivElement>(null);
  const focusPhoto = (index: number) => {
    const next = Math.max(0, Math.min(photos.length - 1, index));
    setCursor({ term, index: next });
    gridRef.current?.querySelectorAll<HTMLButtonElement>('button[data-photo]')[next]?.focus();
  };
  const onGridKeyDown = (event: ReactKeyboardEvent) => {
    if (isModKey(event) || event.altKey) return;
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
      Home: -photos.length,
      End: photos.length,
    };
    const by = step[event.key];
    if (by === undefined) return;
    // Not the viewer's: ← → and Home/End would turn the slides.
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'ArrowUp' && current < columns) fieldRef.current?.focus();
    else focusPhoto(current + by);
  };

  // Opened by hand, focus outside a field: typing writes the search, Tab and ↓ go into the
  // photos. Space, Delete, ← → and ⌘ keys stay with the editor and the picture.
  const fieldRef = useRef<HTMLInputElement>(null);
  const onWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target)) return;
    const unfocused = event.target === document.body || event.target === document.documentElement;
    if (
      unfocused &&
      photos.length > 0 &&
      ((event.key === 'Tab' && !event.shiftKey) || event.key === 'ArrowDown') &&
      !isModKey(event) &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      focusPhoto(current);
      return;
    }
    if (!typesCharacter(event) || event.key === ' ') return;
    if (event.target instanceof Element && event.target.closest('dialog')) return;
    const field = fieldRef.current;
    if (!field) return;
    // The key goes on into the field; the viewer's letter shortcuts skip it.
    event.stopPropagation();
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });
  // Typed already: the caret after it.
  useEffect(() => {
    const field = fieldRef.current;
    if (autoFocus && field && document.activeElement === field)
      field.setSelectionRange(field.value.length, field.value.length);
  }, [autoFocus]);
  useEffect(() => {
    // Opened with the panel: nothing taken from the editor's keys.
    if (!autoFocus) return;
    const listener = (event: KeyboardEvent) => onWindowKeyDown(event);
    // Capture: before the viewer's shortcuts.
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [autoFocus]);

  const pick = async (photo: StockPhoto) => {
    if (picking) return;
    setPicking(photo.id);
    try {
      await take(photo);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Das Foto ließ sich nicht holen.', 'danger');
    } finally {
      setPicking(null);
    }
  };

  return (
    <div
      className="flex flex-col gap-2"
      // `typing`: opened by hand, it takes Tab from the editor (`EditingProvider`).
      data-stock-search={autoFocus ? 'typing' : ''}
    >
      <TextField
        ref={fieldRef}
        icon="search"
        autoFocus={autoFocus}
        aria-label="Fotos suchen"
        placeholder="Fotos suchen, z. B. Teamarbeit"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' || photos.length === 0) return;
          event.preventDefault();
          focusPhoto(current);
        }}
        trailing={search.isFetching ? <Spinner size="sm" /> : undefined}
      />
      {search.isError && (
        <p className="text-caption text-danger">
          {search.error instanceof Error ? search.error.message : 'Die Suche ging nicht.'}
        </p>
      )}
      {term && search.isSuccess && photos.length === 0 && (
        <p className="text-caption text-fg-subtle">Nichts gefunden – andere Wörter?</p>
      )}
      {photos.length > 0 && (
        <div
          ref={gridRef}
          data-stock-results=""
          onKeyDown={onGridKeyDown}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          className={cn(
            'grid content-start gap-2 overflow-y-auto pr-0.5',
            large ? 'max-h-[min(560px,60vh)]' : 'max-h-80',
          )}
        >
          {photos.map((photo, index) => (
            <div
              key={photo.id}
              // 4:3 by its padding, not `aspect-ratio`: in the scrolling grid that gave way and
              // the tiles slid over each other.
              className="group relative h-0 overflow-hidden rounded-thumb pb-[75%]"
              style={{ backgroundColor: photo.color ?? undefined }}
            >
              <button
                type="button"
                data-photo=""
                tabIndex={index === current ? 0 : -1}
                onFocus={() => setCursor({ term, index })}
                title={photo.description ?? `Foto von ${photo.credit.name}`}
                aria-label={`Foto von ${photo.credit.name} nehmen`}
                disabled={picking !== null}
                onClick={() => void pick(photo)}
                className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-fg/60 focus-visible:ring-inset"
              >
                <img
                  src={photo.thumbUrl}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className={cn(
                    'size-full object-cover transition-opacity',
                    picking && picking !== photo.id && 'opacity-40',
                  )}
                />
              </button>
              {/* Who took it, linked – on hover, like Unsplash itself shows it. */}
              <a
                href={stockLink(photo.credit.profileUrl, photo.credit.source)}
                // The arrows walk the photos; the credit is for the pointer.
                tabIndex={-1}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute inset-x-0 bottom-0 truncate bg-scrim dark-ink px-1.5 py-0.5 text-tiny leading-4 text-fg opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
              >
                {photo.credit.name}
              </a>
              {picking === photo.id && (
                <span className="absolute inset-0 flex items-center justify-center bg-scrim">
                  <Spinner size="sm" label="Foto wird geholt" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-caption text-fg-subtle">
        Fotos von{' '}
        <a
          href={stockLink(STOCK_HOMES[source], source)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-fg-subtle/50 underline-offset-2 hover:text-fg"
        >
          {PROVIDER_LABELS[source]}
        </a>
      </p>
    </div>
  );
}
