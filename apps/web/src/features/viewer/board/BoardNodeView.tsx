import {
  formatFileSize,
  type AccentColor,
  type AuthorColor,
  type BoardItem,
  type Material,
  type MaterialKind,
} from '@slider/shared';
import { NodeResizeControl, useStore, type ControlPosition, type NodeProps } from '@xyflow/react';
import {
  Fragment,
  lazy,
  memo,
  Suspense,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { accentAlpha, accentColor } from '@/lib/accent';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { Avatar, cn, ColorSwatches, Icon, ProgressBar, type IconName } from '@/ui';
import { FrameOutline } from '../stage/FrameOutline';
import { useNearHandles } from '../stage/hooks/useNearHandles';
import type { FrameHandle } from '../stage/lib/frame-outline';
import { ShapeOutline } from '../stage/ShapeOutline';
import type { RectCorner } from '../stage/lib/rect-edit';
import { textShadow, textSurface } from '../stage/lib/text-box-surface';
import {
  BoardNodeContext,
  isBox,
  isMaterial,
  isUploading,
  noteColor,
  STICKER_TEXT,
  type BoardNode,
} from './board-nodes';
import { NoteAnswer } from './NoteAnswer';
import { notePlaceholder } from './note-answers';
import type { RichValue } from './RichSticker';
import { RichText } from './rich-text';

/**
 * Lexical comes in its own chunk, fetched as soon as the board is shown (`MaterialBoard`) – a box
 * drawn takes the caret at once.
 */
const RichStickerEditor = lazy(() => import('./RichSticker'));
import type { UploadingMaterial } from './useBoard';

/*
 * A file, link, note or frame on the board (the material page) as a React Flow node, and once picked the
 * editor's selection look – the line on its edge (`FrameOutline`), its corner brackets opening as
 * the pointer nears them; grabbed by React Flow's resize controls (`NodeResizeControl`). A note on
 * its own is a sticker (as „Text auf Folie“: its look, typed in right in its box); notes on one
 * thing stand as cards beside it, the thing marked as a comment's element on a slide; a frame is
 * an outline round its things, under them, grabbed by its label. Every text is typed again right
 * where it shows (a double click), one's own only; a picked one of one's own offers its colours.
 */

/**
 * Focused once it is there, without scrolling the deck to it (it is in view: written where seen).
 * React Flow shows a new node only once it has measured it: till then (a frame or two) a focus
 * does not take.
 */
const focusHere = (field: HTMLTextAreaElement | null) => {
  const attempt = (left: number) => {
    if (!field?.isConnected) return;
    field.focus({ preventScroll: true });
    if (document.activeElement !== field && left > 0)
      requestAnimationFrame(() => attempt(left - 1));
  };
  attempt(10);
};

const KIND_ICONS: Record<MaterialKind, IconName> = {
  pdf: 'description',
  document: 'article',
  presentation: 'slideshow',
  spreadsheet: 'gridView',
  image: 'image',
  text: 'notes',
  other: 'attachFile',
};

/** Smallest card a resize leaves; a sticker or frame as small as it may be drawn. */
const MIN_W = 80;
const MIN_H = 60;
const MIN_NOTE = 8;

/**
 * A card's edge: one even hairline over all it holds (a preview runs under it to the rounded
 * edge), the card's shadow on the card itself – never both on one element.
 */
const CARD =
  "relative overflow-hidden rounded-control bg-glass-solid shadow-mark after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-hairline-strong after:content-['']";

const GRIPS: { corner: RectCorner; position: ControlPosition }[] = [
  { corner: 'nw', position: 'top-left' },
  { corner: 'ne', position: 'top-right' },
  { corner: 'sw', position: 'bottom-left' },
  { corner: 'se', position: 'bottom-right' },
];
const ALL_CORNERS = GRIPS.map(({ corner }) => corner);

export const BoardNodeView = memo(function BoardNodeView({
  id,
  data,
  selected,
  width = data.item.w,
  height = data.item.h,
}: NodeProps<BoardNode>) {
  const board = useContext(BoardNodeContext)!;
  const zoom = useStore((state) => state.transform[2]);
  const item = data.item;
  const box = isBox(item) ? item : null;
  // A comment's box on a slide shows its corners under the pointer already, not only once picked.
  // Leaving is taken a moment late: on its way over the edge to a corner outside the box the
  // pointer leaves and comes back – the corners stay put instead of flickering.
  const [hovered, setHovered] = useState(false);
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enter = () => {
    if (leaving.current) clearTimeout(leaving.current);
    leaving.current = null;
    setHovered(true);
  };
  const leave = () => {
    if (leaving.current) clearTimeout(leaving.current);
    leaving.current = setTimeout(() => setHovered(false), 250);
  };
  useEffect(() => () => void (leaving.current && clearTimeout(leaving.current)), []);
  const lit = selected || (box !== null && hovered);
  const resizable =
    data.role !== 'notes' &&
    !isUploading(item) &&
    (box ? lit && board.mayMove : selected && board.resizable(id));
  const grips = useRef<Partial<Record<FrameHandle, HTMLSpanElement | null>>>({});
  const near = useNearHandles(resizable, Math.min(width, height) * zoom, grips);
  const mark = data.role === 'item' && !box ? board.markOf(item.id) : null;

  if (data.role === 'notes')
    return (
      <div className="flex w-60 flex-col gap-2" data-notes-of={item.id}>
        {data.notes.map((note) => (
          <Fragment key={note.id}>
            <NoteCard item={note} />
            <AnswerUnder item={note} className="ml-4" />
          </Fragment>
        ))}
      </div>
    );

  const color = box ? accentColor(noteColor(box)) : board.color;
  const target = box !== null && data.target === true;
  const min = box ? board.boxMin(box.id) : null;
  return (
    <div
      className="relative size-full"
      data-board-item={item.id}
      onPointerEnter={enter}
      onPointerLeave={leave}
      onContextMenu={box ? (event) => board.onContextMenu(box, event) : undefined}
    >
      {isMaterial(item) ? (
        <FileCard
          material={item}
          drawable={selected && board.canDraw}
          from={board.cameFrom(item)}
          tint={board.boxColorOf(item.id)}
        />
      ) : item.kind === 'folder' ? (
        <FolderCard folder={item} />
      ) : item.kind === 'link' ? (
        <LinkCard item={item} />
      ) : (
        <Sticker item={item} lit={lit || target} />
      )}
      {!isMaterial(item) && (item.kind === 'note' || item.kind === 'box') && (
        // Hanging under the note as a reply under a comment, at least as wide as a note's card.
        <AnswerUnder
          item={item}
          className="absolute top-full left-0 mt-2 w-[max(100%,15rem)] max-w-[max(100%,24rem)]"
        />
      )}
      {mark && (
        // Marked as a comment's element on a slide.
        <ShapeOutline
          shape={{ bbox: { x: 0, y: 0, w: 1, h: 1 }, rotation: 0, tilt: null }}
          variant="emphasis"
          color={accentColor(mark)}
        />
      )}
      {(box ? lit || target : selected) && board.editing !== item.id && (
        // As a comment's own box on a slide (`EditableFrame`): its line on its edge, the corners
        // opening as the pointer nears them, lit (a halo) under the pointer and when picked.
        <FrameOutline
          width={width}
          height={height}
          scale={zoom}
          color={color}
          corners={resizable ? ALL_CORNERS : []}
          near={near}
          dome={false}
          // Lit too while something dragged would join it: a drop target.
          halo={lit || target}
        />
      )}
      {selected && box && board.editing !== box.id && board.mayEdit(box) && (
        <ColorBar item={box} zoom={zoom} />
      )}
      {resizable &&
        GRIPS.map(({ corner, position }) => (
          <NodeResizeControl
            key={corner}
            position={position}
            // A box: never narrower than what it holds (reflowed as it is resized).
            minWidth={min ? Math.max(MIN_NOTE, min.minW) : MIN_W}
            minHeight={min ? MIN_NOTE : MIN_H}
            onResize={(_, frame) => board.onResize(id, frame)}
            onResizeEnd={(_, frame) => board.onResizeEnd(id, frame)}
          >
            <span
              ref={(grip) => {
                grips.current[corner] = grip;
              }}
              aria-hidden
              title="Größe ändern"
              className="absolute inset-0"
            />
          </NodeResizeControl>
        ))}
    </div>
  );
});

/**
 * A picked note's or frame's colours, in a small glass bar over it as the editor's format bar
 * (the comment colours, `ColorSwatches`) – as large on screen at any zoom.
 */
function ColorBar({ item, zoom }: { item: BoardItem; zoom: number }) {
  const board = useContext(BoardNodeContext)!;
  return (
    <div
      // Right over its text at the top left, what its colour is about.
      className="nodrag nopan glass-elevated pointer-events-auto absolute bottom-full left-0 mb-2 origin-bottom-left rounded-panel p-1"
      style={{ transform: `scale(${1 / zoom})` }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <ColorSwatches
        variant="dot"
        label="Farbe"
        value={(item.color ?? item.author.color) as AccentColor}
        onChange={(color) => board.setColor(item, color)}
        ringOffset="glass-solid"
      />
    </div>
  );
}

/**
 * A note on its own: a sticker, as a comment's text on a slide (`TextMark`): its surface and edge
 * (`textSurface`, `textShadow`), lifted under the pointer and when picked – its rich text typed
 * right in it (`RichStickerEditor`).
 */
function Sticker({ item, lit }: { item: BoardItem; lit: boolean }) {
  const board = useContext(BoardNodeContext)!;
  const color = noteColor(item);
  const typing = board.editing === item.id;
  return (
    <div
      data-sticker={item.id}
      className={cn(
        'pointer-events-auto size-full overflow-hidden rounded-[0.25em]',
        STICKER_TEXT,
        'whitespace-normal',
      )}
      style={{
        ...textSurface(color),
        // Its edge is the line of its brackets while lit, as a slide's sticker's.
        boxShadow: textShadow(color, false, lit || typing),
      }}
    >
      {typing ? (
        <Suspense
          fallback={
            <p className="whitespace-pre-wrap opacity-50">{item.text || notePlaceholder()}</p>
          }
        >
          <RichStickerEditor
            rich={item.rich}
            text={item.text}
            placeholder={notePlaceholder()}
            onDone={(value: RichValue) => board.onNoteDone(item, value)}
            onAsk={(value: RichValue) => board.onNoteAsk(item, value)}
            onCancel={() => board.onNoteCancel(item)}
          />
        </Suspense>
      ) : item.rich ? (
        <RichText rich={item.rich} />
      ) : (
        <p className="whitespace-pre-wrap">{item.text}</p>
      )}
    </div>
  );
}

/**
 * A file's card: its preview over its name bar. Picked (and notes may be drawn), a drag on the
 * preview draws a note on it (crosshair; `nodrag` keeps React Flow off it) and only the name bar
 * moves it – lit under the pointer as the grip; not picked, a drag anywhere on it moves it.
 */
function FileCard({
  material,
  drawable = false,
  from = null,
  tint = null,
}: {
  material: Material | UploadingMaterial;
  drawable?: boolean;
  /** The folder it came from: a small folder on it says so. */
  from?: string | null;
  /** The colour of the box it lies in: its icon takes it. */
  tint?: AuthorColor | null;
}) {
  const progress = 'progress' in material ? material.progress : null;
  const detail = [
    formatFileSize(material.sizeBytes),
    material.kind === 'spreadsheet' && material.sheets.length > 0
      ? `${material.sheets.length} ${material.sheets.length === 1 ? 'Blatt' : 'Blätter'}`
      : material.pages
        ? `${material.pages} ${material.kind === 'presentation' ? 'Folien' : 'Seiten'}`
        : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <div className={cn(CARD, 'flex h-full flex-col')}>
      <div
        data-file-preview={drawable ? material.id : undefined}
        className={cn(
          'relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface-2',
          drawable && 'nodrag cursor-crosshair',
        )}
      >
        {material.previewUrl ? (
          <img
            src={material.previewUrl}
            alt=""
            draggable={false}
            className={cn(
              'h-full w-full',
              material.kind === 'image' ? 'object-cover' : 'object-cover object-top',
            )}
          />
        ) : (
          <Icon name={KIND_ICONS[material.kind]} size={44} className="text-fg-subtle" />
        )}
        {progress === null && material.readState === 'pending' && (
          <span className="glass-dark absolute top-2 left-2 rounded-chip px-2 py-0.5 text-xs text-fg">
            wird gelesen …
          </span>
        )}
        {progress !== null && (
          <span className="absolute inset-x-3 bottom-3">
            <ProgressBar value={progress} label={`${material.name} wird hochgeladen`} />
          </span>
        )}
        {from !== null && (
          <span
            data-from-folder
            title={`Aus dem Ordner „${from}“`}
            className="glass-dark absolute top-2 right-2 flex size-6 items-center justify-center rounded-chip text-fg"
          >
            <Icon name="folder" size={14} />
          </span>
        )}
      </div>
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2',
          drawable && 'cursor-move transition-colors duration-150 hover:bg-hover',
        )}
      >
        <Icon
          name={KIND_ICONS[material.kind]}
          size={18}
          className={cn('shrink-0', !tint && 'text-fg-muted')}
          style={tint ? { color: accentColor(tint) } : undefined}
        />
        <div className="min-w-0">
          <div className="truncate text-body font-medium text-fg" title={material.name}>
            {material.name}
          </div>
          <div className="truncate text-caption text-fg-subtle">{detail}</div>
        </div>
      </div>
    </div>
  );
}

