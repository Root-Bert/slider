import { useCommandKeyClaim } from '@/features/commands';
import { isApplePlatform } from '@/lib/platform';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  isWriterLink,
  WRITER_FORMATS,
  writerFormatOf,
  type WriterAlign,
  type WriterFormat,
  type WriterLook,
} from '@slider/shared';
import {
  Avatar,
  Button,
  cn,
  ColorMixer,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  PopoverPanel,
  SegmentedControl,
  TextField,
  useIsNarrow,
  usePopover,
  type IconName,
  type MenuAction,
} from '@/ui';
import {
  alignOf,
  entries,
  fontAt,
  hasMark,
  isCollapsed,
  linkAt,
  marksAt,
  ordered,
  paragraphOf,
  sizeAt,
  type Blocks,
  type ToggleMark,
} from '../lib/model';
import { editorFonts, FontField, PickField, SizeField } from '@/features/viewer';
import { family } from '../lib/view';
import type { WriterEngine } from './engine';
import { useWriter, useWriterState } from './session';
import { NewPicture } from './DocumentPhotos';
import { PhotoCredit } from '@/features/viewer';
import { FORMAT_LABELS } from './labels';
import { TablePicker } from './WriterToolbar';

/** The keys that set a format, as the list shows them. */
const FORMAT_KEYS: Partial<Record<WriterFormat, string>> = Object.fromEntries(
  (['text', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6'] as const).map(
    (format, index) => [format, isApplePlatform() ? `⌥⌘${index}` : `Strg Alt ${index}`],
  ),
);

/**
 * „Absatzformat“: what the paragraph is. The list shows every format as the document writes it
 * – its font, weight and (scaled to the list) its size – so a heading reads as a heading before
 * it is picked.
 */
function FormatPicker({
  value,
  formats,
  only,
  onPick,
  onMatch,
}: {
  value: WriterFormat;
  formats: Record<WriterFormat, WriterLook>;
  /** Only these (what Markdown can write). */
  only?: readonly WriterFormat[];
  onPick: (format: WriterFormat) => void;
  /** The format takes the look of what is selected, everywhere in the document. */
  onMatch: () => void;
}) {
  const { open, close, wrapperRef, triggerProps, panelRef, panelId } = usePopover({
    hasPopup: true,
    returnFocus: false,
  });
  // Those the server knows: one older than this page sends fewer.
  const known = WRITER_FORMATS.filter(
    (format) => formats[format] && (!only || only.includes(format)),
  );
  const sizes = known.map((format) => formats[format].size);
  const least = Math.min(...sizes);
  const most = Math.max(...sizes);
  /** 14 to 26 px over the document's own range of sizes. */
  const shown = (size: number) =>
    most === least ? 15 : Math.round(14 + ((size - least) / (most - least)) * 12);
  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        {...triggerProps}
        aria-label={`Absatzformat: ${FORMAT_LABELS[value]}`}
        title="Absatzformat"
        className="field-well focus-field flex h-8 w-full items-center gap-1 rounded-control-sm pr-1 pl-2 text-left text-sm text-fg"
      >
        <span className="min-w-0 flex-1 truncate">{FORMAT_LABELS[value]}</span>
        <Icon name="expandMore" size={16} className="shrink-0 text-fg-subtle" />
      </button>
      {open && (
        <PopoverPanel
          ref={panelRef}
          id={panelId}
          padding="sm"
          aria-label="Absatzformat"
          className="max-h-[min(28rem,70vh)] w-64 overflow-y-auto"
        >
          {known.map((format) => {
            const look = formats[format];
            return (
              <MenuItem
                key={format}
                inset={4}
                selected={format === value}
                trailing={
                  <span className="text-caption whitespace-nowrap text-fg-subtle tabular-nums">
                    {FORMAT_KEYS[format]}
                  </span>
                }
                onClick={() => {
                  close();
                  onPick(format);
                }}
              >
                <span
                  className="block truncate leading-tight"
                  style={{
                    fontFamily: family(look.font),
                    fontSize: shown(look.size),
                    fontWeight: look.bold ? 700 : 400,
                    fontStyle: look.italic ? 'italic' : 'normal',
                  }}
                >
                  {FORMAT_LABELS[format]}
                </span>
              </MenuItem>
            );
          })}
          <div aria-hidden className="mx-2 my-1 h-px bg-hairline" />
          <MenuItem
            inset={4}
            title={`Alle Absätze mit „${FORMAT_LABELS[value]}“ sehen danach aus wie die Auswahl`}
            onClick={() => {
              close();
              onMatch();
            }}
          >
            „{FORMAT_LABELS[value]}“ an Auswahl anpassen
          </MenuItem>
        </PopoverPanel>
      )}
    </div>
  );
}

