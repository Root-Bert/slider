import type { EditableElement, FrameShape, Rect } from '@slider/shared';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useRemoveBackground, useUploadEditImage } from '@/lib/api';
import { tabStep } from '@/lib/dom';
import { OFFLINE_HINT } from '@/lib/offline';
import {
  AutosizeTextarea,
  Avatar,
  Button,
  cn,
  DeleteButton,
  Icon,
  IconButton,
  useIsNarrow,
  type IconName,
} from '@/ui';
import { useFloatingFollow } from '../comments/hooks/useFloatingFollow';
import { usePushAside } from '../hooks/usePushAside';
import { denormalizeRect, placeBelowOrAbove, placePopover, type Placement } from '../lib/geometry';
import { fittedToText } from '../stage/lib/rect-edit';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';
import { useEditing } from './editing-context';
import { usePreviewOf } from './preview-store';
import { elementLabel, lockButton, lockOperations } from './lib/element-label';
import { seenOnPlane } from './layers/seen-on-plane';
import { PhotoCredit } from './photos/PhotoCredit';
import { GenerateImage } from './photos/GenerateImage';
import { photoSearchTakesTab } from './photos/photo-search-tab';
import { StockPhotoSearch } from './photos/StockPhotoSearch';
import { IconSearch } from './icons/IconSearch';
import { typedAhead } from './typed-ahead';
import { isSymbolFrame, KIND_TABS, setPickedTab, usePickedTab, type PanelTab } from './panel-tab';
import { canMove, keepFocus, TEXT_TOOLBAR_ATTR } from './live/model';
import { FillControls } from './fills/FillControls';
import { EffectControls } from './fills/EffectControls';
import { BorderControls, CornerControls, HeadControls, Line, TextControls } from './StyleControls';
import { useAutoZoom } from './useAutoZoom';
import { PlaceholderControl } from '../template/PlaceholderControl';
import { ArrangeControls } from './ArrangeControls';
import { ImageFitControls } from './ImageFitControls';
import { useShownBox } from './hooks/useMoveElements';
import { shownRect, unionRect } from './lib/group-layout';
import { ShapeButtons, type FrameKind } from './InsertFrameChooser';
import { ElementThumb } from './compose/SlideCompositor';

const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp';

const TABS: { id: PanelTab; icon: IconName; label: string }[] = [
  { id: 'text', icon: 'textFields', label: 'Text' },
  { id: 'fill', icon: 'formatColorFill', label: 'Aussehen' },
  { id: 'image', icon: 'image', label: 'Bild' },
  { id: 'arrange', icon: 'alignCenter', label: 'Anordnen' },
];
/** A symbol's picture part: its colours and other symbols. */
const SYMBOL_TAB = {
  id: 'image',
  icon: 'shapes',
  label: 'Symbol',
} as const satisfies (typeof TABS)[number];

/**
 * A picture that is a symbol – named so in the file, or a frame taken as „Symbol“ (still empty, or
 * filled here just now): its panel offers colours and other symbols, not a picture's controls.
 */
const isSymbol = (element: EditableElement) =>
  element.kind === 'image' && (Boolean(element.symbol) || isSymbolFrame(element.id));

/** The tabs an element has: what can be changed on it. */
function tabsOf(element: EditableElement): PanelTab[] {
  return TABS.map((tab) => tab.id).filter((id) => {
    if (id === 'text') return element.paragraphs !== null;
    if (id === 'fill') return element.look !== null;
    // Locked, it stays where it is.
    if (id === 'arrange') return canMove(element);
    return element.kind === 'image';
  });
}

/**
 * Two things show for the picked element while editing (BER-181): under it (over it when there is
 * no room) a small row of what can be changed on it – the text, the fill and border, the
 * picture –, and beside it the panel with that one part, like the comment composer beside its
 * mark; with no room beside it (a wide element), at the top right where the comment panel opens
 * (`SidePanel`). Both follow the element while the stage scrolls, resizes or the element is
 * dragged; the panel can be pushed aside by its name. The part stays picked for the next element
 * that has it.
 */
