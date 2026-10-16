import { guideOverflows, type Slide } from '@slider/shared';
import { useMemo } from 'react';
import { GUIDE_COLORS } from '@/lib/palette';
import { cn } from '@/ui';
import { ShapeOutline } from './ShapeOutline';

const { guide: GUIDE_COLOR, overflow: OVERFLOW_COLOR } = GUIDE_COLORS;

/**
 * "Hilfslinien zeigen": PowerPoint's drawing guides over the slide image, and the boxes that
 * stick out over the outer guides (the margins) – outlined, with the part beyond the guide
 * hatched. A chip in the top right corner sums it up. Never a pointer target.
 */
export function GuideLayer({ slide }: { slide: Slide }) {
  const guides = useMemo(() => slide.guides ?? [], [slide.guides]);
  const overflows = useMemo(() => guideOverflows(slide.shapes, guides), [slide.shapes, guides]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0" data-guide-layer>
      {guides.map((guide) => {
        const horizontal = guide.orientation === 'horizontal';
        return (
          <div
            key={`${guide.orientation}:${guide.position}`}
            className={cn(
              'absolute opacity-80',
              horizontal ? 'inset-x-0 h-px -translate-y-1/2' : 'inset-y-0 w-px -translate-x-1/2',
            )}
            style={{
              [horizontal ? 'top' : 'left']: `${guide.position * 100}%`,
              backgroundColor: GUIDE_COLOR,
            }}
          />
        );
      })}
      {overflows.map(({ shape, overflow }) => (
        <div key={shape.id}>
          <ShapeOutline shape={shape} variant="emphasis" color={OVERFLOW_COLOR} />
          {overflow.map((rect, index) => (
            <div
              key={index}
              className="absolute"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
                backgroundImage: `repeating-linear-gradient(135deg, color-mix(in srgb, ${OVERFLOW_COLOR} 45%, transparent) 0 3px, transparent 3px 7px)`,
              }}
            />
          ))}
        </div>
      ))}
      <span
        className={cn(
          'absolute top-3 right-3 rounded-full px-2 py-0.5 text-caption leading-tight font-medium',
          'shadow-mark',
          // On the red: white, as on every status fill; otherwise the dark chip over the slide.
          overflows.length > 0 ? 'text-white backdrop-blur' : 'glass-dark text-fg',
        )}
        style={overflows.length > 0 ? { backgroundColor: OVERFLOW_COLOR } : undefined}
      >
        {guides.length === 0
          ? 'Keine Hilfslinien in der PowerPoint'
          : overflows.length === 0
            ? 'Alles innerhalb der Hilfslinien'
            : overflows.length === 1
              ? '1 Box ragt über die Hilfslinien'
              : `${overflows.length} Boxen ragen über die Hilfslinien`}
      </span>
    </div>
  );
}