const MARKS: { mark: ToggleMark; icon: IconName; label: string }[] = [
  { mark: 'bold', icon: 'formatBold', label: 'Fett (⌘B)' },
  { mark: 'italic', icon: 'formatItalic', label: 'Kursiv (⌘I)' },
  { mark: 'underline', icon: 'formatUnderlined', label: 'Unterstrichen (⌘U)' },
  { mark: 'strike', icon: 'formatStrikethrough', label: 'Durchgestrichen (⇧⌘X)' },
];
/** What rendered Markdown writes: `#` to `######`, `>`, code. */
const NOTES_FORMATS: readonly WriterFormat[] = [
  'text',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'quote',
  'preformatted',
];
const ALIGNS: { align: WriterAlign; icon: IconName; label: string }[] = [
  { align: 'left', icon: 'formatAlignLeft', label: 'Linksbündig' },
  { align: 'center', icon: 'formatAlignCenter', label: 'Zentriert' },
  { align: 'right', icon: 'formatAlignRight', label: 'Rechtsbündig' },
  { align: 'justify', icon: 'formatAlignJustify', label: 'Blocksatz' },
];

const LINE_HEIGHTS = [1, 1.15, 1.5, 2];
const decimal = (value: number) =>
  Number(value.toFixed(2)).toLocaleString('de-DE', { minimumFractionDigits: 1 });

/** The colours the document wears already („Farben“). */
function documentColors(blocks: Blocks, key: 'color' | 'highlight', first: readonly string[]) {
  const seen = new Set(first.map((each) => each.toLowerCase()));
  for (const { block } of entries(blocks)) {
    if (key === 'color') seen.add(block.look.color.toLowerCase());
    for (const run of block.runs) {
      const color = run[key];
      if (color) seen.add(color.toLowerCase());
    }
    if (seen.size >= 14) break;
  }
  return [...seen].slice(0, 14);
}

function BarPopover({
  icon,
  label,
  active,
  mark,
  swatch,
  children,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  /** Names the button for a shortcut that opens it. */
  mark?: 'link';
  /** Shown as the colour it sets, a round field as a slide's text colour. */
  swatch?: string;
  children: (close: () => void) => ReactNode;
}) {
  const { open, close, wrapperRef, triggerProps, panelRef, panelId } = usePopover({
    hasPopup: true,
    returnFocus: false,
  });
  return (
    <div ref={wrapperRef} className="relative" data-link={mark === 'link' ? '' : undefined}>
      {swatch ? (
        <button
          type="button"
          {...triggerProps}
          aria-label={label}
          title={label}
          className="focus-ring flex size-8 items-center justify-center rounded-full"
        >
          <span
            className="size-6 rounded-full ring-1 ring-hairline-strong ring-inset"
            style={{ backgroundColor: swatch }}
          />
        </button>
      ) : (
        <IconButton
          {...triggerProps}
          icon={icon}
          label={label}
          size="compact"
          variant="subtle"
          active={active}
          expanded={open}
        />
      )}
      {open && (
        <PopoverPanel ref={panelRef} id={panelId} padding="lg" aria-label={label} className="w-64">
          {children(close)}
        </PopoverPanel>
      )}
    </div>
  );
}

