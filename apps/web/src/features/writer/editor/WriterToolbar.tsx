import {
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  isWriterMarkdown,
  LAYOUT_GRID_MAX_TRACKS,
  type LayoutGridAxis,
  type WriterPage,
} from '@slider/shared';
import {
  cn,
  IconButton,
  MenuItem,
  NumberField,
  PopoverPanel,
  SegmentedControl,
  Select,
  Toolbar,
  usePopover,
  type IconName,
} from '@/ui';
import { VoiceContext } from '@/features/viewer';
import { useWriterVoice, WriterVoiceBar } from '../voice/WriterVoiceProvider';
import { DocumentVersions } from './DocumentVersions';
import { pageGuides, usePageGuides } from './guides';
import { PageCounter, WordCount } from './PageStrip';
import { useWriter, useWriterState, type WriterPages } from './session';
import { clampZoom, ZOOM_MAX, ZOOM_MIN, ZOOMS, type ZoomChoice } from './zoom';

export type { ZoomChoice } from './zoom';
/** The handle dragged this far to the left doubles the page (to the right halves it). */
const ZOOM_DRAG_PX = 240;
const ZOOM_KEY_STEP = 0.05;
const ZOOM_KEY_STEP_LARGE = 0.25;

const Rule = () => <span aria-hidden className="my-0.5 h-px w-5 shrink-0 bg-hairline-strong" />;

/** A tool whose choices open beside the bar, towards the page. */
function Flyout({
  icon,
  label,
  disabled,
  children,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const { open, close, wrapperRef, triggerProps, panelRef, panelId } = usePopover({
    hasPopup: true,
  });
  return (
    <div ref={wrapperRef} className="relative">
      <IconButton
        {...triggerProps}
        icon={icon}
        label={label}
        expanded={open}
        disabled={disabled}
        size="sm"
      />
      {open && (
        <PopoverPanel
          ref={panelRef}
          id={panelId}
          position="none"
          padding="sm"
          aria-label={label}
          className="absolute top-1/2 right-full mr-3 min-w-44 origin-right -translate-y-1/2"
        >
          {children(close)}
        </PopoverPanel>
      )}
    </div>
  );
}

/** The sheets' colour, as „Darstellung“ offers the app's: light, as the app, dark. */
const PAGE_CHOICES: readonly { value: WriterPages; label: string; icon: IconName }[] = [
  { value: 'light', label: 'Hell', icon: 'lightMode' },
  { value: 'theme', label: 'Wie Darstellung', icon: 'desktopWindows' },
  { value: 'dark', label: 'Dunkel', icon: 'darkMode' },
];

/**
 * „Hilfslinien“ (G) and „Layout-Ansicht“ (H), as in a presentation's tool bar: the guides' button
 * lit, softly pulsing, while something sticks out over the margins – also with them hidden. The
 * grid's sizes open at a right click on its button (⇧H), the grid on with them.
 */
function GuideButtons({ crossed }: { crossed: boolean }) {
  const { guides, grid, gridPanel, layout, layers } = usePageGuides();
  const { open, setOpen, wrapperRef, triggerProps, panelRef, panelId } = usePopover({
    hasPopup: true,
    onOpenChange: (next) => {
      if (next !== gridPanel) pageGuides.setGridPanel(next);
    },
  });
  useEffect(() => setOpen(gridPanel), [gridPanel, setOpen]);
  const axis = (name: 'columns' | 'rows', label: string) => {
    const value = layout[name];
    const change = (next: Partial<LayoutGridAxis>) =>
      pageGuides.setLayout({ ...layout, [name]: { ...value, ...next } });
    return (
      <div className="flex flex-col gap-1.5">
        <GridField label={label}>
          <NumberField
            label={label}
            value={value.count}
            min={0}
            max={LAYOUT_GRID_MAX_TRACKS}
            step={1}
            align="center"
            className="w-20"
            onChange={(count) => change({ count: Math.round(count) })}
          />
        </GridField>
        <GridField label="Abstand">
          <NumberField
            label={`Abstand der ${label}`}
            value={value.gutter}
            min={0}
            max={10}
            step={0.1}
            unit="cm"
            align="center"
            className="w-20"
            onChange={(gutter) => change({ gutter })}
          />
        </GridField>
      </div>
    );
  };
  return (
    <>
      {/* The page's blocks listed beside it and outlined on it, as a slide's layers. */}
      <IconButton
        icon="layers"
        label="Ebenen"
        title="Ebenen (L)"
        aria-keyshortcuts="L"
        size="sm"
        active={layers}
        aria-pressed={layers}
        onClick={() => pageGuides.setLayers(!layers)}
      />
      <IconButton
        icon="guides"
        label="Hilfslinien"
        title={crossed ? 'Hilfslinien (G) – etwas ragt über die Ränder' : 'Hilfslinien (G)'}
        aria-keyshortcuts="G"
        size="sm"
        className={crossed ? 'guide-alert' : undefined}
        active={guides}
        aria-pressed={guides}
        onClick={pageGuides.toggleGuides}
      />
      <div ref={wrapperRef} className="relative">
        <IconButton
          {...triggerProps}
          onClick={pageGuides.toggleGrid}
          onContextMenu={(event) => {
            event.preventDefault();
            pageGuides.setGridPanel(!gridPanel);
          }}
          icon="layoutGrid"
          label="Layout-Ansicht"
          title="Layout-Ansicht (H) – Rechtsklick: Spalten und Zeilen"
          aria-keyshortcuts="H Shift+H"
          size="sm"
          active={grid}
          aria-pressed={grid}
        />
        {open && (
          <PopoverPanel
            ref={panelRef}
            id={panelId}
            position="none"
            padding="sm"
            aria-label="Layout-Ansicht"
            className="absolute top-1/2 right-full mr-3 flex w-56 origin-right -translate-y-1/2 flex-col gap-3 p-3"
          >
            {axis('columns', 'Spalten')}
            {axis('rows', 'Zeilen')}
          </PopoverPanel>
        )}
      </div>
    </>
  );
}

function GridField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-fg-muted">
      <span>{label}</span>
      {children}
    </div>
  );
}

