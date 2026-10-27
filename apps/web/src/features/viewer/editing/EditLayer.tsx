import { clamp01, type EditableElement, type Rect } from '@slider/shared';
import { cn, Spinner } from '@/ui';
import { EditableFrame } from '../stage/EditableFrame';
import { useEditing } from './editing-context';
import { InlineTextEditor } from './live/InlineTextEditor';
import { liveLayerStyle, PT_PER_CM } from './live/css';
import { LiveElementView } from './live/render';
import { elementLabel } from './lib/element-label';

const area = (element: EditableElement) => element.bbox.w * element.bbox.h;

/** The part of an element's box on the slide – elements may reach beyond it. */
function onSlide({ x, y, w, h }: Rect): Rect {
  const left = clamp01(x);
  const top = clamp01(y);
  return {
    x: left,
    y: top,
    w: Math.max(0, clamp01(x + w) - left),
    h: Math.max(0, clamp01(y + h) - top),
  };
}

/**
 * The elements of one slide while editing (BER-181): each one outlined on hover. A click into a
 * text puts the cursor there, to type on the slide (the live editor) – once the slide's picture
 * without that text is there, asked for when the pointer comes over it; its border moves it,
 * its corners resize it. Anything else a click picks, to move by dragging and resize by its
 * corners. A click on the free slide lets go.
 */
export function EditLayer({ slideId, color }: { slideId: string; color: string }) {
  const editing = useEditing();
  if (!editing.active) return null;
  const elements = [...editing.elementsOf(slideId)]
    .filter((element) => element.bbox.w > 0 && element.bbox.h > 0)
    // Small ones on top, so they can be picked inside large ones.
    .sort((a, b) => area(b) - area(a));
  const picked = editing.selection?.slideId === slideId ? editing.selectedElement : null;
  /** Where an element is shown: a box growing with its text as high as it is drawn live. */
  const boxOf = (element: EditableElement): Rect => {
    const height = element.live?.autoGrow ? editing.heightOf(element.id) : null;
    return onSlide(height === null ? element.bbox : { ...element.bbox, h: height });
  };

  const commit = (element: EditableElement, rect: Rect, done: () => void) => {
    // Groups only move: their size stays.
    const box = element.resizable ? rect : { ...rect, w: element.bbox.w, h: element.bbox.h };
    void editing.apply([{ type: 'setBox', elementId: element.id, box }]).finally(done);
  };

  return (
    <div
      data-edit-layer={slideId}
      className="absolute inset-0 z-(--z-raised) cursor-default"
      style={liveLayerStyle(editing.pageSize.width * PT_PER_CM)}
      onClick={(event) => {
        event.stopPropagation();
        editing.select(null);
      }}
    >
      {elements.map((element) => {
        const rect = boxOf(element);
        const select = () => editing.select({ slideId, elementId: element.id });
        const typeOnSlide = element.live !== null;
        const typeAt = (event: { clientX: number; clientY: number }) =>
          editing.startText(
            { slideId, elementId: element.id },
            { x: event.clientX, y: event.clientY },
          );
        const onDoubleClick = typeOnSlide ? typeAt : select;
        const typing = typeOnSlide && editing.textEditing === element.id;
        const frameProps = {
          rect,
          color,
          handles: element.resizable,
          elementEdge: true,
          emphasized: true,
          onCommit: (next: Rect, done: () => void) => commit(element, next, done),
          onPreview: (next: Rect | null) =>
            editing.setPreview(next && { elementId: element.id, rect: next }),
        };
        if (typing && element.live) {
          const ready =
            editing.backgroundOf(element.id) !== null || editing.cutoutOf(element.id) !== null;
          return (
            <div
              key={element.id}
              style={{ display: 'contents' }}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
            >
              {ready && (
                <LiveElementView
                  element={element}
                  live={element.live}
                  textOnly
                  style={{
                    zIndex: 1,
                    pointerEvents: 'auto',
                    ...(element.movable ? {} : { outline: `2px solid ${color}`, outlineOffset: 2 }),
                  }}
                >
                  <InlineTextEditor elementId={element.id} live={element.live} />
                </LiveElementView>
              )}
              {/* Moved by its border and resized by its corners while typing in it. */}
              {element.movable && <EditableFrame {...frameProps} edgesOnly />}
              {/* Typing starts once the picture without this text is drawn. */}
              {!ready && (
                <span
                  className="pointer-events-none absolute flex items-center justify-center"
                  style={{
                    left: `${rect.x * 100}%`,
                    top: `${rect.y * 100}%`,
                    width: `${rect.w * 100}%`,
                    height: `${rect.h * 100}%`,
                  }}
                >
                  <Spinner size="sm" label="Text wird vorbereitet" />
                </span>
              )}
            </div>
          );
        }
        if (picked?.id === element.id && element.movable) {
          return (
            <EditableFrame
              key={element.id}
              {...frameProps}
              // A click into a picked text types in it again, where it was clicked.
              onActivate={typeOnSlide ? typeAt : select}
              onDoubleClick={onDoubleClick}
            />
          );
        }
        const isPicked = picked?.id === element.id;
        return (
          <button
            key={element.id}
            type="button"
            data-edit-element={element.id}
            aria-label={elementLabel(element)}
            aria-pressed={isPicked}
            // A text is typed in at once, where it was clicked; anything else is picked.
            onClick={(event) => {
              event.stopPropagation();
              if (typeOnSlide) typeAt(event);
              else select();
            }}
            onPointerEnter={
              typeOnSlide ? () => editing.prefetch(element.id, 'background') : undefined
            }
            onDoubleClick={(event) => {
              event.stopPropagation();
              onDoubleClick?.(event);
            }}
            className={cn(
              'absolute rounded-mark outline-solid',
              // On hover and keyboard focus outlined on its edge, centred like LibreOffice's
              // outline of it; a heavier line once picked.
              isPicked
                ? 'outline-2 outline-offset-[-1px] outline-(--edit-color)'
                : 'outline-[1.5px] outline-offset-[-0.75px] outline-transparent hover:bg-(--edit-tint) hover:outline-(--edit-color) focus-visible:bg-(--edit-tint) focus-visible:outline-(--edit-color)',
            )}
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
              ['--edit-color' as string]: color,
              ['--edit-tint' as string]: `color-mix(in srgb, ${color} 10%, transparent)`,
            }}
          />
        );
      })}
    </div>
  );
}
