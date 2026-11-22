import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { isTextTarget } from '@/lib/dom';
import { isModKey } from '@/lib/keyboard';

const NONE: ReadonlySet<string> = new Set();

/**
 * Several items selected at once (Finder-style; the decks in "Präsentationen", the files in
 * Cloud, the fonts on the workspace page): ⌘/Ctrl-click toggles one, Shift-click selects the
 * range from the last clicked, a selection box (`useMarqueeSelect`) selects what it touches. A
 * plain click while several are selected picks that one alone, as in the Finder; otherwise it
 * does what the item's click does (a deck opens). ⌘A selects every visible item, Escape clears.
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

  /** Click on an item with ⌘/Ctrl (toggle) or Shift (range), or a plain one while several are
   * selected (that one alone); false for any other plain click – the item's own (it opens), and
   * a single selected one is let go. */
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
    if (isModKey(event) || event.shiftKey) {
      anchor.current = id;
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setPicked(next);
      return true;
    }
    if (selectedIds.length >= 2) {
      pickOne(id);
      return true;
    }
    if (selectedIds.length > 0) clear();
    return false;
  };

  /** Only this one, and the start of a Shift range from here (Cloud: a click on a file, ↑/↓). */
  const pickOne = (id: string) => {
    anchor.current = id;
    setPicked(new Set([id]));
  };

  /** From the range's start to this one, instead of what was picked (Cloud: Shift+↑/↓). */
  const extendTo = (id: string) => {
    const from = anchor.current ? visibleIds.indexOf(anchor.current) : -1;
    const to = visibleIds.indexOf(id);
    if (from < 0 || to < 0) return pickOne(id);
    setPicked(new Set(visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1)));
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
    // Typing keeps its keys; a `<select>` or a checkbox has none of these (⌘A, Esc) for itself.
    const target = event.target;
    const ownKeys =
      isTextTarget(target) ||
      (target instanceof HTMLElement && target.getAttribute('role') === 'listbox');
    if (event.defaultPrevented || ownKeys) return;
    if (document.querySelector('dialog[open], [role="menu"]')) return;
    if (event.key === 'Escape' && selectedIds.length > 0) {
      // Esc only clears the selection – the page's own Esc waits for the next press.
      event.preventDefault();
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

  return { selected, selectedIds, clear, onModifiedClick, pickOne, extendTo, marquee };
}