function Colors({
  label,
  colors,
  value,
  none,
  onPick,
  onMix,
}: {
  label: string;
  colors: readonly string[];
  value: string | null;
  none: string;
  onPick: (color: string | null) => void;
  onMix: (color: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-fg-subtle">Farben</span>
        <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
          {colors.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              title={color}
              aria-pressed={value?.toLowerCase() === color}
              onClick={() => onPick(color)}
              className={cn(
                'focus-ring size-6 rounded-full ring-1 ring-hairline-strong ring-inset',
                value?.toLowerCase() === color && 'outline-2 outline-offset-2 outline-fg',
              )}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-fg-subtle">Eigene</span>
        <ColorMixer value={value} onChange={onMix} />
      </div>
      <Button variant="ghost" size="sm" icon="formatColorReset" onClick={() => onPick(null)}>
        {none}
      </Button>
    </div>
  );
}

function LinkForm({ href, onDone }: { href: string; onDone: (href: string | null) => void }) {
  const [value, setValue] = useState(href);
  const trimmed = value.trim();
  const full = trimmed === '' || isWriterLink(trimmed) ? trimmed : `https://${trimmed}`;
  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (full !== '') onDone(full);
      }}
    >
      <TextField
        autoFocus
        aria-label="Adresse"
        placeholder="https://"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="flex justify-end gap-2">
        {href !== '' && (
          <Button variant="ghost" size="sm" icon="linkOff" onClick={() => onDone(null)}>
            Entfernen
          </Button>
        )}
        <Button type="submit" size="sm" disabled={full === ''}>
          Übernehmen
        </Button>
      </div>
    </form>
  );
}

/**
 * The font and its size, a presentation's two fields: each opens its list, and what is hovered
 * or stepped through there shows in the text at once; picked, it stays.
 */
function FontAndSize() {
  const { engine } = useWriter();
  const { blocks, sel, pending } = useWriterState();
  // What the words wore before the list tried others on them.
  const before = useRef<{ font: string | null; size: number | null } | null>(null);
  if (!sel) return null;
  const font = fontAt(blocks, sel, pending ?? undefined);
  const size = sizeAt(blocks, sel, pending ?? undefined);
  const fonts = editorFonts();
  const offered =
    font && !fonts.includes(font) ? [...fonts, font].sort((a, b) => a.localeCompare(b)) : fonts;
  const start = () => (before.current ??= { font, size });
  return (
    <>
      <div className="flex min-w-0 flex-1">
        <FontField
          value={font}
          fonts={offered}
          onTry={(tried) => {
            const was = start();
            if (tried) engine.font(tried, false);
            else {
              // Mixed fonts are not put back by one value: nothing was tried on them.
              if (was.font) engine.font(was.font, false);
              before.current = null;
            }
          }}
          onPick={(picked) => {
            before.current = null;
            engine.font(picked);
          }}
          onDone={() => engine.focus()}
        />
      </div>
      <SizeField
        size={size}
        onChange={(next) => engine.size(next, false)}
        onTry={(tried) => {
          const was = start();
          if (tried) engine.size(tried, false);
          else {
            if (was.size) engine.size(was.size, false);
            before.current = null;
          }
        }}
        onPick={(picked) => {
          before.current = null;
          engine.size(picked);
        }}
        onDone={() => engine.focus()}
      />
    </>
  );
}

/** A part of the panel, picked in the row over the selection – a presentation's `PanelTab`. */
type Part = 'text' | 'picture' | 'table';

/**
 * What a document is made of, as a slide's new element offers Text, Form, Bild, Symbol: the one
 * at hand is picked; another one is put in (a picture chosen, a table's size picked).
 */
