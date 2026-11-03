import { useRef, useState, type PointerEvent } from 'react';
import { layoutPlaceholders, type Guide } from '@slider/shared';
import { GUIDE_COLORS } from '@/lib/palette';
import { cn } from '@/ui';
import { useEditing } from '../editing/editing-context';
import { shapeOutlineStyle } from '../stage/lib/shape-outline-style';
import { PLACEHOLDER_LABELS } from './placeholder-labels';
import { useLayoutGuides, useTemplate } from './useTemplate';

/** How far off the slide a guide is dragged to go (a fraction of it). */
const REMOVE_BEYOND = 0.02;

/**
 * Over a slide of a template being designed: its placeholders outlined, dashed, with what they
 * hold – every text box but locked ones, the pictures marked –, and its layout's guides – dragged along the slide, off it to remove them.
 */
export function TemplateLayer({
  slideId,
  guides: showGuides = true,
}: {
  slideId: string;
  /** Off while the guides tool draws them itself (`GuideEditor`). */
  guides?: boolean;
}) {
  const { template } = useTemplate();
  const layout = useLayoutGuides(slideId);
  const editing = useEditing();
  const ref = useRef<HTMLDivElement>(null);
  // The guide being dragged, where it is now.
  const [dragging, setDragging] = useState<{ index: number; position: number } | null>(null);
  if (!template || !layout) return null;
  const elements = editing.state?.slides.find((slide) => slide.slideId === slideId)?.elements ?? [];
  // Every text box one can type into, and each picture marked so (`layoutPlaceholders`).
  const kinds = layoutPlaceholders(elements, template.placeholders);
  const placeholders = elements.flatMap((element) => {
    const kind = kinds[element.id];
    return kind ? [{ element, kind }] : [];
  });

  const positionAt = (event: PointerEvent, guide: Guide) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return guide.position;
    return guide.orientation === 'vertical'
      ? (event.clientX - box.left) / box.width
      : (event.clientY - box.top) / box.height;
  };
  const drop = (index: number, position: number) => {
    setDragging(null);
    layout.set(
      position < -REMOVE_BEYOND || position > 1 + REMOVE_BEYOND
        ? layout.guides.filter((_, at) => at !== index)
        : layout.guides.map((guide, at) =>
            at === index ? { ...guide, position: Math.min(1, Math.max(0, position)) } : guide,
          ),
    );
  };

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0" data-template-layer="">
      {placeholders.map(({ element, kind }) => (
        <div
          key={element.id}
          aria-hidden
          className="absolute rounded-mark border border-dashed border-fg-muted"
          // Turned and tilted as the element shows (`ShapeOutline`).
          style={shapeOutlineStyle(element)}
        >
          <span className="glass-dark absolute -top-px left-0 -translate-y-full rounded-chip px-1.5 py-px text-caption leading-tight text-fg">
            {PLACEHOLDER_LABELS[kind]}
          </span>
        </div>
      ))}
      {showGuides &&
        layout.guides.map((guide, index) => {
          const vertical = guide.orientation === 'vertical';
          const position = dragging?.index === index ? dragging.position : guide.position;
          const outside = position < -REMOVE_BEYOND || position > 1 + REMOVE_BEYOND;
          return (
            <div
              key={index}
              role="separator"
              aria-orientation={vertical ? 'vertical' : 'horizontal'}
              aria-label={`${vertical ? 'Senkrechte' : 'Waagrechte'} Hilfslinie – ziehen zum Verschieben, von der Folie ziehen zum Entfernen`}
              title="Ziehen zum Verschieben, von der Folie ziehen zum Entfernen"
              className={cn(
                'pointer-events-auto absolute flex touch-none justify-center',
                vertical
                  ? 'inset-y-0 w-2.5 -translate-x-1/2 cursor-col-resize'
                  : 'inset-x-0 h-2.5 -translate-y-1/2 cursor-row-resize flex-col',
                outside && 'opacity-30',
              )}
              style={{ [vertical ? 'left' : 'top']: `${position * 100}%` }}
              onPointerDown={(event) => {
                event.stopPropagation();
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging({ index, position: guide.position });
              }}
              onPointerMove={(event) => {
                if (dragging?.index !== index) return;
                setDragging({ index, position: positionAt(event, guide) });
              }}
              onPointerUp={(event) => {
                if (dragging?.index !== index) return;
                // Only pressed, not dragged: it stays where it is, nothing is sent.
                if (dragging.position === guide.position) {
                  setDragging(null);
                  return;
                }
                drop(index, positionAt(event, guide));
              }}
              onPointerCancel={() => setDragging(null)}
            >
              <span
                className={vertical ? 'h-full w-px' : 'h-px w-full'}
                style={{ backgroundColor: GUIDE_COLORS.guide }}
              />
            </div>
          );
        })}
    </div>
  );
}