/** A file's small picture: its preview, else its kind's icon on a quiet tile. */
function FilePicture({ file }: { file: Material }) {
  return file.previewUrl ? (
    <img
      src={file.previewUrl}
      alt=""
      draggable={false}
      className="size-full object-cover object-top"
    />
  ) : (
    <span className="flex size-full items-center justify-center bg-surface-2">
      <Icon name={KIND_ICONS[file.kind]} size={28} className="text-fg-subtle" />
    </span>
  );
}

/** How a peeking file lies behind a folder's front: fanned, the middle one highest. */
const PEEK = [
  { x: -30, y: 18, turn: -8 },
  { x: 0, y: 6, turn: 0 },
  { x: 30, y: 18, turn: 8 },
];

/**
 * A folder: a frosted glass folder with its name and how many files, its first three files peeking
 * out of it as a fan (sliding out a little on hover) – each can be pulled out onto the board. A
 * click opens it: all its files laid out under it, each to be pulled out. While its files are on
 * their way, one bar: how many of how many, and the bytes.
 */
function FolderCard({ folder }: { folder: BoardItem }) {
  const board = useContext(BoardNodeContext)!;
  // In name order, as a file manager shows them (numbers as numbers).
  const files = folder.boundIds
    .flatMap((id) => {
      const file = board.fileById.get(id);
      return file ? [file] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  const upload = board.folderUpload(folder.id);
  const open = board.openFolder === folder.id;
  const pull = (file: Material) => (event: ReactPointerEvent<HTMLElement>) =>
    board.takeOut(file, folder, event);
  return (
    <div data-folder={folder.id} className="group relative size-full hover:[--peek:-14px]">
      {/* Its first files, behind its front. */}
      {files.slice(0, 3).map((file, index) => {
        const at = PEEK[files.length === 1 ? 1 : index]!;
        return (
          <div
            key={file.id}
            data-folder-peek={file.id}
            title={`„${file.name}“ herausziehen`}
            onPointerDown={pull(file)}
            className="nodrag absolute top-[4%] left-1/2 h-[62%] w-[56%] cursor-grab overflow-hidden rounded-chip bg-glass-solid shadow-mark transition-transform duration-200 ease-out after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-hairline-strong after:content-['']"
            style={{
              transform: `translateX(calc(-50% + ${at.x}px)) translateY(calc(${at.y}px + var(--peek, 0px) * ${1 + index * 0.25})) rotate(${at.turn}deg)`,
            }}
          >
            <FilePicture file={file} />
          </div>
        );
      })}
      {/* Its back's tab and its glass front. */}
      <span
        aria-hidden
        className="absolute top-[30%] left-0 h-6 w-[38%] rounded-t-control bg-glass-control ring-hairline backdrop-blur-xl"
      />
      <div className="glass absolute inset-x-0 top-[38%] bottom-0 flex flex-col justify-end gap-1 rounded-panel p-3 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-2">
          <Icon name="folder" size={18} className="shrink-0 text-fg-muted" />
          <span className="min-w-0 truncate text-body font-medium text-fg" title={folder.text}>
            {folder.text}
          </span>
        </div>
        <span className="text-caption text-fg-subtle">
          Ordner, {files.length} {files.length === 1 ? 'Datei' : 'Dateien'}
        </span>
        {upload && upload.done + upload.failed.length < upload.total && (
          <span data-folder-progress className="flex flex-col gap-1">
            <ProgressBar
              value={upload.bytesTotal > 0 ? upload.bytesSent / upload.bytesTotal : 0}
              label={`${folder.text} wird hochgeladen`}
            />
            <span className="text-caption text-fg-subtle tabular-nums">
              {upload.done} von {upload.total} Dateien, {formatFileSize(upload.bytesSent)} von{' '}
              {formatFileSize(upload.bytesTotal)}
            </span>
          </span>
        )}
        {upload && upload.failed.length > 0 && (
          <span className="truncate text-caption text-danger" title={upload.failed.join('\n')}>
            Nicht abgelegt: {upload.failed.join(', ')}
          </span>
        )}
      </div>
      {open && (
        // Opened: all its files under it, in its glass, each to be pulled out.
        <div
          data-folder-open={folder.id}
          className="nodrag nowheel glass-elevated absolute top-full left-1/2 mt-3 grid max-h-80 w-max -translate-x-1/2 grid-cols-4 gap-2 overflow-y-auto overscroll-contain rounded-panel p-3 transition-[opacity,translate] duration-300 ease-emphasized starting:-translate-y-2 starting:opacity-0"
        >
          {files.map((file) => (
            <div
              key={file.id}
              data-folder-file={file.id}
              title={`„${file.name}“ herausziehen`}
              onPointerDown={pull(file)}
              className="flex w-28 cursor-grab flex-col gap-1"
            >
              <span className="relative h-20 overflow-hidden rounded-chip bg-glass-solid after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:ring-hairline-strong after:content-['']">
                <FilePicture file={file} />
              </span>
              <span className="truncate text-caption text-fg-muted">{file.name}</span>
            </div>
          ))}
          {files.length === 0 && (
            <span className="col-span-4 text-caption text-fg-subtle">Keine Dateien darin</span>
          )}
        </div>
      )}
    </div>
  );
}

function LinkCard({ item }: { item: BoardItem }) {
  let host = item.url ?? '';
  try {
    host = new URL(item.url ?? '').host;
  } catch {
    // Shown as it is.
  }
  return (
    <div className={cn(CARD, 'flex h-full items-center gap-3 px-3')}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-chip bg-surface-3 text-fg-muted">
        <Icon name="link" size={20} />
      </span>
      <div className="min-w-0">
        <div className="truncate text-body font-medium text-fg">{item.text || host}</div>
        <div className="truncate text-caption text-fg-subtle" title={item.url ?? undefined}>
          {item.url}
        </div>
      </div>
    </div>
  );
}

/**
 * A note beside its thing, as a comment card is: its author's avatar and name over the text, on a
 * quiet surface tinted with its colour and edged with it. A click picks it (its panel), a double
 * click types its text again right here, its right click offers Bearbeiten and Löschen.
 */
function NoteCard({ item }: { item: BoardItem }) {
  const board = useContext(BoardNodeContext)!;
  const color = noteColor(item);
  const accent = accentColor(color);
  const picked = board.isPicked(item.id);
  return (
    <article
      data-note-card={item.id}
      className={cn(
        // Its column node takes no pointer of its own (neither picked nor dragged): the card does.
        'nodrag pointer-events-auto relative flex cursor-pointer flex-col gap-1.5 rounded-control p-3',
        picked && 'outline-2 outline-offset-2 outline-(--selection)',
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${accent} 8%, var(--color-glass-solid))`,
        boxShadow: `inset 0 0 0 1px ${accentAlpha(color, 45)}, var(--shadow-mark)`,
      }}
      onClick={(event) => {
        event.stopPropagation();
        board.pick(item.id, event.shiftKey || event.metaKey || event.ctrlKey);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        board.edit(item);
      }}
      onContextMenu={(event) => board.onContextMenu(item, event)}
    >
      <header className="flex min-w-0 shrink-0 items-center gap-1.5">
        <Avatar author={item.author} size={20} />
        <span
          title={item.author.name}
          className="min-w-0 truncate text-caption font-medium text-fg"
        >
          {item.author.name}
        </span>
        <time
          dateTime={item.createdAt}
          title={formatDateTime(item.createdAt)}
          className="ml-auto shrink-0 text-caption text-fg-subtle"
        >
          {formatRelativeTime(item.createdAt)}
        </time>
      </header>
      {board.editing === item.id ? (
        <TextEditor
          initial={item.text}
          rows={2}
          className="field-sizing-content min-h-5 w-full text-body leading-4.5 text-fg"
          onDone={(text) => board.onNoteDone(item, { text, plain: text, rich: null })}
          onAsk={(text) => board.onNoteAsk(item, { text, plain: text, rich: null })}
          onCancel={() => board.onNoteCancel(item)}
        />
      ) : (
        <p className="text-body leading-4.5 break-words whitespace-pre-wrap text-fg">{item.text}</p>
      )}
      {picked && board.editing !== item.id && board.mayEdit(item) && <CardColors item={item} />}
    </article>
  );
}

/** The AI's answer under a note, once asked (⌘↵). */
function AnswerUnder({ item, className }: { item: BoardItem; className?: string }) {
  const board = useContext(BoardNodeContext)!;
  const answer = board.answerOf(item.id);
  if (!answer) return null;
  return <NoteAnswer answer={answer} actions={board.answers} className={className} />;
}

/** A picked card's colours, under it. */
function CardColors({ item }: { item: BoardItem }) {
  const board = useContext(BoardNodeContext)!;
  return (
    <div
      className="glass-elevated absolute top-full right-0 z-(--z-raised) mt-2 rounded-panel p-1"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <ColorSwatches
        variant="dot"
        label="Farbe"
        value={(item.color ?? item.author.color) as AccentColor}
        onChange={(color) => board.setColor(item, color)}
        ringOffset="glass-solid"
      />
    </div>
  );
}

/**
 * Typing a note's or frame's text right where it shows, as in a sticker on a slide: ↵ takes it, ⇧↵
 * a new line, ⌘↵ takes it and asks the AI (`onAsk`), Esc drops it; left with text (a click
 * elsewhere) it is taken too, left empty it goes (a new one at once, one's own after asking).
 */
function TextEditor({
  initial,
  className,
  rows,
  onDone,
  onAsk,
  onCancel,
}: {
  initial: string;
  className: string;
  rows?: number;
  onDone: (text: string) => void;
  onAsk?: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ended = useRef(false);
  const end = (how: 'done' | 'ask' | 'cancel') => {
    if (ended.current) return;
    ended.current = true;
    if (how === 'cancel' || (!text.trim() && !initial)) onCancel();
    else if (how === 'ask' && onAsk) onAsk(text.trim());
    else onDone(text.trim());
  };
  return (
    <textarea
      ref={focusHere}
      value={text}
      aria-label="Notiz"
      aria-keyshortcuts={onAsk ? 'Meta+Enter' : undefined}
      placeholder={notePlaceholder()}
      spellCheck
      rows={rows}
      // Typed in, not dragged, panned or scrolled by the board.
      className={cn(
        'nodrag nopan nowheel block resize-none bg-transparent outline-none',
        className,
      )}
      style={{ caretColor: 'currentColor' }}
      onChange={(event) => setText(event.target.value)}
      onFocus={(event) => event.currentTarget.setSelectionRange(text.length, text.length)}
      onBlur={() => end('done')}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          end('cancel');
        } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          end(event.metaKey || event.ctrlKey ? 'ask' : 'done');
        }
      }}
    />
  );
}
