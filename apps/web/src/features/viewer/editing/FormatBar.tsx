import type { EditableElement } from '@slider/shared';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { accentAlpha } from '@/lib/accent';
import { useUploadEditImage } from '@/lib/api';
import { AutosizeTextarea, Avatar, Button, cn, Icon, IconButton, useIsNarrow } from '@/ui';
import { useFloatingFollow } from '../comments/hooks/useFloatingFollow';
import { denormalizeRect, placePopover, type Placement } from '../lib/geometry';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';
import { useEditing } from './editing-context';
import { elementLabel } from './lib/element-label';
import { PhotoCredit } from './photos/PhotoCredit';
import { StockPhotoSearch } from './photos/StockPhotoSearch';
import { keepFocus, TEXT_TOOLBAR_ATTR } from './live/model';
import { StyleControls } from './StyleControls';
import { useAutoZoom } from './useAutoZoom';

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

/**
 * The panel beside the picked element while editing (BER-181), placed and styled like the
 * comment composer beside its mark: font, size, B/I/U, colour and alignment of a text, fill and
 * border of a shape, the text of one that cannot be typed on the slide, swapping a picture,
 * deleting. It follows the element while the stage scrolls, resizes or the element is dragged.
 */
export function FormatBar() {
  const editing = useEditing();
  useAutoZoom();
  const element = editing.active && !editing.layers ? editing.selectedElement : null;
  const slideId = editing.selection?.slideId;
  if (!element || !slideId) return null;
  // Remounted per element: a text field's draft does not carry over.
  return <FormatBarView key={element.id} element={element} slideId={slideId} />;
}

function FormatBarView({ element, slideId }: { element: EditableElement; slideId: string }) {
  const editing = useEditing();
  const { viewer, slideIndex } = useViewerData();
  const registry = useStageRegistry();
  const narrow = useIsNarrow();
  const [large, setLarge] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const preview = editing.preview?.elementId === element.id ? editing.preview.rect : null;
  const height = element.live?.autoGrow ? editing.heightOf(element.id) : null;
  const rect = preview ?? (height === null ? element.bbox : { ...element.bbox, h: height });
  const { x, y, w, h } = rect;

  useLayoutEffect(() => {
    const panel = ref.current;
    const slide = registry.getSlideElement(slideId);
    if (narrow || !panel || !slide) return;
    const placeNow = () => {
      const target = denormalizeRect({ x, y, w, h }, slide.getBoundingClientRect());
      const next = placePopover(
        target,
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      setPlace((current) =>
        current &&
        current.left === next.left &&
        current.top === next.top &&
        current.side === next.side
          ? current
          : next,
      );
    };
    // Re-placed before the frame paints, so the panel does not trail its element.
    const placeAgain = () => flushSync(placeNow);
    placeNow();
    const observer = new ResizeObserver(placeAgain);
    observer.observe(panel);
    observer.observe(slide);
    window.addEventListener('scroll', placeAgain, { capture: true, passive: true });
    window.addEventListener('resize', placeAgain);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', placeAgain, { capture: true });
      window.removeEventListener('resize', placeAgain);
    };
  }, [registry, slideId, narrow, x, y, w, h]);
  // Floats after its element, like the composer after its mark.
  useFloatingFollow(ref, narrow ? null : place);

  const live = element.live;
  const { author } = viewer;
  const index = slideIndex.get(slideId);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`${elementLabel(element)} bearbeiten`}
      data-format-bar=""
      {...{ [TEXT_TOOLBAR_ATTR]: '' }}
      onMouseDown={keepFocus}
      className={cn(
        'glass-elevated fixed z-(--z-popover) flex animate-pop-in flex-col gap-3 rounded-panel p-3',
        large ? 'w-[min(720px,calc(100vw-24px))]' : 'w-[min(360px,calc(100vw-24px))]',
        narrow && 'inset-x-3 bottom-24 w-auto',
      )}
      style={
        {
          ...(narrow ? {} : { left: place?.left ?? 0, top: place?.top ?? 0 }),
          visibility: narrow || place ? 'visible' : 'hidden',
          boxShadow: `inset 0 0 0 1px ${accentAlpha(author.color, 90)}, 0 0 32px ${accentAlpha(author.color, 35)}, var(--shadow-float)`,
        } as CSSProperties
      }
    >
      <header className="flex items-center gap-2">
        <Avatar author={author} size={24} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium text-fg">{elementLabel(element)}</span>
          <span className="truncate text-caption text-fg-subtle">
            {index === undefined ? 'Bearbeiten' : `Bearbeiten | Folie ${index + 1}`}
          </span>
        </div>
        <DeleteButton
          disabled={editing.busy}
          onDelete={() => void editing.apply([{ type: 'deleteElement', elementId: element.id }])}
        />
        <IconButton
          icon={large ? 'closeFullscreen' : 'openInFull'}
          label={large ? 'Verkleinern' : 'Vergrößern'}
          size="sm"
          active={large}
          onClick={() => setLarge((open) => !open)}
        />
        <IconButton
          icon="close"
          label="Fertig (Esc, ⌘↵)"
          size="sm"
          onClick={() => editing.select(null)}
        />
      </header>
      {live && <StyleControls element={element} live={live} />}
      {!live && element.paragraphs !== null && <PlainText element={element} />}
      {element.kind === 'image' && <SwapImage element={element} slideId={slideId} large={large} />}
    </div>
  );
}

