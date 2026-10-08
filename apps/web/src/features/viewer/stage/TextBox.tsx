import type { AccentColor, TextStroke } from '@slider/shared';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { accentAlpha, accentColor } from '@/lib/accent';
import { cn, Icon } from '@/ui';
import { MIN_TEXT_WIDTH, normalizeTextRect } from '../lib/text-box';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, type TextBoxDraft } from '../state/viewer-state';

/**
 * "Text auf Folie": text written on the slide. Sizes are in container units of the slide box
 * (the parent sets `container-type: size`), so position, width and font size scale with the slide.
 * Editor and stored text share one box style – the text wraps the same way in both.
 */
const TEXT_CLASS =
  'whitespace-pre-wrap [overflow-wrap:anywhere] px-[0.35em] py-[0.15em] text-left leading-[1.25] font-semibold';

/**
 * Dark like the rest of the app, readable on light and dark slides. The text is the author's
 * accent lifted towards white – pure blue or red alone is too dark on the dark backdrop.
 */
const textSurface = (color: AccentColor): CSSProperties => ({
  color: `color-mix(in srgb, ${accentColor(color)} 75%, white)`,
  backgroundColor: 'color-mix(in srgb, var(--color-glass-solid) 75%, transparent)',
});

const boxPosition = (x: number, y: number, fontSize: number): CSSProperties => ({
  left: `${x * 100}%`,
  top: `${y * 100}%`,
  fontSize: `calc(${fontSize} * 100cqh)`,
});

interface TextMarkProps {
  stroke: TextStroke;
  label: string;
  opacity: number;
  emphasized: boolean;
  interactive: boolean;
  onActivate: () => void;
  onHover: (hovering: boolean) => void;
}

/** A sent text annotation – also the comment's click target; its connector line leaves the box. */
export function TextMark({
  stroke,
  label,
  opacity,
  emphasized,
  interactive,
  onActivate,
  onHover,
}: TextMarkProps) {
  return (
    <button
      type="button"
      // Connector lines pass behind the box.
      data-mark="frame"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className={cn(
        TEXT_CLASS,
        'absolute rounded-[0.25em] outline-offset-2 transition-[opacity,box-shadow] duration-200',
        interactive ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none',
        emphasized && 'z-10',
      )}
      style={{
        ...boxPosition(stroke.x, stroke.y, stroke.fontSize),
        ...textSurface(stroke.color),
        width: `${stroke.w * 100}%`,
        minHeight: `${stroke.h * 100}%`,
        opacity,
        boxShadow: emphasized
          ? `0 0 0 2px ${accentColor(stroke.color)}, 0 2px 10px rgb(0 0 0 / 0.35)`
          : `0 0 0 1px ${accentAlpha(stroke.color, 55)}, 0 1px 4px rgb(0 0 0 / 0.25)`,
      }}
    >
      {stroke.text}
    </button>
  );
}

const PLACEHOLDER = 'Text eingeben…';

interface TextBoxEditorProps {
  box: TextBoxDraft;
}

type Drag =
  { kind: 'move'; pointerX: number; pointerY: number; x: number; y: number } | { kind: 'resize' };

/**
 * The draft's text box, typed into directly on the slide. It grows with its text (to the slide's
 * right edge, then it wraps), moves by its edge or name tag and resizes by its corner handle.
 * ↵ = new line, ⌘↵ / Ctrl↵ sends (through the composer), Esc cancels (global shortcut).
 */
export function TextBoxEditor({ box }: TextBoxEditorProps) {
  const dispatch = useViewerDispatch();
  const { author } = useViewerData().viewer;
  const layerRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const color = accentColor(author.color);

  // Focus on opening and whenever the box is placed somewhere else.
  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, [box.x, box.y]);

  // Report the rendered box (normalised) – it is the anchor and what gets stored.
  useLayoutEffect(() => {
    const element = boxRef.current;
    const layer = layerRef.current;
    if (!element || !layer) return;
    const measure = () => {
      const slide = layer.getBoundingClientRect();
      if (slide.width === 0 || slide.height === 0) return;
      dispatch({
        type: 'textBoxMeasured',
        rect: normalizeTextRect({
          x: box.x,
          y: box.y,
          // +1px: the stored width must not wrap a line the editor kept on one.
          w: (element.offsetWidth + 1) / slide.width,
          h: element.offsetHeight / slide.height,
        }),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [dispatch, box.x, box.y]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>, kind: Drag['kind']) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current =
      kind === 'move'
        ? { kind, pointerX: event.clientX, pointerY: event.clientY, x: box.x, y: box.y }
        : { kind };
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
      dispatch({
        type: 'textBoxChanged',
        patch: {
          x: Math.min(Math.max(0, x), Math.max(0, 1 - w)),
          y: Math.min(Math.max(0, y), Math.max(0, 1 - h)),
        },
      });
      return;
    }
    const right = (event.clientX - slide.left) / slide.width;
    const bottom = (event.clientY - slide.top) / slide.height;
    dispatch({
      type: 'textBoxChanged',
      patch: {
        width: Math.min(1 - box.x, Math.max(MIN_TEXT_WIDTH, right - box.x)),
        minHeight: Math.min(1 - box.y, Math.max(0, bottom - box.y)),
      },
    });
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
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-30 [container-type:size]">
      <div
        ref={boxRef}
        data-text-editor
        className="pointer-events-auto absolute animate-pop-in rounded-[0.25em]"
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
        {/* Sizes the box: same text and style as the textarea on top of it. */}
        <div aria-hidden className={cn(TEXT_CLASS, 'invisible')}>
          {box.text || PLACEHOLDER}
          {'​'}
        </div>
        <textarea
          ref={textareaRef}
          aria-label="Text auf der Folie"
          placeholder={PLACEHOLDER}
          value={box.text}
          maxLength={2000}
          rows={1}
          cols={1}
          spellCheck
          onChange={(event) =>
            dispatch({ type: 'textBoxChanged', patch: { text: event.target.value } })
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              document.querySelector<HTMLFormElement>('form[data-composer]')?.requestSubmit();
            }
            // Tab jumps to the composer's comment field (Shift+Tab there comes back).
            if (event.key === 'Tab' && !event.shiftKey) {
              const comment = document.querySelector<HTMLTextAreaElement>(
                'form[data-composer] textarea[aria-label="Kommentar"]',
              );
              if (!comment) return;
              event.preventDefault();
              comment.focus();
            }
          }}
          className={cn(
            TEXT_CLASS,
            'absolute inset-0 size-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-current placeholder:opacity-45',
          )}
        />

        {/* Name tag – also the move handle. */}
        <span
          role="presentation"
          title="Textfeld verschieben"
          onPointerDown={(event) => startDrag(event, 'move')}
          {...dragHandlers}
          className="absolute -top-6 left-[-2px] flex cursor-move touch-none items-center gap-0.5 rounded-t-thumb rounded-br-thumb py-0.5 pr-1.5 pl-1 text-[11px] leading-4 font-medium whitespace-nowrap text-white select-none"
          style={{ backgroundColor: color }}
        >
          <Icon name="moreHoriz" size={12} className="rotate-90" />
          {author.name.split(' ')[0]}
        </span>
        {/* Resize handle. */}
        <span
          role="presentation"
          title="Größe ändern"
          onPointerDown={(event) => startDrag(event, 'resize')}
          {...dragHandlers}
          className="absolute -right-1.5 -bottom-1.5 size-3 cursor-nwse-resize touch-none rounded-[2px] bg-white"
          style={{ boxShadow: `0 0 0 1.5px ${color}` }}
        />
      </div>
    </div>
  );
}