const SIZES = {
  a4: { label: 'A4', width: 595.28, height: 841.89 },
  a5: { label: 'A5', width: 419.53, height: 595.28 },
  letter: { label: 'Letter', width: 612, height: 792 },
} as const;
type SizeName = keyof typeof SIZES;
const MARGINS = {
  narrow: { label: 'Schmal', pt: 36 },
  normal: { label: 'Normal', pt: 56.69 },
  wide: { label: 'Breit', pt: 85.04 },
} as const;
type MarginName = keyof typeof MARGINS;

const near = (a: number, b: number) => Math.abs(a - b) < 1.5;

function PageSetup() {
  const { engine } = useWriter();
  const { page } = useWriterState();
  const landscape = page.width > page.height;
  const short = Math.min(page.width, page.height);
  const long = Math.max(page.width, page.height);
  const size =
    (Object.keys(SIZES) as SizeName[]).find(
      (name) => near(SIZES[name].width, short) && near(SIZES[name].height, long),
    ) ?? null;
  const margin =
    (Object.keys(MARGINS) as MarginName[]).find((name) =>
      [page.marginTop, page.marginRight, page.marginBottom, page.marginLeft].every((each) =>
        near(each, MARGINS[name].pt),
      ),
    ) ?? null;
  const set = (patch: Partial<WriterPage>) => engine.setPage({ ...page, ...patch });
  const row = 'flex items-center justify-between gap-4';
  const name = 'text-body text-fg-muted';
  return (
    <div className="flex w-60 flex-col gap-3 p-2">
      <label className={row}>
        <span className={name}>Format</span>
        <Select
          aria-label="Format"
          size="sm"
          value={size ?? 'own'}
          onChange={(next) => {
            if (next === 'own') return;
            const { width, height } = SIZES[next];
            set(landscape ? { width: height, height: width } : { width, height });
          }}
          options={[
            ...(Object.keys(SIZES) as SizeName[]).map((value) => ({
              value,
              label: SIZES[value].label,
            })),
            ...(size ? [] : [{ value: 'own' as const, label: 'Eigenes' }]),
          ]}
        />
      </label>
      <div className={row}>
        <span className={name}>Ausrichtung</span>
        <SegmentedControl
          label="Ausrichtung"
          size="sm"
          track="soft"
          value={landscape ? 'landscape' : 'portrait'}
          onChange={(next) => {
            if ((next === 'landscape') !== landscape)
              set({ width: page.height, height: page.width });
          }}
          segments={[
            { value: 'portrait', label: 'Hoch' },
            { value: 'landscape', label: 'Quer' },
          ]}
        />
      </div>
      <label className={row}>
        <span className={name}>Ränder</span>
        <Select
          aria-label="Ränder"
          size="sm"
          value={margin ?? 'own'}
          onChange={(next) => {
            if (next === 'own') return;
            const pt = MARGINS[next].pt;
            set({ marginTop: pt, marginRight: pt, marginBottom: pt, marginLeft: pt });
          }}
          options={[
            ...(Object.keys(MARGINS) as MarginName[]).map((value) => ({
              value,
              label: MARGINS[value].label,
            })),
            ...(margin ? [] : [{ value: 'own' as const, label: 'Eigene' }]),
          ]}
        />
      </label>
      <label className={cn(row, 'cursor-pointer')}>
        <span className={name}>Seitenzahlen</span>
        <input
          type="checkbox"
          className="size-4 accent-(--selection)"
          checked={page.numbers}
          onChange={(event) => set({ numbers: event.target.checked })}
        />
      </label>
    </div>
  );
}

