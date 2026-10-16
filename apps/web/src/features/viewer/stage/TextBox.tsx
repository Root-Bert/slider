import type { AuthorColor, Rect, TextStroke } from '@slider/shared';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { accentAlpha, accentColor } from '@/lib/accent';
import { cn, Icon } from '@/ui';
import { FRAME_ATTR, resized, useRectEdit, type RectCorner } from './hooks/useRectEdit';
import { focusCommentField } from '../comments/lib/composer-focus';
import {
  MIN_TEXT_WIDTH,
  normalizeTextRect,
  TEXT_BOX_LOOK,
  TEXT_BOX_RADIUS,
  TEXT_CLASS,
} from './lib/text-box';
import { HANDLE_CLASS, handleRing, NAME_TAG_CLASS } from './lib/mark-chrome';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, type TextBoxDraft, type TextBoxPatch } from '../state/viewer-state';
import { CORNERS } from './corners';
import { isModEnter, isModKey } from '@/lib/keyboard';

/*
 * "Text auf Folie": text written on the slide. Sizes are in container units of the slide box
 * (the parent sets `container-type: size`), so position, width and font size scale with the slide.
 * Editor and stored text share one box style (`TEXT_CLASS`, `TEXT_BOX_LOOK`) – the text wraps the
 * same way in both, centred horizontally and vertically in the box – and the sketch canvas draws
 * it from the same numbers.
 */

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * Dark like the rest of the app, readable on light and dark slides. The text is the author's
 * accent lifted towards white – pure blue or red alone is too dark on the dark backdrop.
 */
const textSurface = (color: AuthorColor): CSSProperties => ({
  color: `color-mix(in srgb, ${accentColor(color)} ${percent(TEXT_BOX_LOOK.textLift)}, white)`,
  backgroundColor: `color-mix(in srgb, var(--color-glass-solid) ${percent(TEXT_BOX_LOOK.fillAlpha)}, transparent)`,
});

/** Lifted off the slide while emphasised or dragged; a soft edge and shadow at rest. */
const textShadow = (color: AuthorColor, lit: boolean): string =>
  lit
    ? `0 0 0 2px ${accentColor(color)}, var(--shadow-mark)`
    : `0 0 0 1px ${accentAlpha(color, Math.round(TEXT_BOX_LOOK.edgeAlpha * 100))}, 0 1px 4px var(--color-well-dark)`;

const boxPosition = (x: number, y: number, fontSize: number): CSSProperties => ({
  left: `${x * 100}%`,
  top: `${y * 100}%`,
  fontSize: `calc(${fontSize} * 100cqh)`,
});

interface TextMarkProps {
  /** In the comment author's colour, which may be PowerPoint orange. */
  stroke: Omit<TextStroke, 'color'> & { color: AuthorColor };
  label: string;
  opacity: number;
  emphasized: boolean;
  interactive: boolean;
  onActivate: () => void;
  /**
   * Own text: dragging the box moves it, its corner handle resizes it. Called with the new box
   * (normalised, as rendered) when the drag ends; `done` once it is stored (or failed).
   */
  onPlace?: (rect: Rect, done: () => void) => void;
  /** The box as shown while dragged, `null` once it is back in place (see `useRectEdit`). */
  onPreview?: (rect: Rect | null) => void;
  /** A double click on the box (the Bild sheet: edit the text). */
  onDoubleClick?: () => void;
}

/** Smallest text box a resize leaves. */
const MIN_TEXT_SIZE = { w: MIN_TEXT_WIDTH, h: 0 };

