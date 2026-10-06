import type { AccentColor, Slide } from '@slider/shared';
import { memo, useRef, useState } from 'react';
import { Badge, cn, Icon } from '@/ui';
import type { Thread } from '../lib/comment-selectors';
import { slideLabel } from '../lib/labels';
import { useStageRegistry } from '../state/stage-registry';
import type { Draft, Tool } from '../state/viewer-state';
import { AnnotationLayer } from './AnnotationLayer';
import { DrawingSurface } from './DrawingSurface';
import { slideWidthCss } from './stage-layout';

interface SlideFrameProps {
  slide: Slide;
  index: number;
  total: number;
  isActive: boolean;
  /** Threads of this slide that pass the filter. */
  threads: Thread[];
  /** Focused or hovered thread – only set when it belongs to this slide. */
  emphasisId: string | null;
  /** The draft – only set when it is on this slide. */
  draft: Draft | null;
  /** Active tool, `null` when not drawing or not allowed to comment. */
  tool: Tool | null;
  color: AccentColor;
}

/** One slide on the stage: image, annotation overlay and – while a tool is active – the drawing surface. */
export const SlideFrame = memo(function SlideFrame({
  slide,
  index,
  total,
  isActive,
  threads,
  emphasisId,
  draft,
  tool,
  color,
}: SlideFrameProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const registry = useStageRegistry();
  const [loaded, setLoaded] = useState(false);
  const label = slideLabel(index);

  return (
    <div
      data-slide-id={slide.id}
      role="group"
      aria-roledescription="Folie"
      aria-label={`${label} von ${total}${slide.title ? `: ${slide.title}` : ''}`}
      aria-current={isActive || undefined}
      className="shrink-0 snap-start"
    >
      <div
        ref={boxRef}
        data-slide-box={slide.id}
        className={cn('relative', !isActive && !tool && 'cursor-pointer')}
        style={{ width: slideWidthCss(slide.aspectRatio), aspectRatio: slide.aspectRatio }}
        // Clicking the peeking next slide brings it to the front.
        onClick={isActive || tool ? undefined : () => registry.scrollToSlide(slide.id)}
      >
        <div
          className={cn(
            'absolute inset-0 overflow-hidden rounded-2xl bg-placeholder',
            !loaded && 'skeleton',
          )}
        >
          <img
            src={slide.imageUrl}
            alt={slide.title ?? label}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            className={cn(
              'size-full object-contain transition-opacity duration-300 select-none',
              loaded ? 'opacity-100' : 'opacity-0',
              slide.hidden && 'opacity-40',
            )}
          />
        </div>
        {slide.hidden && (
          <Badge className="absolute top-3 left-3 bg-black/60! backdrop-blur">
            <Icon name="visibilityOff" size={14} />
            Ausgeblendet
          </Badge>
        )}
        <AnnotationLayer slide={slide} threads={threads} emphasisId={emphasisId} draft={draft} />
        {tool && <DrawingSurface slide={slide} boxRef={boxRef} tool={tool} color={color} />}
      </div>
    </div>
  );
});
