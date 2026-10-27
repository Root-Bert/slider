import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { isModKey } from '@/lib/keyboard';
import { cn, Icon, IconButton, Toolbar, ToolbarDivider } from '@/ui';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';
import { useFindJump } from './hooks/useFindJump';
import { findCounter, findHits, type FindHit } from './lib/find-hits';

const INPUT_LABEL = 'In dieser Review suchen';

/**
 * In-review search (BER-176): ⌘F / Ctrl F opens this bar instead of the browser's find. It
 * searches what the viewer already holds – the titles and box texts of the shown slides, every
 * comment and reply – ignoring case and accents, and shows the hits in reading order (see
 * `findHits`): typing jumps to the first, ↵ / ⇧↵ (or the arrows) step through them, Esc closes
 * the bar and gives the focus back. ⌘F while open selects the query again. On desktop it docks at
 * `slot`, the split handle's spot, morphing out of the handle and back into it on close; without
 * a slot (phones) a floating glass pill at the top, the full width.
 */
export function FindBar({ slot = null }: { slot?: HTMLElement | null }) {
  const { slides, slideIndex, threads } = useViewerData();
  const { threadPanelOpen, deletedPanelOpen, layersPanelOpen } = useViewerState();
  const registry = useStageRegistry();
  const jump = useFindJump();
  // `closing`: still shown while it morphs back into the split handle.
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed');
  const open = phase !== 'closed';
  const [query, setQuery] = useState('');
  // The current hit by key, so it stays current while comments are polled.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const barRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Where the focus goes back to on Esc.
  const returnFocus = useRef<Element | null>(null);

  const source = useMemo(() => ({ slides, slideIndex, threads }), [slides, slideIndex, threads]);
  const hits = useMemo(() => (open ? findHits(query, source) : []), [open, query, source]);
  const index = activeKey === null ? -1 : hits.findIndex((hit) => hit.key === activeKey);
  const counter = findCounter(query, hits, index);

  const focusInput = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  const onWindowKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.key.toLowerCase() !== 'f' || !isModKey(event) || event.altKey || event.shiftKey)
      return;
    // Modal dialogs (share, delete confirmation) keep the browser's own find.
    if (event.target instanceof Element && event.target.closest('dialog')) return;
    event.preventDefault();
    if (phase === 'open') {
      focusInput();
      return;
    }
    if (phase === 'closed') returnFocus.current = document.activeElement;
    setPhase('open');
  });
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => onWindowKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // Opened: into the field, with the last query selected (as the browser's find does).
  useEffect(() => {
    if (phase === 'open') focusInput();
  }, [phase]);

  // The current hit is gone (its comment deleted, a new version): its outline goes too.
  const activeGone = activeKey !== null && index < 0;
  useEffect(() => {
    if (activeGone) registry.setFindHighlight(null);
  }, [activeGone, registry]);
  useEffect(() => () => registry.setFindHighlight(null), [registry]);

  /** Jumps to `hit`; the thread panel a comment hit opens must not keep the focus from the bar. */
  const show = (hit: FindHit | null) => {
    setActiveKey(hit?.key ?? null);
    const focused = document.activeElement;
    jump(hit);
    if (hit?.kind !== 'comment' || !(focused instanceof HTMLElement)) return;
    if (!barRef.current?.contains(focused)) return;
    requestAnimationFrame(() => {
      if (document.activeElement !== focused) focused.focus({ preventScroll: true });
    });
  };

  const onQueryChange = (next: string) => {
    setQuery(next);
    show(findHits(next, source)[0] ?? null);
  };

  const step = (direction: 1 | -1) => {
    const count = hits.length;
    if (count === 0) return;
    const next =
      index < 0 ? (direction === 1 ? 0 : count - 1) : (index + direction + count) % count;
    show(hits[next]!);
  };

  const close = () => {
    setPhase(slot ? 'closing' : 'closed');
    registry.setFindHighlight(null);
    const previous = returnFocus.current;
    returnFocus.current = null;
    if (previous instanceof HTMLElement && previous !== document.body && previous.isConnected) {
      previous.focus({ preventScroll: true });
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  // Esc anywhere in the bar closes it – handled here, so the viewer's own Esc (draft, tool,
  // thread panel) waits for the next press.
  const onBarKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close();
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    step(event.shiftKey ? -1 : 1);
  };

  const onMorphEnd = (event: AnimationEvent<HTMLElement>) => {
    if (event.target === event.currentTarget && phase === 'closing') setPhase('closed');
  };

  if (!open) return null;
  const sidePanelOpen = threadPanelOpen || deletedPanelOpen || layersPanelOpen;
  const none = hits.length === 0;
  const closing = phase === 'closing';

  const bar = (
    <search
      ref={barRef}
      data-find-bar
      inert={closing}
      onKeyDown={onBarKeyDown}
      className={cn(
        slot
          ? // Over the controls row, whose controls it may cover on a narrow band.
            'absolute z-(--z-raised) w-[min(380px,calc(100%-2rem))]'
          : // Above a phone's bottom sheet (same layer, later in the page); left of the side
            // panel from tablet up, like the avatars at the bottom.
            cn(
              'fixed inset-x-4 top-3 z-(--z-panel) transition-[right] duration-300',
              'md:top-4 md:right-6 md:left-auto md:w-[380px]',
              sidePanelOpen && 'md:right-[424px] md:max-w-[calc(100%-448px)]',
            ),
      )}
    >
      <Toolbar
        role={false}
        tone="elevated"
        onAnimationEnd={onMorphEnd}
        className={cn(
          'relative min-w-0 pl-3',
          !slot
            ? 'animate-fade-in'
            : closing
              ? 'animate-morph-into-handle'
              : 'animate-morph-out-of-handle',
        )}
      >
        {/* The handle's line, fading into the bar as it grows. */}
        {slot && (
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 bg-fg-muted',
              closing ? 'animate-handle-fade-in' : 'animate-handle-fade-out',
            )}
          />
        )}
        <Icon name="search" size="md" className="shrink-0 text-fg-subtle" />
        <input
          ref={inputRef}
          type="text"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          aria-label={INPUT_LABEL}
          placeholder="In Folien und Kommentaren suchen…"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onInputKeyDown}
          className="h-8 min-w-0 flex-1 bg-transparent pl-1 text-body text-fg outline-none placeholder:text-fg-subtle"
        />
        <span
          role="status"
          className={cn(
            'shrink-0 px-1 text-xs whitespace-nowrap tabular-nums',
            none ? 'text-fg-faint' : 'text-fg-subtle',
          )}
        >
          {counter}
        </span>
        <ToolbarDivider spacing="none" />
        <IconButton
          icon="expandLess"
          label="Vorheriger Treffer"
          title="Vorheriger Treffer (⇧↵)"
          size="sm"
          disabled={none}
          onClick={() => step(-1)}
        />
        <IconButton
          icon="expandMore"
          label="Nächster Treffer"
          title="Nächster Treffer (↵)"
          size="sm"
          disabled={none}
          onClick={() => step(1)}
        />
        <IconButton icon="close" label="Suche schließen (Esc)" size="sm" onClick={close} />
      </Toolbar>
    </search>
  );
  return slot ? createPortal(bar, slot) : bar;
}