/** A sent text annotation – also the comment's click target; its connector line leaves the box. */
export function TextMark({
  stroke,
  label,
  opacity,
  emphasized,
  interactive,
  onActivate,
  onPlace,
  onPreview,
  onDoubleClick,
}: TextMarkProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const editable = interactive && onPlace !== undefined;
  // Moves and resizes like every other box on the slide; stored is the box as rendered.
  const edit = useRectEdit(
    { x: stroke.x, y: stroke.y, w: stroke.w, h: stroke.h },
    (placed, done) => {
      const element = ref.current;
      const slide = element?.offsetParent?.getBoundingClientRect();
      if (!element || !slide || slide.width <= 0 || slide.height <= 0 || !onPlace) return done();
      onPlace(
        normalizeTextRect({
          x: placed.x,
          y: placed.y,
          // +1px, like the editor: the stored width must not wrap a line the box kept on one.
          w: (element.offsetWidth + 1) / slide.width,
          h: element.offsetHeight / slide.height,
        }),
        done,
      );
    },
    { onPreview, minSize: MIN_TEXT_SIZE },
  );
  const box = edit.rect;
  const preview = edit.dragging;

  return (
    <button
      ref={ref}
      type="button"
      {...{ [FRAME_ATTR]: '' }}
      // Connector lines pass behind the box.
      data-mark="frame"
      aria-label={label}
      title={editable ? `${label} – ziehen zum Verschieben` : label}
      onClick={(event) => {
        event.stopPropagation();
        // A drag is no click: the thread doesn't open.
        if (!edit.wasDragged()) onActivate();
      }}
      onDoubleClick={
        onDoubleClick &&
        ((event) => {
          event.stopPropagation();
          onDoubleClick();
        })
      }
      {...(editable ? edit.boxProps : {})}
      className={cn(
        TEXT_CLASS,
        TEXT_BOX_RADIUS,
        'absolute flex flex-col justify-center outline-offset-2 transition-[opacity,box-shadow] duration-200',
        interactive ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none',
        editable && 'cursor-move touch-none',
        (emphasized || preview) && 'z-(--z-raised)',
      )}
      style={{
        ...boxPosition(box.x, box.y, stroke.fontSize),
        ...textSurface(stroke.color),
        width: `${box.w * 100}%`,
        minHeight: `${box.h * 100}%`,
        opacity,
        boxShadow: textShadow(stroke.color, emphasized || preview),
      }}
    >
      {stroke.text}
      {editable &&
        (emphasized || preview) &&
        // Resize handles on all four corners, like every other box.
        CORNERS.map(({ corner, className: position }) => (
          <span
            key={corner}
            role="presentation"
            title="Größe ändern"
            {...edit.cornerProps(corner)}
            className={cn(HANDLE_CLASS, position)}
            style={{ boxShadow: handleRing(accentColor(stroke.color)) }}
          />
        ))}
    </button>
  );
}

interface TextBoxEditorProps {
  box: TextBoxDraft;
}

/** The draft's text box on the slide: `TextBoxField` wired to the viewer state. */
export function TextBoxEditor({ box }: TextBoxEditorProps) {
  const dispatch = useViewerDispatch();
  const { author } = useViewerData().viewer;
  return (
    <TextBoxField
      box={box}
      author={author}
      onChange={(patch) => dispatch({ type: 'textBoxChanged', patch })}
      onMeasured={(rect) => dispatch({ type: 'textBoxMeasured', rect })}
      onLeave={focusCommentField}
    />
  );
}

interface TextBoxFieldProps {
  box: TextBoxDraft;
  /** Whose box: its colour and the first name on the tag. */
  author: { name: string; color: AuthorColor };
  onChange: (patch: TextBoxPatch) => void;
  /** The box as rendered (normalised) – what gets stored. */
  onMeasured: (rect: Rect) => void;
  /** ↵ / Tab: on to what comes next; `true` if it took the key. */
  onLeave: () => boolean;
  /** Esc, when the field handles it itself (the slide cancels the draft globally). */
  onEscape?: () => void;
}

type Drag =
  | { kind: 'move'; pointerX: number; pointerY: number; x: number; y: number }
  | { kind: RectCorner; start: Rect };

/**
 * A text box typed into directly on the slide (or the Bild sheet). It grows with its text (to the
 * right edge, then it wraps), moves by its edge or name tag and resizes by its corner handles.
 * ↵ / Tab = on to the comment (`onLeave`), ⇧↵ = new line, ⌘↵ / Ctrl↵ sends (through the
 * composer), Esc cancels (global shortcut, or `onEscape`).
 */