export function FormatBar() {
  const editing = useEditing();
  const tab = usePickedTab();
  useAutoZoom();
  const picked = editing.active ? editing.selectedElement : null;
  // In the layers view only once opened (a double click): a click picks the layer, for its list.
  const element = picked && (!editing.layers || editing.opened === picked.id) ? picked : null;
  const slideId = editing.selection?.slideId;
  // Elements picked together: the same panel, for all of them – what they share (`group`).
  const group = editing.active && !editing.layers ? editing.group : null;
  const members = group
    ? editing.elementsOf(group.slideId).filter((item) => group.elementIds.includes(item.id))
    : [];
  if (group && members.length > 1) {
    return (
      <FormatBarView
        key={`group:${group.elementIds.join(',')}`}
        element={members.find((item) => item.movable) ?? members[0]!}
        slideId={group.slideId}
        group={members}
        tab={tab}
        onTab={setPickedTab}
      />
    );
  }
  if (!element || !slideId) return null;
  // Remounted per element: a text field's draft does not carry over.
  return (
    <FormatBarView
      key={element.id}
      element={element}
      slideId={slideId}
      tab={tab}
      onTab={setPickedTab}
    />
  );
}

/**
 * While a drawn frame waits for its kind (`KindChooser`): the panel the kind picked there opens
 * with, where it will be – shown, not used yet. A click on it takes that kind (`onTake`), typing
 * on the kind fills it (`typed`, a picture's search). „Auswählen“ shows the panel of the elements
 * it would pick (`group`, or the one alone on its part picked last); „Form“ offers the shapes on
 * top, one taken at once (`onShape`).
 */
export function FramePanelPreview({
  element,
  group,
  slideId,
  kind,
  rect,
  typed,
  onTake,
  onShape,
  onShapeShown,
}: {
  element: EditableElement;
  /** „Auswählen“ of several elements: theirs. */
  group?: readonly EditableElement[];
  slideId: string;
  kind: FrameKind;
  /** The frame: the panel goes beside it. */
  rect: Rect;
  typed: string;
  onTake: () => void;
  onShape?: (shape: FrameShape) => void;
  /** The shape under the pointer or Tab in „Form“'s panel – the frame shows it meanwhile. */
  onShapeShown?: (shape: FrameShape | null) => void;
}) {
  const picked = usePickedTab();
  const tab = kind === 'select' ? (group ? 'arrange' : picked) : KIND_TABS[kind];
  return createPortal(
    <FormatBarView
      key={element.id}
      element={element}
      group={group}
      slideId={slideId}
      tab={tab}
      onTab={() => {}}
      framePreview={{ typed, rect, onTake, onShape, onShapeShown, symbols: kind === 'symbol' }}
    />,
    document.body,
  );
}

/** A drawn frame's kind chooser (`KindChooser`), while one is open – only ever one. */
const frameChooser = () => document.querySelector<HTMLElement>('[data-frame-chooser]');