const GRID = 6;

export function TablePicker({ onPick }: { onPick: (rows: number, columns: number) => void }) {
  const [at, setAt] = useState({ rows: 2, columns: 2 });
  // Arrows walk the grid, Enter (a button's own) puts the table in.
  const walk = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = {
      ArrowRight: [0, 1],
      ArrowLeft: [0, -1],
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
    }[event.key];
    if (!move) return;
    event.preventDefault();
    const rows = Math.min(GRID, Math.max(1, at.rows + move[0]!));
    const columns = Math.min(GRID, Math.max(1, at.columns + move[1]!));
    const cells = event.currentTarget.querySelectorAll<HTMLButtonElement>('button');
    cells[(rows - 1) * GRID + columns - 1]?.focus();
  };
  return (
    <div className="flex flex-col gap-2 p-2">
      <div
        role="grid"
        aria-label="Größe der Tabelle"
        onKeyDown={walk}
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${GRID}, 1fr)` }}
      >
        {Array.from({ length: GRID * GRID }, (_, index) => {
          const rows = Math.floor(index / GRID) + 1;
          const columns = (index % GRID) + 1;
          const lit = rows <= at.rows && columns <= at.columns;
          return (
            <button
              key={index}
              type="button"
              aria-label={`${rows} Zeilen, ${columns} Spalten`}
              data-start={rows === 2 && columns === 2 ? '' : undefined}
              onMouseEnter={() => setAt({ rows, columns })}
              onFocus={() => setAt({ rows, columns })}
              onClick={() => onPick(rows, columns)}
              className={cn(
                'focus-ring size-5 rounded-[3px] ring-1 ring-inset',
                lit ? 'bg-surface-3 ring-fg-subtle' : 'ring-hairline-strong',
              )}
            />
          );
        })}
      </div>
      <p className="text-center text-caption text-fg-subtle tabular-nums">
        {at.rows} × {at.columns}
      </p>
    </div>
  );
}

/**
 * The grabber between the tools' two parts, as a presentation has one between its slides and its
 * comments (`SplitHandle`): dragged down the page is shown larger, up smaller. A double click
 * speaks to the AI – its bar opens beside the handle, towards the page – and without the AI fits
 * the page. As a focusable separator ↑ / ↓ (with Shift: larger steps) step the size, Home / End
 * jump to the smallest / largest, Enter fits the page.
 */
function ZoomHandle({
  shownZoom,
  onZoom,
}: {
  shownZoom: number;
  onZoom: (zoom: ZoomChoice) => void;
}) {
  const voice = useContext(VoiceContext);
  const writerVoice = useWriterVoice();
  const canSpeak = !!voice && !!writerVoice?.available;
  const drag = useRef<{ pointerId: number; startX: number; startZoom: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // While dragging the cursor stays a resize cursor everywhere and nothing gets text-selected.
  useEffect(() => {
    if (!dragging) return;
    const root = document.documentElement;
    const { cursor, userSelect } = root.style;
    root.style.cursor = 'col-resize';
    root.style.userSelect = 'none';
    return () => {
      root.style.cursor = cursor;
      root.style.userSelect = userSelect;
    };
  }, [dragging]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startZoom: shownZoom };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current?.pointerId !== event.pointerId) return;
    // Towards the page makes it larger: on the right there is hardly room to drag.
    const moved = current.startX - event.clientX;
    // A click (or the first of a double click) is no drag: the size stays as chosen.
    if (!dragging && Math.abs(moved) < 3) return;
    setDragging(true);
    onZoom(clampZoom(current.startZoom * 2 ** (moved / ZOOM_DRAG_PX)));
  };
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  };

  const onDoubleClick = () => {
    if (!canSpeak) return onZoom('fit');
    // Only opens it: a double click beside the open bar does nothing more.
    if (voice.status === 'off' || voice.status === 'ended') voice.toggle();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? ZOOM_KEY_STEP_LARGE : ZOOM_KEY_STEP;
    let next: ZoomChoice;
    if (event.key === 'ArrowRight') next = clampZoom(shownZoom - step);
    else if (event.key === 'ArrowLeft') next = clampZoom(shownZoom + step);
    else if (event.key === 'Home') next = ZOOM_MIN;
    else if (event.key === 'End') next = ZOOM_MAX;
    else if (event.key === 'Enter') next = 'fit';
    else return;
    event.preventDefault();
    onZoom(next);
  };

  return (
    <div className="relative flex items-center">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Größe der Seite"
        aria-valuemin={ZOOM_MIN * 100}
        aria-valuemax={ZOOM_MAX * 100}
        aria-valuenow={Math.round(shownZoom * 100)}
        aria-valuetext={`${Math.round(shownZoom * 100)} %`}
        title={`Ziehen: Seite größer oder kleiner\nDoppelklick: ${canSpeak ? `Mit ${writerVoice.ai.name} sprechen` : 'Einpassen'}`}
        tabIndex={0}
        data-zoom-handle
        data-dragging={dragging || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        className="group flex h-10 w-4 cursor-col-resize touch-none items-center justify-center rounded-full outline-none select-none"
      >
        <span
          aria-hidden
          className={cn(
            'w-[3px] rounded-full transition-[background-color,height] duration-150',
            // One or the other: with plain class merging `bg-handle` would outrank `bg-fg`.
            dragging ? 'h-7 bg-fg' : 'h-5 bg-handle',
            'group-hover:h-7 group-hover:bg-fg-muted group-focus-visible:h-7 group-focus-visible:bg-fg-muted group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-focus',
          )}
        />
      </div>
      {voice && <WriterVoiceBar />}
    </div>
  );
}

/**
 * The tools, on the right: how the document is worked on (talked about, written), what goes
 * back, what goes in, where things are found, how the page is cut, how large it is shown, how
 * it leaves.
 */
export function WriterToolbar({
  current,
  crossed,
  zoom,
  shownZoom,
  onZoom,
}: {
  /** The page in the window, counted from 0. */
  current: number;
  /** Something sticks out over the margins (`useMarginOverflows`). */
  crossed: boolean;
  zoom: ZoomChoice;
  shownZoom: number;
  onZoom: (zoom: ZoomChoice) => void;
}) {
  const { engine, document, markdown: markdownView, setMarkdown, pages, setPages } = useWriter();
  const pageChoice = PAGE_CHOICES.find((each) => each.value === pages)!;
  const state = useWriterState();
  const canEdit = document.permissions.canEdit;
  const editing = canEdit && state.mode === 'edit';
  // A Markdown file has no pages: nothing of a page's tools.
  const markdown = isWriterMarkdown(document.fileName);

  return (
    <div
      data-chrome
      // The tools take the window's right edge, top to bottom, in two parts – as a presentation's
      // row has its tools left and its own pill right.
      className="pointer-events-none fixed top-16 right-3 bottom-3 z-(--z-chrome) flex flex-col items-end justify-between gap-3 *:pointer-events-auto"
      onMouseDown={(event) => {
        // The caret stays in the text while a tool is clicked.
        if (!(
          event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement
        ))
          event.preventDefault();
      }}
    >
      {canEdit ? (
        <Toolbar label="Werkzeuge" className="flex-col">
          <IconButton
            icon="chatBubble"
            label="Besprechen (R)"
            size="sm"
            active={state.mode === 'review'}
            aria-pressed={state.mode === 'review'}
            onClick={() => engine.setMode('review')}
          />
          <IconButton
            icon="editor"
            label="Bearbeiten (E)"
            size="sm"
            active={state.mode === 'edit'}
            aria-pressed={state.mode === 'edit'}
            onClick={() => {
              engine.setMode('edit');
              engine.focus();
            }}
          />
          <Rule />
          <IconButton
            icon="undo"
            label="Rückgängig (⌘Z)"
            size="sm"
            disabled={!editing || !state.canUndo}
            onClick={engine.undo}
          />
          <IconButton
            icon="redo"
            label="Wiederholen (⇧⌘Z)"
            size="sm"
            disabled={!editing || !state.canRedo}
            onClick={engine.redo}
          />
          {/* Earlier states of the file, as Cloud lists them – brought back, named, downloaded. */}
          <Flyout icon="history" label="Fassungen">
            {(close) => <DocumentVersions onRestored={close} />}
          </Flyout>
          {!markdown && (
            <>
              <Rule />
              <IconButton
                icon="insertPageBreak"
                label="Seitenumbruch (⌘↵)"
                size="sm"
                disabled={!editing}
                onClick={() => engine.pageBreak()}
              />
            </>
          )}
        </Toolbar>
      ) : (
        <span />
      )}
      <ZoomHandle shownZoom={shownZoom} onZoom={onZoom} />
      <Toolbar label="Ansicht" role="group" className="flex-col">
        {markdownView && (
          <>
            {/* A Markdown file rendered, as it reads – or as it is written. */}
            <IconButton
              icon="article"
              label="Formatiert"
              size="sm"
              active={markdownView === 'rendered'}
              aria-pressed={markdownView === 'rendered'}
              onClick={() => setMarkdown('rendered')}
            />
            <IconButton
              icon="code"
              label="Markdown"
              size="sm"
              active={markdownView === 'raw'}
              aria-pressed={markdownView === 'raw'}
              onClick={() => setMarkdown('raw')}
            />
            <Rule />
          </>
        )}
        {!markdown && <PageCounter current={current} />}
        <WordCount />
        <Rule />
        {!markdown && <GuideButtons crossed={crossed} />}
        {canEdit && !markdown && (
          <Flyout icon="tune" label="Seite einrichten" disabled={!editing}>
            {() => <PageSetup />}
          </Flyout>
        )}
        <Flyout icon={pageChoice.icon} label={`Seitenfarbe (${pageChoice.label})`}>
          {(close) =>
            PAGE_CHOICES.map((each) => (
              <MenuItem
                key={each.value}
                icon={each.icon}
                inset={4}
                selected={pages === each.value}
                onClick={() => {
                  setPages(each.value);
                  close();
                }}
              >
                {each.label}
              </MenuItem>
            ))
          }
        </Flyout>
        <Flyout icon="fitSize" label={`Größe (${Math.round(shownZoom * 100)} %)`}>
          {(close) => (
            <>
              <MenuItem
                inset={4}
                selected={zoom === 'fit'}
                onClick={() => {
                  onZoom('fit');
                  close();
                }}
              >
                Einpassen
              </MenuItem>
              {ZOOMS.map((each) => (
                <MenuItem
                  key={each}
                  inset={4}
                  selected={zoom === each}
                  onClick={() => {
                    onZoom(each);
                    close();
                  }}
                >
                  {each * 100} %
                </MenuItem>
              ))}
            </>
          )}
        </Flyout>
      </Toolbar>
    </div>
  );
}