export function TextBoxField({
  box,
  author,
  onChange,
  onMeasured,
  onLeave,
  onEscape,
}: TextBoxFieldProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const color = accentColor(author.color);
  const measured = useEffectEvent(onMeasured);

  // Focus on opening and whenever the box is placed somewhere else – after the text, which may
  // already hold the first typed key.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [box.x, box.y]);

  // Report the rendered box (normalised) – it is the anchor and what gets stored.
  useLayoutEffect(() => {
    const element = boxRef.current;
    const layer = layerRef.current;
    if (!element || !layer) return;
    const measure = () => {
      const slide = layer.getBoundingClientRect();
      if (slide.width === 0 || slide.height === 0) return;
      measured(
        normalizeTextRect({
          x: box.x,
          y: box.y,
          // +1px: the stored width must not wrap a line the editor kept on one.
          w: (element.offsetWidth + 1) / slide.width,
          h: element.offsetHeight / slide.height,
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // Also right after every change of text or size: the observer reports a frame later, and
    // finishing the text right after typing must store the box as it is now.
  }, [box.x, box.y, box.text, box.width, box.minHeight]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>, kind: Drag['kind']) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    if (kind === 'move') {
      dragRef.current = {
        kind,
        pointerX: event.clientX,
        pointerY: event.clientY,
        x: box.x,
        y: box.y,
      };
      return;
    }
    // Resizing starts from the box as rendered – it may have grown with its text.
    const slide = layerRef.current?.getBoundingClientRect();
    const element = boxRef.current;
    if (!slide || !element || slide.width === 0 || slide.height === 0) return;
    dragRef.current = {
      kind,
      start: {
        x: box.x,
        y: box.y,
        w: element.offsetWidth / slide.width,
        h: element.offsetHeight / slide.height,
      },
    };
  };

  const onDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const slide = layerRef.current?.getBoundingClientRect();
    const element = boxRef.current;
    if (!drag || !slide || !element || slide.width === 0 || slide.height === 0) return;
    const w = element.offsetWidth / slide.width;
    const h = element.offsetHeight / slide.height;
    if (drag.kind === 'move') {
      const x = drag.x + (event.clientX - drag.pointerX) / slide.width;
      const y = drag.y + (event.clientY - drag.pointerY) / slide.height;
      onChange({
        x: Math.min(Math.max(0, x), Math.max(0, 1 - w)),
        y: Math.min(Math.max(0, y), Math.max(0, 1 - h)),
      });
      return;
    }
    const next = resized(
      drag.start,
      drag.kind,
      (event.clientX - slide.left) / slide.width,
      (event.clientY - slide.top) / slide.height,
      MIN_TEXT_SIZE,
    );
    onChange({ x: next.x, y: next.y, width: next.w, minHeight: next.h });
  };

  const endDrag = () => {
    dragRef.current = null;
    textareaRef.current?.focus({ preventScroll: true });
  };

  const dragHandlers = {
    onPointerMove: onDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
  };

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0 z-(--z-chrome) [container-type:size]"
    >
      <div
        ref={boxRef}
        data-text-editor
        className={cn(
          'pointer-events-auto absolute flex animate-pop-in flex-col justify-center',
          TEXT_BOX_RADIUS,
        )}
        style={{
          ...boxPosition(box.x, box.y, box.fontSize),
          ...textSurface(author.color),
          width: box.width === null ? 'max-content' : `${box.width * 100}%`,
          maxWidth: `${(1 - box.x) * 100}%`,
          minWidth: `min(${MIN_TEXT_WIDTH * 100}cqw, ${(1 - box.x) * 100}%)`,
          minHeight: `${box.minHeight * 100}%`,
          boxShadow: `0 0 0 2px ${color}, 0 0 0 5px ${accentAlpha(author.color, 25)}`,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        {/* Move frame: the box's edge (and the ring around it) drags it, the inside is for typing. */}
        <span
          role="presentation"
          title="Textfeld verschieben"
          onPointerDown={(event) => startDrag(event, 'move')}
          {...dragHandlers}
          className="absolute -inset-1.5 cursor-move touch-none rounded-[0.4em]"
        />
        {/* The inside: a press next to the text keeps typing in it. */}
        <span
          role="presentation"
          onPointerDown={(event) => {
            event.preventDefault();
            textareaRef.current?.focus({ preventScroll: true });
          }}
          className="absolute inset-0 cursor-text"
        />
        {/* The text, centred in the box: the hidden copy sizes it, the textarea lies on top. */}
        <div className="relative">
          <div aria-hidden className={cn(TEXT_CLASS, 'invisible')}>
            {box.text}
            {'​'}
          </div>
          <textarea
            ref={textareaRef}
            aria-label="Text auf der Folie"
            value={box.text}
            maxLength={2000}
            rows={1}
            cols={1}
            spellCheck
            onChange={(event) => onChange({ text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && onEscape) {
                event.preventDefault();
                event.stopPropagation();
                onEscape();
                return;
              }
              if (isModEnter(event)) {
                event.preventDefault();
                document.querySelector<HTMLFormElement>('form[data-composer]')?.requestSubmit();
              }
              // ↵ and Tab jump to the composer's comment field (Shift+Tab there comes back);
              // ⇧↵ is a new line.
              const toComment =
                (event.key === 'Tab' || event.key === 'Enter') &&
                !event.shiftKey &&
                !isModKey(event) &&
                !event.nativeEvent.isComposing;
              if (toComment && onLeave()) event.preventDefault();
            }}
            className={cn(
              TEXT_CLASS,
              'absolute inset-0 size-full resize-none overflow-hidden bg-transparent outline-none',
            )}
          />
        </div>

        {/* Name tag – also the move handle. */}
        <span
          role="presentation"
          title="Textfeld verschieben"
          onPointerDown={(event) => startDrag(event, 'move')}
          {...dragHandlers}
          className={cn(
            NAME_TAG_CLASS,
            'flex cursor-move touch-none items-center gap-0.5 pr-1.5 pl-1 select-none',
          )}
          style={{ backgroundColor: color }}
        >
          <Icon name="moreHoriz" size="xs" className="rotate-90" />
          {author.name.split(' ')[0]}
        </span>
        {/* Resize handles on all four corners, like every other box. */}
        {CORNERS.map(({ corner, className: position }) => (
          <span
            key={corner}
            role="presentation"
            title="Größe ändern"
            onPointerDown={(event) => startDrag(event, corner)}
            {...dragHandlers}
            className={cn(HANDLE_CLASS, position)}
            style={{ boxShadow: handleRing(color) }}
          />
        ))}
      </div>
    </div>
  );
}