function FormatBarView({
  element,
  slideId,
  tab,
  onTab,
  framePreview,
  group,
}: {
  /** Of elements picked together: the one leading a drag of them (`ElementPreview.group`). */
  element: EditableElement;
  slideId: string;
  /** Elements picked together: the panel is theirs, it follows the box round them. */
  group?: readonly EditableElement[];
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  /** Only shown, for a frame not filled yet (`FramePanelPreview`). */
  framePreview?: {
    typed: string;
    rect: Rect;
    onTake: () => void;
    onShape?: (shape: FrameShape) => void;
    onShapeShown?: (shape: FrameShape | null) => void;
    /** „Symbol“: the picture's part shows the symbols' search. */
    symbols?: boolean;
  };
}) {
  const editing = useEditing();
  const { viewer } = useViewerData();
  const registry = useStageRegistry();
  const narrow = useIsNarrow();
  const [large, setLarge] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const [tabsPlace, setTabsPlace] = useState<Placement | null>(null);
  const dragged = usePreviewOf(element.id);
  const shownBox = useShownBox();
  const aspect = editing.pageSize.width / editing.pageSize.height;
  const around = group
    ? unionRect(
        group.map((item) =>
          shownRect({ bbox: shownBox(item), rotation: item.rotation, tilt: item.tilt }, aspect),
        ),
      )
    : null;
  // A frame's preview goes beside the frame (it may be larger than what it encloses).
  const rect = framePreview
    ? framePreview.rect
    : around
      ? // Dragged together: as far as they have moved.
        {
          ...around,
          x: around.x + (dragged?.group?.dx ?? 0),
          y: around.y + (dragged?.group?.dy ?? 0),
        }
      : (dragged?.rect ?? shownBox(element));
  const symbol = !group && (framePreview ? Boolean(framePreview.symbols) : isSymbol(element));
  const label = group
    ? `${group.length} Elemente`
    : symbol && !element.symbol
      ? 'Symbol'
      : elementLabel(element);
  // The element last copied: the handle shows it (not in a frame's preview).
  const clip = framePreview ? null : editing.clipboard;
  const { x, y, w, h } = rect;
  const layers = editing.layers;
  // Pushed aside by its name, while it is open.
  const { pushed, handle } = usePushAside();
  const inFrame = !!framePreview;

  useLayoutEffect(() => {
    const panel = ref.current;
    const slide = registry.getSlideElement(slideId);
    if (narrow || !panel || !slide) return;
    // In the layers view at its plane, as seen in 3D (`LayerStage`) – it follows a turn.
    const plane = () =>
      document.querySelector<HTMLElement>(
        `[data-layer-stage="${CSS.escape(slideId)}"] [data-layer="${CSS.escape(element.id)}"]`,
      );
    const placeNow = () => {
      const on = layers ? plane() : null;
      // On its plane: its own box as seen, cut to what of the slide shows (zoomed in, the frame).
      const frame = slide.closest('[data-slide-frame]') ?? slide;
      const target =
        (on && seenOnPlane(on, { x, y, w, h }, frame.getBoundingClientRect())) ??
        denormalizeRect({ x, y, w, h }, slide.getBoundingClientRect());
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const row = tabsRef.current;
      const rowSize = row ? { width: row.offsetWidth, height: row.offsetHeight } : null;
      const rowAt = rowSize ? placeBelowOrAbove(target, rowSize, viewport) : null;
      // The row under (or over) the element – its parts, or a new frame's kinds (`KindChooser`) –
      // is often wider than it: the panel goes beside both, never over the row.
      const chooser = inFrame ? frameChooser() : null;
      const rowBox = chooser
        ? chooser.getBoundingClientRect()
        : rowAt && rowSize
          ? {
              left: rowAt.left,
              top: rowAt.top,
              right: rowAt.left + rowSize.width,
              bottom: rowAt.top + rowSize.height,
            }
          : null;
      const around = rowBox
        ? {
            left: Math.min(target.left, rowBox.left),
            top: Math.min(target.top, rowBox.top),
            right: Math.max(target.right, rowBox.right),
            bottom: Math.max(target.bottom, rowBox.bottom),
          }
        : target;
      // Beside them; no room there, at the top right where the comment panel opens.
      const size = { width: panel.offsetWidth, height: panel.offsetHeight };
      const besides = placePopover(around, size, viewport);
      const next: Placement =
        besides.side === 'below'
          ? { left: viewport.width - size.width - 12, top: 12, side: 'right' }
          : besides;
      const same = (a: Placement | null, b: Placement | null) =>
        !!a && !!b && a.left === b.left && a.top === b.top && a.side === b.side;
      setPlace((current) => (same(current, next) ? current : next));
      setTabsPlace((current) => (same(current, rowAt) ? current : rowAt));
    };
    // Re-placed before the frame paints on a scroll or a window resize, so panel and row do not
    // trail their element. A size the observer reports is placed without `flushSync`: rendered in
    // the middle of its round, everything else waiting would be drawn too (a text fitted shrinks
    // the panel, its observer is made anew) – sizes the browser can no longer report that frame
    // („ResizeObserver loop completed with undelivered notifications“). They float there anyway.
    const placeAgain = () => flushSync(placeNow);
    placeNow();
    const observer = new ResizeObserver(placeNow);
    observer.observe(panel);
    observer.observe(slide);
    if (tabsRef.current) observer.observe(tabsRef.current);
    // A new frame's kinds row changes size: the panel moves aside with it.
    const chooser = inFrame ? frameChooser() : null;
    if (chooser) observer.observe(chooser);
    window.addEventListener('scroll', placeAgain, { capture: true, passive: true });
    window.addEventListener('resize', placeAgain);
    // The planes turn and spread without a resize: followed frame by frame.
    let frame = 0;
    const follow = () => {
      placeNow();
      frame = requestAnimationFrame(follow);
    };
    if (layers) frame = requestAnimationFrame(follow);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', placeAgain, { capture: true });
      window.removeEventListener('resize', placeAgain);
    };
  }, [registry, slideId, element.id, layers, narrow, inFrame, x, y, w, h]);
  // Floats after its element, like the composer after its mark.
  useFloatingFollow(ref, narrow ? null : place);
  useFloatingFollow(tabsRef, narrow ? null : tabsPlace);

  const live = element.live;
  const tabs: PanelTab[] = group
    ? group.some((item) => item.locked)
      ? []
      : ['arrange']
    : tabsOf(element);
  // Locked in place (all picked together): unlocked by the same button.
  const locked = (group ?? [element]).every((item) => item.locked);
  // The tab picked before, if this element has it – else its first.
  const shown = tabs.includes(tab) ? tab : tabs[0];
  const { author } = viewer;

  // Tab / ⇧Tab steps through the parts, round and round – instead of the editing tools
  // (`EditingProvider`): while nothing has the focus, once the pointer was used.
  useEffect(() => {
    if (tabs.length < 2 || framePreview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const step = tabStep(event);
      if (!step || photoSearchTakesTab(event)) return;
      const next = tabs[(tabs.indexOf(shown ?? tabs[0]!) + step + tabs.length) % tabs.length];
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      onTab(next);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  });

  const tabRow = tabs.length > 1 && (
    <div role="tablist" aria-label="Was bearbeiten" data-panel-tabs="" className="flex gap-1">
      {TABS.filter((item) => tabs.includes(item.id)).map((tabbed) => {
        const item = tabbed.id === 'image' && symbol ? SYMBOL_TAB : tabbed;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={shown === item.id}
            title={item.label}
            // „Text“ taken again on a text that is picked: typing in it starts (at its end).
            onClick={() => {
              if (item.id === 'text' && shown === 'text' && live && !group && !framePreview) {
                if (editing.textEditing !== element.id) {
                  editing.startText({ slideId, elementId: element.id });
                }
              } else onTab(item.id);
            }}
            className={cn(
              'flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-control-sm px-2.5 text-xs font-medium whitespace-nowrap',
              narrow && 'flex-1',
              shown === item.id
                ? 'bg-selected text-fg'
                : 'text-fg-muted hover:bg-hover hover:text-fg',
            )}
          >
            <Icon name={item.icon} size={16} />
            <span className={cn(narrow && shown !== item.id && 'sr-only')}>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
  return (
    <>
      {!narrow && tabRow && !framePreview && (
        <div
          ref={tabsRef}
          data-format-tabs=""
          {...{ [TEXT_TOOLBAR_ATTR]: '' }}
          onMouseDown={keepFocus}
          className="glass-elevated fixed z-(--z-popover) animate-pop-in rounded-panel p-1"
          style={{
            left: tabsPlace?.left ?? 0,
            top: tabsPlace?.top ?? 0,
            visibility: tabsPlace ? 'visible' : 'hidden',
          }}
        >
          {tabRow}
        </div>
      )}
      <div
        ref={ref}
        role="dialog"
        aria-label={`${label} bearbeiten`}
        data-format-bar=""
        {...{ [TEXT_TOOLBAR_ATTR]: '' }}
        onMouseDown={keepFocus}
        // A preview: the first click takes the kind, then the panel is the element's own.
        onPointerDown={
          framePreview
            ? (event) => {
                event.preventDefault();
                framePreview.onTake();
              }
            : undefined
        }
        className={cn(
          'glass-elevated fixed z-(--z-popover) flex animate-pop-in flex-col gap-3 rounded-panel p-3',
          framePreview && 'cursor-pointer',
          large ? 'w-[min(720px,calc(100vw-24px))]' : 'w-[min(360px,calc(100vw-24px))]',
          narrow && 'inset-x-3 bottom-24 w-auto',
        )}
        style={
          {
            ...(narrow
              ? {}
              : {
                  left: place?.left ?? 0,
                  top: place?.top ?? 0,
                  marginLeft: pushed.x,
                  marginTop: pushed.y,
                }),
            visibility: narrow || place ? 'visible' : 'hidden',
          } as CSSProperties
        }
      >
        <header className="flex items-center gap-2">
          <Avatar author={author} size={24} />
          {/* Its name and the indicator after it push the panel aside; the avatar does not. */}
          <span
            {...(!narrow && handle)}
            title={narrow ? undefined : 'Verschieben'}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1 self-stretch',
              !narrow && 'cursor-grab touch-none select-none active:cursor-grabbing',
            )}
          >
            {clip ? (
              // Something copied: the handle is the clipboard – the last copy, a click puts it in.
              <span
                key={clip.id}
                title={`Zwischenablage: ${elementLabel(clip)}`}
                className="flex min-w-0 animate-pop-in items-center gap-1.5 motion-reduce:animate-none"
              >
                <Icon name="contentPaste" size={14} className="shrink-0 text-fg-subtle" />
                <button
                  type="button"
                  aria-label={`Einfügen: ${elementLabel(clip)} (⌘V)`}
                  data-clipboard=""
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => editing.pasteCopied()}
                  className="flex shrink-0 cursor-pointer items-center justify-center rounded-thumb bg-white/90 p-0.5 ring-1 ring-white/20 transition-shadow duration-150 hover:ring-white/60"
                >
                  <ElementThumb
                    element={clip}
                    size={20}
                    fallback={<Icon name="contentCopy" size={14} className="text-fg-subtle" />}
                  />
                </button>
                <span className="min-w-0 truncate text-xs font-medium text-fg">{label}</span>
              </span>
            ) : (
              <span className="min-w-0 truncate text-xs font-medium text-fg">{label}</span>
            )}
            {!narrow && <Icon name="dragIndicator" size={14} className="shrink-0 text-fg-subtle" />}
          </span>
          {!framePreview && (
            <>
              {group ? (
                <IconButton
                  icon="group"
                  label="Gruppieren"
                  title="Gruppieren (⌘G)"
                  size="sm"
                  disabled={editing.busy}
                  onClick={() => editing.groupPicked()}
                />
              ) : (
                element.kind === 'group' &&
                element.members && (
                  <IconButton
                    icon="ungroup"
                    label="Gruppierung aufheben"
                    title="Gruppierung aufheben (⇧⌘G)"
                    size="sm"
                    disabled={editing.busy}
                    onClick={() => editing.ungroupPicked()}
                  />
                )
              )}
              <IconButton
                {...lockButton(locked)}
                size="sm"
                active={locked}
                disabled={editing.busy}
                onClick={() => void editing.apply(lockOperations(group ?? [element]))}
              />
              <DeleteButton
                disabled={editing.busy}
                onDelete={() =>
                  void editing
                    .apply(
                      (group ?? [element]).map((item) => ({
                        type: 'deleteElement' as const,
                        elementId: item.id,
                      })),
                    )
                    .then((ok) => ok && group && editing.select(null))
                }
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
            </>
          )}
        </header>
        {/* „Form“: the shapes, each taken at once – the rest of the panel opens the chooser's. */}
        {framePreview?.onShape && (
          <div
            role="group"
            aria-label="Form wählen"
            data-frame-shapes=""
            className="grid grid-cols-9 gap-0.5"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <ShapeButtons onPick={framePreview.onShape} onShow={framePreview.onShapeShown} />
          </div>
        )}
        {/* A preview's controls are shown, not used: the panel itself takes the click. */}
        <div inert={!!framePreview} className="flex flex-col gap-3">
          {!group && <PlaceholderControl element={element} />}
          {shown === 'text' && live && <TextControls element={element} live={live} />}
          {shown === 'text' && live && <FitToText element={element} />}
          {shown === 'text' && !live && <PlainText element={element} />}
          {/* A line has no area: its line and its heads. */}
          {shown === 'fill' && element.look && !element.line && (
            <FillControls key={element.id} element={element} />
          )}
          {shown === 'fill' && element.look && (
            <BorderControls element={element} look={element.look} />
          )}
          {shown === 'fill' && element.line && (
            <HeadControls element={element} heads={element.line.heads} />
          )}
          {shown === 'fill' && element.cornerRadius !== undefined && (
            <CornerControls element={element} radius={element.cornerRadius} />
          )}
          {shown === 'fill' && element.look && !element.line && (
            <EffectControls key={`effects:${element.id}`} element={element} />
          )}
          {shown === 'image' && (
            <SwapImage
              // A frame's preview keeps its element from „Bild“ to „Symbol“: each opens anew.
              key={symbol ? 'symbols' : 'picture'}
              element={element}
              slideId={slideId}
              large={large}
              symbol={symbol}
              previewQuery={framePreview?.typed}
              preview={inFrame}
            />
          )}
          {shown === 'arrange' && (
            <ArrangeControls slideId={slideId} elements={group ?? [element]} />
          )}
          {narrow && !framePreview && tabRow}
        </div>
      </div>
    </>
  );
}

/** A side off by less than this (of the slide) is the text's: nothing to fit. */
const FIT_TOLERANCE = 0.003;

/**
 * A text box or shape whose size is not its text's: „An Text anpassen“ sets its width to its
 * longest line, its height to the one LibreOffice lays the text out in at its width (higher or
 * lower – one growing with its text LibreOffice draws as high as it anyway, other programs may
 * not), or both, as the corner's double click does (`TextSizeMeasure`, padding in). Its top left
 * corner stays where it shows, turned too. A width is offered only when the text's line fits on
 * the slide from there (a paragraph in one line would run off it); one fitted already is off; all
 * fitted, the row is gone.
 */
function FitToText({ element }: { element: EditableElement }) {
  const editing = useEditing();
  const fit = editing.textFitOf(element.id);
  if (fit === null || !element.resizable) return null;
  const box = element.bbox;
  const off = (a: number, b: number) => Math.abs(a - b) >= FIT_TOLERANCE;
  const widthFits = fit.width <= Math.max(box.w, 1 - box.x) + FIT_TOLERANCE;
  const width = widthFits && off(fit.width, box.w);
  const height = off(fit.height, box.h);
  const both = widthFits && (off(fit.width, box.w) || off(fit.fittedHeight, box.h));
  if (!width && !height && !both) return null;
  // Turned, its top left corner stays where it shows – as the corner's double click does.
  const aspect = editing.pageSize.width / editing.pageSize.height;
  const set = (size: { w?: number; h?: number }) => {
    const text = { width: size.w ?? box.w, heightAt: () => size.h ?? box.h };
    const next = fittedToText(box, 'se', text, element.rotation, aspect);
    void editing.apply([{ type: 'setBox', elementId: element.id, box: next }]);
  };
  return (
    <Line label="An Text anpassen">
      <IconButton
        icon="fitWidth"
        label="Breite an Text anpassen"
        size="compact"
        disabled={editing.busy || !width}
        onClick={() => set({ w: fit.width })}
      />
      <IconButton
        icon="fitHeight"
        label="Höhe an Text anpassen"
        size="compact"
        disabled={editing.busy || !height}
        onClick={() => set({ h: fit.height })}
      />
      <IconButton
        icon="fitSize"
        label="Breite und Höhe an Text anpassen"
        size="compact"
        disabled={editing.busy || !both}
        onClick={() => set({ w: fit.width, h: fit.fittedHeight })}
      />
    </Line>
  );
}

/**
 * A picture's own controls: another picture from a file, or a stock photo searched right here
 * (when the server has Unsplash), its background removed (when the server has rembg) – and whose
 * photo it is, when it is one.
 */
function SwapImage({
  element,
  slideId,
  large,
  symbol,
  previewQuery,
  preview,
}: {
  element: EditableElement;
  slideId: string;
  large: boolean;
  /** A symbol (`isSymbol`, or a frame's preview on „Symbol“): its colours and other symbols only. */
  symbol: boolean;
  /** A frame's preview (`FramePanelPreview`): what was typed on its kind, searched already. */
  previewQuery?: string | undefined;
  preview: boolean;
}) {
  const editing = useEditing();
  const stock = editing.state?.stockPhotos ?? false;
  const generation = editing.state?.imageGeneration ?? false;
  const cutOut = editing.state?.cutOut ?? false;
  // Typed into the new frame (`useInsertFrame`): the search goes on with it – without a photo
  // service the description of a picture to generate.
  const [ahead] = useState(() => typedAhead.peek(element.id));
  useEffect(() => void typedAhead.take(element.id), [element.id]);
  // The search is open from the start, with photos at random – the editor's keys stay its own
  // until it is opened by hand (`StockPhotoSearch`); its button folds it away, as „Generieren“
  // its description.
  const [open, setOpen] = useState<'search' | 'generate' | 'icons' | null>(
    stock ? 'search' : (ahead || previewQuery !== undefined) && generation ? 'generate' : null,
  );
  const [searchedByHand, setSearchedByHand] = useState(Boolean(ahead));
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
  const removeBackground = useRemoveBackground(deck.id);
  const freeUp = async () => {
    try {
      const image = await removeBackground.mutateAsync(element.id);
      await editing.apply([
        { type: 'replaceImage', elementId: element.id, imageId: image.imageId },
      ]);
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'Der Hintergrund ließ sich nicht entfernen.',
        'danger',
      );
    }
  };
  const shown = editing.offline ? null : open;
  const toggle = (what: 'search' | 'generate' | 'icons') =>
    setOpen((now) => (now === what ? null : what));
  // A symbol: the symbols' search, with what was typed on its frame – the keys go there at once
  // only in a new frame (not its preview, where the frame's chooser has them); a symbol picked
  // again keeps them for the editor until its field is clicked.
  if (symbol) {
    if (editing.offline) return <p className="text-caption text-fg-subtle">{OFFLINE_HINT}</p>;
    return (
      <IconSearch
        element={element}
        large={large}
        autoFocus={!preview && !element.symbol}
        initialQuery={ahead}
        query={preview ? previewQuery : undefined}
        onPicked={() => {}}
      />
    );
  }
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
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon="upload"
          loading={upload.isPending}
          disabled={editing.offline}
          title={editing.offline ? OFFLINE_HINT : 'Das neue Bild wird in den Rahmen eingepasst.'}
          onClick={() => fileRef.current?.click()}
          className="flex-1"
        >
          Datei
        </Button>
        {stock && (
          <Button
            size="sm"
            variant={shown === 'search' ? 'primary' : 'secondary'}
            icon="search"
            aria-expanded={shown === 'search'}
            disabled={editing.offline}
            title={
              editing.offline
                ? OFFLINE_HINT
                : 'Ein Foto suchen – es wird auf den Rahmen zugeschnitten.'
            }
            onClick={() => {
              setSearchedByHand(true);
              toggle('search');
            }}
            className="flex-1"
          >
            Foto suchen
          </Button>
        )}
        <Button
          size="sm"
          variant={shown === 'icons' ? 'primary' : 'secondary'}
          icon="shapes"
          aria-expanded={shown === 'icons'}
          disabled={editing.offline}
          title={
            editing.offline
              ? OFFLINE_HINT
              : 'Ein Icon oder Piktogramm in einer Farbe der Präsentation – es wird in den Rahmen eingepasst.'
          }
          onClick={() => toggle('icons')}
          className="flex-1"
        >
          Symbole
        </Button>
        {generation && (
          <Button
            size="sm"
            variant={shown === 'generate' ? 'primary' : 'secondary'}
            icon="autoAwesome"
            aria-expanded={shown === 'generate'}
            disabled={editing.offline}
            title={
              editing.offline
                ? OFFLINE_HINT
                : 'Ein Bild aus einer Beschreibung erzeugen – passend zum Rahmen.'
            }
            onClick={() => toggle('generate')}
            className="flex-1"
          >
            Generieren
          </Button>
        )}
      </div>
      {cutOut && (
        <Button
          size="sm"
          variant="secondary"
          icon="autoFixHigh"
          loading={removeBackground.isPending}
          // The server cuts out the picture it has: edits still on their way first.
          disabled={editing.offline || editing.pending > 0}
          title={
            editing.offline
              ? OFFLINE_HINT
              : 'Den Hintergrund des Bilds durchsichtig machen – rückgängig mit ⌘Z.'
          }
          onClick={() => void freeUp()}
        >
          {removeBackground.isPending ? 'Wird freigestellt …' : 'Hintergrund entfernen'}
        </Button>
      )}
      {element.picture && (
        <ImageFitControls element={element} picture={element.picture} slideId={slideId} />
      )}
      {stock && shown === 'search' && (
        <StockPhotoSearch
          element={element}
          slideId={slideId}
          large={large}
          autoFocus={searchedByHand}
          initialQuery={ahead}
          query={previewQuery}
          onPicked={() => setOpen(null)}
        />
      )}
      {shown === 'icons' && (
        <IconSearch element={element} large={large} onPicked={() => setOpen(null)} />
      )}
      {generation && shown === 'generate' && (
        <GenerateImage
          element={element}
          initialPrompt={stock ? '' : ahead}
          prompt={stock ? undefined : previewQuery}
        />
      )}
      {element.credit && <PhotoCredit credit={element.credit} />}
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
