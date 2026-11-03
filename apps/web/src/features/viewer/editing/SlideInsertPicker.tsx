import { useLayoutEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { SlideOperation, WorkspaceMaster } from '@slider/shared';
import { useDeckLayouts, useWorkspaceMasters } from '@/lib/api';
import { pluralize } from '@/lib/format';
import { Button, cn, EmptyState, Icon, IconButton, SegmentedControl } from '@/ui';
import { placePopover, type Placement } from '../lib/geometry';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';
import { useEditing } from './editing-context';
import { newEditId } from './new-id';
import { showPendingSlide } from './pending-slides';

type Source = 'deck' | 'templates' | 'slider';

const SOURCES = [
  { value: 'deck', label: 'Diese Präsentation' },
  { value: 'templates', label: 'Vorlagen' },
  { value: 'slider', label: 'Slider' },
] as const;

/** Width / height that still counts as the deck's page shape (cm rounded in the files). */
const SAME_SHAPE = 0.01;

/** What a slide just put in shows until its picture is drawn, when its tile had none: nothing. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

interface Picture {
  imageUrl: string;
  thumbnailUrl: string;
}

/** Wide enough for three slides side by side that read as slides, not as thumbnails. */
const PANEL_WIDTH = 760;
const MARGIN = 12;

/**
 * „Folie einfügen“ from a gap between two slides: a panel beside the gap's ⊕ (like the photo
 * search of the format bar, with bigger tiles) that lists slides to start from – a slide of a
 * layout, its placeholders empty. „Diese Präsentation“: the layouts of the deck's own design (the
 * master pages in its file); in the template editor first „Neue Folie“, a layout to design from
 * scratch – an empty slide on the background of the slide before the gap, none of its master's
 * decoration. „Vorlagen“: the layouts of the workspace's templates, by template – one the deck lacks comes
 * in with the slide; templates of another page shape, and PowerPoint ones, cannot. Slider's own
 * slides follow later. Rendered into the body: the track's scroller would clip it.
 */
export function SlideInsertPicker({
  anchorRef,
  panelRef,
  panelId,
  afterSlideId,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  panelId: string;
  /** The new slide goes right after this one. */
  afterSlideId: string;
  onClose: () => void;
}) {
  const { deck, slides } = useViewerData();
  const editing = useEditing();
  const toast = useViewerToast();
  const layouts = useDeckLayouts(deck.id);
  const [source, setSource] = useState<Source>('deck');
  const [placement, setPlacement] = useState<Placement | null>(null);

  /** The slides' page ids (what operations name them by) by slide id. */
  const pageIds = useMemo(
    () => new Map((editing.state?.slides ?? []).map((slide) => [slide.slideId, slide.pageId])),
    [editing.state],
  );

  // Beside the gap, measured once it is laid out; again when its content changes height.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    const place = () => {
      // The gap's whole column of buttons: below it the panel leaves the comment button free.
      const box = (anchor.parentElement ?? anchor).getBoundingClientRect();
      setPlacement(
        placePopover(
          box,
          { width: panel.offsetWidth, height: panel.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
          12,
          MARGIN,
        ),
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [anchorRef, panelRef]);

  const aspectRatio =
    slides.find((slide) => slide.id === afterSlideId)?.aspectRatio ??
    layouts.data?.aspectRatio ??
    16 / 9;

  /**
   * Puts in the slide `operation` makes from the gap's position: in the deck at once with the
   * tile's `picture`, the panel closing, while the edit goes out (a refusal toasts, the slide goes).
   */
  const insert = (
    picture: Picture | null,
    operation: (after: string, newPageId: string) => SlideOperation,
  ) => {
    const after = pageIds.get(afterSlideId);
    onClose();
    if (after === undefined) return;
    const newPageId = newEditId();
    const done = editing.apply([operation(after, newPageId)]);
    showPendingSlide(
      {
        deckId: deck.id,
        newPageId,
        afterSlideId,
        imageUrl: picture?.imageUrl ?? BLANK,
        thumbnailUrl: picture?.thumbnailUrl ?? BLANK,
        aspectRatio,
      },
      done,
    );
    toast('Folie eingefügt');
  };

  const disabled = !editing.available;
  const tile = () => ({ aspectRatio, disabled });

  return createPortal(
    <section
      ref={panelRef}
      id={panelId}
      role="dialog"
      aria-label="Folie einfügen"
      className={cn(
        'glass-elevated fixed z-(--z-popover) flex max-h-[min(640px,80vh)] animate-pop-in flex-col gap-3 rounded-panel p-3',
        // Hidden until placed, so it never flashes at the corner.
        !placement && 'invisible',
      )}
      style={{
        width: `min(${PANEL_WIDTH}px, calc(100vw - ${2 * MARGIN}px))`,
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
      }}
    >
      <header className="flex items-center gap-3">
        <h2 className="pl-1 text-sm font-medium text-fg">Folie einfügen</h2>
        <SegmentedControl
          segments={SOURCES}
          value={source}
          onChange={setSource}
          label="Vorlagen aus"
          mode="tabs"
          size="sm"
          track="soft"
          className="mx-auto"
        />
        <IconButton icon="close" label="Schließen" size="sm" onClick={onClose} />
      </header>

      <div className="grid min-h-0 grid-cols-2 content-start gap-3 overflow-y-auto p-1 sm:grid-cols-3">
        {source === 'deck' ? (
          <>
            {/* A layout from scratch – in templates only: a presentation's slides start from one
                of its layouts. */}
            {deck.template && (
              <Tile
                {...tile()}
                dashed
                label="Neue Folie"
                onPick={() =>
                  insert(null, (after, newPageId) => ({
                    type: 'addSlide',
                    like: after,
                    newPageId,
                    after,
                  }))
                }
                picture={<Icon name="add" size={32} />}
              />
            )}
            {layouts.isPending ? (
              <TileShapes count={2} aspectRatio={aspectRatio} />
            ) : (
              layouts.data?.layouts.map((layout, index) => {
                const key = `layout:${layout.page}`;
                const name = layout.name ?? `Layout ${index + 1}`;
                return (
                  <Tile
                    key={key}
                    {...tile()}
                    label={name}
                    ariaLabel={`Folie mit Layout „${name}“ einfügen`}
                    onPick={() =>
                      insert(layout, (after, newPageId) => ({
                        type: 'addSlide',
                        like: after,
                        newPageId,
                        after,
                        master: layout.page,
                      }))
                    }
                    picture={<SlidePicture src={layout.thumbnailUrl} />}
                  />
                );
              })
            )}
          </>
        ) : source === 'templates' ? (
          <TemplateLayouts
            workspaceId={deck.workspaceId}
            aspectRatio={aspectRatio}
            tile={tile}
            onPick={(master, index) => {
              insert(master.layouts[index] ?? null, (after, newPageId) => ({
                type: 'addSlide',
                like: after,
                newPageId,
                after,
                design: { id: master.id, layout: index },
              }));
            }}
          />
        ) : (
          <div className="col-span-full flex min-h-48 items-center justify-center">
            <EmptyState
              title="Vorlagen von Slider"
              message="Hier findest du bald fertige Folien von Slider für jeden Anlass."
            />
          </div>
        )}
      </div>
    </section>,
    document.body,
  );
}

/**
 * The workspace's templates, each by its cover (its first layout); one opened shows its layouts
 * to pick from. Only an OpenDocument template of the deck's page shape can give a slide; the
 * others are named below.
 */
function TemplateLayouts({
  workspaceId,
  aspectRatio,
  tile,
  onPick,
}: {
  workspaceId: string;
  aspectRatio: number;
  tile: () => Omit<Parameters<typeof Tile>[0], 'picture' | 'label' | 'onPick'>;
  onPick: (master: WorkspaceMaster, index: number) => void;
}) {
  const masters = useWorkspaceMasters(workspaceId);
  const [openId, setOpenId] = useState<string | null>(null);
  if (masters.isPending) return <TileShapes count={3} aspectRatio={aspectRatio} />;
  const all = masters.data ?? [];
  const usable = all.filter(
    (master) => master.format === 'odp' && Math.abs(master.aspectRatio - aspectRatio) < SAME_SHAPE,
  );
  const others = all.length - usable.length;
  if (usable.length === 0) {
    return (
      <div className="col-span-full flex min-h-48 items-center justify-center">
        <EmptyState
          title={all.length === 0 ? 'Noch keine Vorlagen' : 'Keine passende Vorlage'}
          message={
            all.length === 0
              ? 'Ladet euer Firmendesign in der Bibliothek als Vorlage hoch, dann findest du seine Layouts hier.'
              : 'Folien lassen sich nur aus OpenDocument-Vorlagen im Format dieser Präsentation einfügen.'
          }
        />
      </div>
    );
  }
  const open = usable.find((master) => master.id === openId);
  if (open) {
    return (
      <>
        <div className="col-span-full flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="xs"
            icon="arrowBack"
            onClick={() => setOpenId(null)}
            className="shrink-0"
          >
            Vorlagen
          </Button>
          <h3 className="min-w-0 truncate text-caption font-medium text-fg">{open.name}</h3>
        </div>
        {open.layouts.map((layout, index) => {
          const key = `design:${open.id}:${index}`;
          const name = layout.name ?? `Layout ${index + 1}`;
          return (
            <Tile
              key={key}
              {...tile()}
              label={name}
              ariaLabel={`Folie mit Layout „${name}“ aus „${open.name}“ einfügen`}
              onPick={() => onPick(open, index)}
              picture={<SlidePicture src={layout.thumbnailUrl} />}
            />
          );
        })}
      </>
    );
  }
  return (
    <>
      {usable.map((master) => (
        <Tile
          key={master.id}
          {...tile()}
          label={master.name}
          meta={pluralize(master.layouts.length, 'Layout', 'Layouts')}
          ariaLabel={`Vorlage „${master.name}“ öffnen`}
          onPick={() => setOpenId(master.id)}
          picture={master.layouts[0] ? <SlidePicture src={master.layouts[0].thumbnailUrl} /> : null}
        />
      ))}
      {others > 0 && (
        <p className="col-span-full px-1 text-caption text-fg-subtle">
          {others === 1 ? 'Eine Vorlage passt' : `${others} Vorlagen passen`} nicht: Folien lassen
          sich nur aus OpenDocument-Vorlagen im Format dieser Präsentation einfügen.
        </p>
      )}
    </>
  );
}

/** Where tiles come once they are there (asked for ahead, so rarely seen): their shapes, still. */
function TileShapes({ count, aspectRatio }: { count: number; aspectRatio: number }) {
  return Array.from({ length: count }, (_, index) => (
    <span key={index} aria-hidden className="flex flex-col gap-1.5 p-1">
      <span
        className="block h-0 rounded-thumb bg-placeholder"
        style={{ paddingBottom: `${100 / aspectRatio}%` }}
      />
      <span className="h-4" />
    </span>
  ));
}

function SlidePicture({ src, dim = false }: { src: string; dim?: boolean }) {
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      draggable={false}
      className={cn('absolute inset-0 size-full object-cover', dim && 'opacity-40')}
    />
  );
}

/** A slide to start from: its picture in the slide's shape, a name under it. */
function Tile({
  aspectRatio,
  picture,
  dashed = false,
  number,
  label,
  meta,
  ariaLabel,
  disabled,
  onPick,
}: {
  aspectRatio: number;
  picture: ReactNode;
  /** Drawn as a frame to fill, not a picture: the new slide. */
  dashed?: boolean;
  number?: number;
  label: string;
  /** Beside the name, quieter: a template's number of layouts. */
  meta?: string;
  ariaLabel?: string;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      aria-label={ariaLabel}
      className="group flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-chip p-1 text-left transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-fg/60 disabled:cursor-default"
    >
      {/* The slide's own shape by its padding, not `aspect-ratio` (it gave way in the scrolling
          photo grid). */}
      <span
        className={cn(
          'relative block h-0 overflow-hidden rounded-thumb transition-[scale] duration-200 ease-emphasized group-hover:scale-[1.02] group-disabled:scale-100',
          dashed ? 'border border-dashed border-fg-subtle' : 'bg-placeholder ring-hairline',
        )}
        style={{ paddingBottom: `${100 / aspectRatio}%` }}
      >
        <span
          className={cn(
            'absolute inset-0 flex items-center justify-center text-fg-muted group-hover:text-fg',
          )}
        >
          {picture}
        </span>
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5 px-0.5 text-caption">
        {number !== undefined && <span className="text-fg-faint tabular-nums">{number}</span>}
        <span className="truncate text-fg-muted group-hover:text-fg">{label}</span>
        {meta && <span className="ml-auto shrink-0 text-fg-faint">{meta}</span>}
      </span>
    </button>
  );
}
