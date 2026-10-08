import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn, GlassPanel } from '@/ui';
import { useGoToSlide } from '../hooks/useGoToSlide';
import { parseSlideInput, stepSlide } from '../lib/slide-input';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';

/**
 * "1 / 12" pill in the controls row (Figma 87:332): position of the active slide. The number is
 * a field – type a number, Enter (or leaving the field) jumps there, Esc restores, ↑/↓ step one
 * slide and select the new number, so typing replaces it. Viewer shortcuts skip typing targets,
 * so ←/→ etc. edit the text here.
 */
export function SlideCounter({ className }: { className?: string }) {
  const { slides, slideIndex } = useViewerData();
  const { activeSlideId } = useViewerState();
  const goTo = useGoToSlide();
  const total = slides.length;
  const position = (activeSlideId ? (slideIndex.get(activeSlideId) ?? 0) : 0) + 1;
  // Text the user typed; null (not edited yet) always shows the live active slide, so a slide
  // change from elsewhere while the field has focus never leaves a stale number to commit.
  const [draft, setDraft] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Set by ↑/↓: select the number once the field shows the slide it stepped to.
  const selectPendingRef = useRef(false);
  const shown = draft ?? String(position);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!selectPendingRef.current || !input || document.activeElement !== input) return;
    selectPendingRef.current = false;
    input.select();
  }, [shown]);

  const commit = () => {
    if (draft !== null) {
      const target = parseSlideInput(draft, total);
      if (target !== null && target !== position) goTo(target - 1);
    }
    setDraft(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      // Handled here: the viewer's Esc (drop tool, close panel) must not fire as well.
      event.preventDefault();
      cancelledRef.current = true;
      event.currentTarget.blur();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const from = parseSlideInput(draft ?? '', total) ?? position;
      const next = stepSlide(from, event.key === 'ArrowUp' ? 1 : -1, total);
      // Back to "not edited": the field follows the slide we just moved to.
      setDraft(null);
      // Select now (same number) and again once the new number shows.
      event.currentTarget.select();
      selectPendingRef.current = true;
      if (next !== position) goTo(next - 1);
    }
  };

  return (
    <GlassPanel
      className={cn(
        'flex shrink-0 items-center gap-2 py-1 pr-4 pl-1 text-base leading-5 text-fg tabular-nums max-md:pr-3',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        aria-label={`Aktuelle Folie, 1 bis ${total}`}
        title="Zu Folie springen"
        maxLength={Math.max(3, String(total).length)}
        value={shown}
        style={{ width: `calc(${Math.max(1, shown.length)}ch + 0.75rem)` }}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          selectPendingRef.current = false;
          setDraft(event.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          selectPendingRef.current = false;
          if (cancelledRef.current) {
            cancelledRef.current = false;
            setDraft(null);
          } else commit();
        }}
        className={cn(
          // As wide as its digits (style below), so the number keeps the pill's even padding. No
          // border: a soft fill on hover hints that it is a field, the focus ring (global
          // :focus-visible – text fields match it on click too) marks editing.
          'h-8 min-w-8 rounded-chip bg-transparent px-1.5 text-center leading-5 text-fg-muted transition-colors',
          'hover:bg-white/8 focus:bg-white/10 focus:text-fg focus-visible:outline-offset-0',
        )}
      />
      <span aria-hidden className="text-fg-subtle">
        /
      </span>
      <span aria-hidden className="text-fg-muted">
        {total}
      </span>
      {/* Announces slide changes (←/→, track) – the field itself is not a live region. */}
      <span role="status" className="sr-only">
        Folie {position} von {total}
      </span>
    </GlassPanel>
  );
}