const PARTS: { id: Part; icon: IconName; label: string }[] = [
  { id: 'text', icon: 'textFields', label: 'Text' },
  { id: 'picture', icon: 'image', label: 'Bild' },
  { id: 'table', icon: 'tableChart', label: 'Tabelle' },
];

const PICTURE_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

/** The row stands this far over (or under) the selection, a presentation's row under its element. */
const ROW_GAP = 16;
/** The panel stands in the comments' column right of the sheet: as far out, as wide (`GUTTER`). */
const PANEL_GAP = 16;
const PANEL_WIDTH = 248;
/** Kept free at the window's edges: the margin, the tools down the right edge, the pill on top. */
const EDGE = 12;
const RIGHT_TOOLS = 56;
const TOP_PILL = 64;

/**
 * Two things show at the selection while editing, as for a presentation's picked element: over
 * it (under it when there is no room) a small row of what the document is made of – Text, Bild,
 * Tabelle, the one at hand picked –, and beside the sheet, at the height of the selection, the
 * panel with that one. Both follow the selection while the page scrolls. The row steps aside
 * while typing, the panel stays. Talked about (not edited), the row offers the comment alone.
 */
export function FormatBar({
  onComment,
  onPictures,
}: {
  onComment: () => void;
  onPictures: (files: File[]) => void;
}) {
  const { engine, document: file, me, markdown } = useWriter();
  const state = useWriterState();
  const row = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pictures = useRef<HTMLInputElement>(null);
  const narrow = useIsNarrow();
  const [within, setWithin] = useState(false);
  const [part, setPart] = useState<Part>('text');
  const { blocks, sel, picked } = state;
  const editing = file.permissions.canEdit && state.mode === 'edit';
  // What is selected starts in the paragraph the panel speaks of: a word picked with the line's
  // end reaches into the next one.
  const block = sel ? paragraphOf(blocks, ordered(blocks, sel).from.id) : undefined;
  const collapsed = sel ? isCollapsed(sel) : true;
  const locked = !!block?.locked;
  const cell = sel && !picked ? engine.cellAt() : null;
  // Stepped to with Tab (`stepped`): Enter takes the part shown. Typing takes Text.
  const [stepped, setStepped] = useState(false);
  // „Tabelle“ or „Bild“ picked to put one in: left again when the caret goes elsewhere, or once
  // typing starts.
  const [seen, setSeen] = useState(sel);
  if (seen !== sel || (state.typing && stepped)) {
    setSeen(sel);
    setStepped(false);
    if (part === 'picture' || (part === 'table' && !cell)) setPart('text');
  }
  const open =
    !!sel &&
    !!block &&
    !state.printing &&
    (editing ? state.focused || within : !collapsed && !picked && file.permissions.canComment);
  // Markdown as written is characters only: nothing to format, the row only comments.
  const showPanel = open && editing && markdown !== 'raw' && (!!picked || !locked);
  // The part shown: a picked picture's; else the one picked in the row.
  const shownNow: Part = picked ? 'picture' : part;
  const showRow = open && !(editing && state.typing && !within);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = (picked && engine.pickedRect()) || engine.selectionRect();
      if (!rect) return;
      const gone = rect.bottom < 0 || rect.top > window.innerHeight;
      const bar = row.current;
      let rowTop = rect.top;
      if (bar) {
        const width = bar.offsetWidth;
        const height = bar.offsetHeight;
        const above = rect.top - ROW_GAP - height;
        rowTop = above < TOP_PILL ? rect.bottom + ROW_GAP : above;
        const left = Math.max(
          EDGE,
          Math.min(
            window.innerWidth - width - RIGHT_TOOLS - EDGE,
            rect.left + rect.width / 2 - width / 2,
          ),
        );
        bar.style.translate = `${Math.round(left)}px ${Math.round(rowTop)}px`;
        bar.style.visibility = gone ? 'hidden' : 'visible';
      }
      const box = panel.current;
      if (box && !narrow) {
        const width = box.offsetWidth;
        const height = box.offsetHeight;
        const sheet = document.querySelector('[data-writer-root] .writer-stack');
        const right = sheet?.getBoundingClientRect().right ?? window.innerWidth;
        const room = right + PANEL_GAP + width <= window.innerWidth - RIGHT_TOOLS;
        // Beside the sheet at the selection's height; no room there, at the top right.
        const left = room ? right + PANEL_GAP : window.innerWidth - RIGHT_TOOLS - EDGE - width;
        const top = room
          ? Math.max(
              TOP_PILL,
              Math.min(window.innerHeight - height - EDGE, Math.min(rowTop, rect.top)),
            )
          : TOP_PILL;
        box.style.translate = `${Math.round(left)}px ${Math.round(top)}px`;
        box.style.visibility = 'visible';
      }
    };
    place();
    // Once more when the text has been laid out again (a format makes its lines taller).
    const again = requestAnimationFrame(place);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      cancelAnimationFrame(again);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  });

  // Tab / ⇧Tab steps through the row's parts, round and round, as through a slide's parts – while
  // the row stands over the caret, before anything is typed; Enter takes the one shown (Text: the
  // keys are the text's, Tab too; Bild: a picture is chosen; Tabelle: its size is picked), Esc
  // goes back to Text. Typing takes Text right away.
  const cycling = showRow && editing && !picked && !within;
  useEffect(() => {
    if (!cycling) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !target?.closest('[data-writer-root]') ||
        target.closest('input, textarea, select, [data-chrome]')
      )
        return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const at = PARTS.findIndex((each) => each.id === shownNow);
      if (event.key === 'Tab') {
        const step = event.shiftKey ? -1 : 1;
        setPart(PARTS[(at + step + PARTS.length) % PARTS.length]!.id);
        setStepped(true);
      } else if (event.key === 'Enter' && stepped) {
        setStepped(false);
        if (shownNow === 'text') engine.startTyping();
        else if (shownNow === 'picture') {
          setPart('text');
          pictures.current?.click();
        } else {
          // The panel's first control has the keys: the table's size, or the table's tools.
          requestAnimationFrame(() =>
            (
              panel.current?.querySelector<HTMLElement>('[data-start]') ??
              panel.current?.querySelector<HTMLElement>('[data-part] button, [data-part] select')
            )?.focus(),
          );
        }
      } else if (event.key === 'Escape' && stepped) {
        setStepped(false);
        setPart('text');
      } else return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  });

  // ⌘K: the link's field, as its button opens it – while text is picked, in place of the command
  // panel.
  const linkable = showPanel && !picked && (!collapsed || !!(sel && linkAt(blocks, sel.focus)));
  useCommandKeyClaim(
    linkable
      ? () => {
          setPart('text');
          // The text part shows its link button once rendered.
          requestAnimationFrame(() => {
            const button = panel.current?.querySelector<HTMLButtonElement>('[data-link] button');
            if (button && button.getAttribute('aria-expanded') !== 'true') button.click();
          });
        }
      : null,
  );

  // A panel that went takes the focus it held with it.
  if (!open && within) setWithin(false);

  // Kept while the system's file dialog has the focus (and the row is gone meanwhile).
  const chooser = (
    <input
      ref={pictures}
      type="file"
      hidden
      multiple
      accept={PICTURE_TYPES}
      onChange={(event) => {
        const files = [...(event.target.files ?? [])];
        event.target.value = '';
        if (files.length > 0) onPictures(files);
      }}
    />
  );

  if (!open || !sel || !block) return chooser;

  const shown: Part = shownNow;
  const label =
    shown === 'picture'
      ? picked
        ? 'Bild'
        : 'Bild einfügen'
      : shown === 'table'
        ? cell
          ? 'Tabelle'
          : 'Tabelle einfügen'
        : writerFormatOf(block) === 'text'
          ? 'Text'
          : `Text „${FORMAT_LABELS[writerFormatOf(block)]}“`;

  const pickPart = (id: Part) => {
    // A picked picture's panel is shown already; else „Bild“ shows Datei, Foto suchen, Generieren.
    if (id === 'picture') {
      if (!picked) setPart('picture');
      return;
    }
    if (picked) engine.leavePicked();
    setPart(id);
  };

  /** Focus inside either keeps both; the selection stays where it is while they are clicked. */
  const keep = {
    onFocus: () => setWithin(true),
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget as Node | null;
      if (!row.current?.contains(next) && !panel.current?.contains(next)) setWithin(false);
    },
    onMouseDown: (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('select, input, textarea')) event.preventDefault();
    },
  };

  // Talked about, the words picked are commented on; while writing that is not the row's.
  const comment = !editing && file.permissions.canComment && (
    <IconButton
      icon="addComment"
      label="Kommentieren"
      size="sm"
      variant="subtle"
      onClick={onComment}
    />
  );

  // Markdown has neither pictures nor tables here: only its text.
  const tabs = showPanel && !markdown && (
    <div role="tablist" aria-label="Was bearbeiten" className="flex gap-1">
      {PARTS.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={shown === item.id}
          title={
            item.id === 'picture' && !picked
              ? 'Bild einfügen'
              : item.id === 'table' && !cell
                ? 'Tabelle einfügen'
                : item.label
          }
          onClick={() => pickPart(item.id)}
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
      ))}
    </div>
  );

  return (
    <>
      {chooser}
      {showRow && (tabs || comment) && !(narrow && showPanel) && (
        <div
          ref={row}
          data-chrome
          data-format-tabs=""
          {...keep}
          className="glass-elevated fixed top-0 left-0 z-(--z-popover) flex animate-pop-in items-center gap-1 rounded-panel p-1"
          style={{ visibility: 'hidden' }}
        >
          {tabs}
          {comment}
        </div>
      )}
      {showPanel && (
        <div
          ref={panel}
          data-chrome
          role="dialog"
          aria-label={`${label} bearbeiten`}
          data-format-bar=""
          {...keep}
          className={cn(
            'glass-elevated fixed z-(--z-popover) flex animate-pop-in flex-col gap-3 rounded-panel p-3',
            narrow ? 'inset-x-3 bottom-6 w-auto' : 'top-0 left-0',
          )}
          style={narrow ? undefined : { visibility: 'hidden', width: PANEL_WIDTH }}
        >
          <header className="flex items-center gap-2">
            <Avatar author={me} size={24} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">{label}</span>
            <IconButton
              icon="close"
              label="Fertig (Esc)"
              size="sm"
              onClick={() => engine.view.root.blur()}
            />
          </header>
          {shown === 'text' && <TextPart />}
          <div data-part className="contents">
            {shown === 'picture' &&
              (picked ? (
                <PicturePart />
              ) : (
                <>
                  <p className="text-xs text-fg-muted">Ein Bild an die Stelle des Cursors.</p>
                  <NewPicture onFile={() => pictures.current?.click()} />
                </>
              ))}
            {shown === 'table' &&
              (cell ? (
                <TablePart cell={cell} />
              ) : (
                <TablePicker onPick={(rows, columns) => engine.table(rows, columns)} />
              ))}
          </div>
          {narrow && tabs}
        </div>
      )}
    </>
  );
}

