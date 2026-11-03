import { useState, type AnimationEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn, Icon, Toolbar } from '@/ui';
import { useHandleHint } from './handle-hint';

/**
 * The hint said through `setHandleHint`, grown out of the split handle's line under the track and
 * shrunk back into it – as the find bar does (`FindBar`), in the handle's slot (`slot`).
 */
export function HandleHint({ slot }: { slot: HTMLElement | null }) {
  const hint = useHandleHint();
  // The text it shows, kept while it shrinks back.
  const [shown, setShown] = useState(hint);
  const [closing, setClosing] = useState(false);
  if (hint !== null && (hint !== shown || closing)) {
    setShown(hint);
    setClosing(false);
  } else if (hint === null && shown !== null && !closing) {
    setClosing(true);
  }
  if (!slot || shown === null) return null;
  const onMorphEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !closing) return;
    setShown(null);
    setClosing(false);
  };
  return createPortal(
    <div data-handle-hint role="status" className="absolute z-(--z-raised)">
      <Toolbar
        role={false}
        tone="elevated"
        onAnimationEnd={onMorphEnd}
        className={cn(
          'relative gap-2 py-1.5 pr-3.5 pl-3 text-body whitespace-nowrap text-fg',
          closing ? 'animate-morph-into-handle' : 'animate-morph-out-of-handle',
        )}
      >
        {/* The handle's line, fading into the hint as it grows. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 bg-fg-muted',
            closing ? 'animate-handle-fade-in' : 'animate-handle-fade-out',
          )}
        />
        <Icon name="info" size="sm" className="shrink-0 text-fg-subtle" />
        {shown}
      </Toolbar>
    </div>,
    slot,
  );
}
