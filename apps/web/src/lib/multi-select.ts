import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { isTypingTarget } from '@/lib/dom';
import { isModKey } from '@/lib/keyboard';

const NONE: ReadonlySet<string> = new Set();

/**
 * Several items selected at once (Finder-style; the decks in "Reviews", the fonts on the
 * workspace page): ⌘/Ctrl-click toggles one – and so does a plain click while some are selected,
 * instead of opening it – Shift-click selects the range from the last clicked, a selection box
 * (`useMarqueeSelect`) selects what it touches. ⌘A selects every visible item, Escape clears.
 * Only visible items count – filtering or searching narrows the selection.
 */
export function useMultiSelect(visibleIds: readonly string[]) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(NONE);
  const anchor = useRef<string | null>(null);
  // Selection before the current drag, so a ⌘-drag adds to it.
  const dragBase = useRef<ReadonlySet<string>>(NONE);

  const selectedIds = useMemo(
    () => visibleIds.filter((id) => picked.has(id)),
    [visibleIds, picked],
  );
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const clear = () => {
    anchor.current = null;
    setPicked(NONE);
  };

  /** Click on an item with ⌘/Ctrl (toggle) or Shift (range), or any click while some are
   * selected (toggle); false for a plain click with nothing selected – that opens it. */
  const onModifiedClick = (
    id: string,
    event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean },
  ) => {
    if (event.shiftKey && anchor.current && visibleIds.includes(anchor.current)) {
      const from = visibleIds.indexOf(anchor.current);
      const to = visibleIds.indexOf(id);
      const range = visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1);
      setPicked(new Set([...selectedIds, ...range]));
      return true;
    }
    if (isModKey(event) || event.shiftKey || selectedIds.length > 0) {
      anchor.current = id;
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setPicked(next);
      return true;
    }
    return false;
  };

  const marquee = {
    onStart: (additive: boolean) => {
      dragBase.current = additive ? selected : NONE;
    },
    onChange: (ids: string[]) => {
      setPicked(new Set([...dragBase.current, ...ids]));
      anchor.current = ids.at(-1) ?? anchor.current;
    },
    onClick: (additive: boolean) => {
      if (!additive) clear();
    },
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isTypingTarget(event.target)) return;
    if (document.querySelector('dialog[open], [role="menu"]')) return;
    if (event.key === 'Escape' && selectedIds.length > 0) {
      clear();
    } else if (
      event.key.toLowerCase() === 'a' &&
      isModKey(event) &&
      !event.altKey &&
      visibleIds.length > 0
    ) {
      event.preventDefault();
      setPicked(new Set(visibleIds));
    }
  });
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { selected, selectedIds, clear, onModifiedClick, marquee };
}