/**
 * The words and their paragraph, laid out as a slide's text: the format; font and size; the
 * marks, the link and the colours; lists, their level and the line spacing; the alignment.
 */
function TextPart() {
  const { engine, markdown } = useWriter();
  // Rendered Markdown: only what it can write – no font, size, colour, spacing or alignment.
  const notes = markdown === 'rendered';
  const state = useWriterState();
  const { blocks, sel, pending } = state;
  if (!sel) return null;
  const block = paragraphOf(blocks, ordered(blocks, sel).from.id);
  if (!block) return null;
  const collapsed = isCollapsed(sel);
  const marks = pending ?? marksAt(block, sel.focus.offset);
  const wears = (mark: ToggleMark) => (collapsed ? !!marks[mark] : hasMark(blocks, sel, mark));
  const link = linkAt(blocks, sel.focus);
  const color = marks.color ?? block.look.color;
  const spacing = engine.lineHeightNow();
  const spacings = [
    ...LINE_HEIGHTS,
    // One of its own (1,3 from a file) is named too, so one is always picked.
    ...(spacing.own !== null && !LINE_HEIGHTS.includes(spacing.own) ? [spacing.own] : []),
  ];
  return (
    <>
      <FormatPicker
        value={writerFormatOf(block)}
        formats={state.formats}
        {...(notes && { only: NOTES_FORMATS })}
        onPick={(format) => {
          engine.format(format);
          engine.focus();
        }}
        onMatch={() => engine.restyleToSelection()}
      />
      {!notes && (
        <div className="flex gap-1.5">
          <FontAndSize />
        </div>
      )}
      <div className="flex items-center gap-0.5">
        {MARKS.filter(({ mark }) => !notes || mark !== 'underline').map(({ mark, icon, label }) => (
          <IconButton
            key={mark}
            icon={icon}
            label={label}
            size="compact"
            variant="subtle"
            active={wears(mark)}
            aria-pressed={wears(mark)}
            onClick={() => engine.toggle(mark)}
          />
        ))}
        {(!collapsed || link) && (
          <BarPopover icon="link" label="Link (⌘K)" active={!!link} mark="link">
            {(close) => (
              <LinkForm
                href={link?.href ?? ''}
                onDone={(href) => {
                  close();
                  engine.link(href);
                }}
              />
            )}
          </BarPopover>
        )}
        <span className="ml-auto" />
        {!collapsed && !notes && (
          <BarPopover icon="highlight" label="Markieren" active={!!marks.highlight}>
            {(close) => (
              <Colors
                label="Markieren"
                colors={documentColors(blocks, 'highlight', ['#ffff00'])}
                value={marks.highlight ?? null}
                none="Keine Markierung"
                onMix={(next) => engine.highlight(next, false)}
                onPick={(next) => {
                  close();
                  engine.highlight(next);
                }}
              />
            )}
          </BarPopover>
        )}
        {!notes && (
          <BarPopover icon="palette" label="Textfarbe" swatch={color}>
            {(close) => (
              <Colors
                label="Textfarbe"
                colors={documentColors(blocks, 'color', ['#000000'])}
                value={color}
                none="Farbe des Formats"
                onMix={(next) => engine.color(next, false)}
                onPick={(next) => {
                  close();
                  engine.color(next);
                }}
              />
            )}
          </BarPopover>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <IconButton
          icon="formatListBulleted"
          label="Aufzählung (⇧⌘8)"
          size="compact"
          variant="subtle"
          active={block.list?.kind === 'bullet'}
          aria-pressed={block.list?.kind === 'bullet'}
          onClick={() => engine.list('bullet')}
        />
        <IconButton
          icon="formatListNumbered"
          label="Nummerierung (⇧⌘7)"
          size="compact"
          variant="subtle"
          active={block.list?.kind === 'number'}
          aria-pressed={block.list?.kind === 'number'}
          onClick={() => engine.list('number')}
        />
        <IconButton
          icon="formatIndentDecrease"
          label="Ebene höher (⇧⇥)"
          size="compact"
          variant="subtle"
          disabled={!block.list}
          onClick={() => engine.indent(-1)}
        />
        <IconButton
          icon="formatIndentIncrease"
          label="Ebene tiefer (⇥)"
          size="compact"
          variant="subtle"
          disabled={!block.list}
          onClick={() => engine.indent(1)}
        />
        <span className="ml-auto" />
        {!notes && (
          <PickField
            label="Zeilenabstand"
            shown={
              <>
                <Icon name="formatLineSpacing" size={16} />
                {spacing.mixed ? '–' : spacing.own === null ? 'Auto' : decimal(spacing.own)}
              </>
            }
            value={spacing.mixed ? '' : spacing.own === null ? 'format' : String(spacing.own)}
            options={[
              { value: 'format', label: 'Wie das Format' },
              ...spacings.map((value) => ({ value: String(value), label: decimal(value) })),
            ]}
            onChange={(value) =>
              engine.lineHeight(value === 'format' ? null : Number(value), false)
            }
          />
        )}
      </div>
      {!notes && (
        <SegmentedControl
          label="Ausrichtung"
          size="md"
          iconOnly
          fill
          value={alignOf(block)}
          onChange={(align) => engine.align(align)}
          segments={ALIGNS.map(({ align, icon, label }) => ({ value: align, icon, label }))}
        />
      )}
    </>
  );
}

/** The picture picked: its corners size it; it can go. */
function PicturePart() {
  const { engine } = useWriter();
  const credit = engine.pickedPicture()?.credit;
  const align = engine.pickedAlign();
  return (
    <>
      {/* Left, centred, right across the sheet – as a picture in a slide's text box stands. */}
      {align && (
        <SegmentedControl
          label="Ausrichtung des Bilds"
          size="md"
          iconOnly
          fill
          value={align === 'justify' ? 'left' : align}
          onChange={(next) => engine.alignPicked(next)}
          segments={ALIGNS.filter((each) => each.align !== 'justify').map(
            ({ align: value, icon, label }) => ({ value, icon, label }),
          )}
        />
      )}
      <p className="text-caption text-fg-subtle">An den Ecken ziehen ändert die Größe.</p>
      {/* A photo service's photo names who took it, as on a slide. */}
      {credit && <PhotoCredit credit={credit} />}
      <Button
        variant="ghost"
        size="sm"
        icon="delete"
        className="self-start"
        onClick={() => engine.removePicked()}
      >
        Bild löschen
      </Button>
    </>
  );
}

/** The table the caret stands in: rows, columns, cells joined or split, the table deleted. */
function TablePart({ cell }: { cell: NonNullable<ReturnType<WriterEngine['cellAt']>> }) {
  const { engine } = useWriter();
  return (
    <>
      <div className="flex gap-1.5">
        <Menu
          label="Zeilen der Tabelle"
          triggerText="Zeile"
          actions={[
            { label: 'Zeile darüber', icon: 'add', onSelect: () => engine.row('above') },
            { label: 'Zeile darunter', icon: 'add', onSelect: () => engine.row('below') },
            ...(cell.rows > 1
              ? [
                  {
                    label: 'Zeile löschen',
                    icon: 'delete',
                    tone: 'danger',
                    onSelect: () => engine.removeRow(),
                  } satisfies MenuAction,
                ]
              : []),
          ]}
        />
        <Menu
          label="Spalten der Tabelle"
          triggerText="Spalte"
          actions={[
            { label: 'Spalte davor', icon: 'add', onSelect: () => engine.column('before') },
            { label: 'Spalte danach', icon: 'add', onSelect: () => engine.column('after') },
            ...(cell.columns > 1
              ? [
                  {
                    label: 'Spalte löschen',
                    icon: 'delete',
                    tone: 'danger',
                    onSelect: () => engine.removeColumn(),
                  } satisfies MenuAction,
                ]
              : []),
          ]}
        />
      </div>
      {(cell.several || cell.merged) && (
        <div className="flex gap-1.5">
          {cell.several && (
            <Button variant="ghost" size="sm" onClick={() => engine.mergeCells()}>
              Zellen verbinden
            </Button>
          )}
          {cell.merged && !cell.several && (
            <Button variant="ghost" size="sm" onClick={() => engine.splitCell()}>
              Zelle teilen
            </Button>
          )}
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        icon="delete"
        className="self-start"
        onClick={() => engine.removeTable()}
      >
        Tabelle löschen
      </Button>
    </>
  );
}