/** How long the armed delete button waits for its second click. */
const ARMED_MS = 3000;

/**
 * Deleting takes two clicks: the first turns the button red and wide („Löschen“), the second
 * deletes. Left alone it goes back after a moment.
 */
function DeleteButton({ disabled, onDelete }: { disabled: boolean; onDelete: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), ARMED_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);
  return (
    <button
      type="button"
      aria-label={armed ? 'Wirklich löschen' : 'Löschen'}
      title={armed ? 'Noch einmal klicken zum Löschen' : 'Löschen'}
      disabled={disabled}
      onClick={() => {
        if (armed) onDelete();
        else setArmed(true);
      }}
      // Armed it is the comment dialog's „Löschen“ (Button `danger`, `sm`).
      className={cn(
        'flex h-8 shrink-0 items-center overflow-hidden rounded-control-sm text-body font-medium transition-[background-color,color,padding] duration-200 disabled:pointer-events-none disabled:opacity-40',
        armed
          ? 'bg-danger/15 px-3 text-danger hover:bg-danger/25'
          : 'px-[7px] text-fg-muted hover:bg-hover hover:text-fg',
      )}
    >
      <Icon name="delete" size={18} />
      <span
        className={cn(
          'whitespace-nowrap transition-[max-width,opacity,margin] duration-200',
          armed ? 'ml-1.5 max-w-20 opacity-100' : 'max-w-0 opacity-0',
        )}
      >
        Löschen
      </span>
    </button>
  );
}

/**
 * A picture's own controls: another picture from a file, or a stock photo searched right here
 * (when the server has Unsplash) – and whose photo it is, when it is one.
 */
function SwapImage({
  element,
  slideId,
  large,
}: {
  element: EditableElement;
  slideId: string;
  large: boolean;
}) {
  const editing = useEditing();
  const [searching, setSearching] = useState(false);
  const stock = editing.state?.stockPhotos ?? false;
  const { deck } = useViewerData();
  const toast = useViewerToast();
  const upload = useUploadEditImage(deck.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const swap = async (file: File) => {
    try {
      const image = await upload.mutateAsync(file);
      await editing.apply([
        { type: 'replaceImage', elementId: element.id, imageId: image.imageId },
      ]);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Das Bild ging nicht hoch.', 'danger');
    }
  };
  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_TYPES}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void swap(file);
        }}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={stock ? 'upload' : 'image'}
          loading={upload.isPending}
          title="Das neue Bild wird in den Rahmen eingepasst."
          onClick={() => fileRef.current?.click()}
          className="flex-1"
        >
          {stock ? 'Datei' : 'Bild tauschen'}
        </Button>
        {stock && (
          <Button
            size="sm"
            variant={searching ? 'primary' : 'secondary'}
            icon="search"
            aria-expanded={searching}
            title="Ein Foto suchen – es wird auf den Rahmen zugeschnitten."
            onClick={() => setSearching((open) => !open)}
            className="flex-1"
          >
            Foto suchen
          </Button>
        )}
      </div>
      {searching && (
        <StockPhotoSearch
          element={element}
          slideId={slideId}
          large={large}
          onPicked={() => setSearching(false)}
        />
      )}
      {element.credit && !searching && <PhotoCredit credit={element.credit} />}
    </>
  );
}

/** A text that cannot be typed on the slide (fields, numbering, turned): one line a paragraph. */
function PlainText({ element }: { element: EditableElement }) {
  const editing = useEditing();
  const original = (element.paragraphs ?? []).join('\n');
  const [text, setText] = useState(original);
  const apply = () =>
    void editing.apply([{ type: 'setText', elementId: element.id, paragraphs: text.split('\n') }]);
  return (
    <div className="flex flex-col gap-2">
      <div className="field-well focus-field rounded-control-sm px-3 py-2">
        <AutosizeTextarea
          aria-label="Text – eine Zeile pro Absatz"
          value={text}
          rows={2}
          maxHeight={240}
          className="w-full text-body leading-5 text-fg"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (text !== original) apply();
              editing.select(null);
            }
          }}
        />
      </div>
      {text !== original && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setText(original)}>
            Zurücksetzen
          </Button>
          <Button size="sm" variant="primary" title="⌘↵" onClick={apply}>
            Übernehmen
          </Button>
        </div>
      )}
    </div>
  );
}
