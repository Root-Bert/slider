import { useEffect, type RefObject } from 'react';
import { rafThrottle } from '@/lib/dom';

/** Space kept free between the slot and the controls beside it. */
const GAP = 12;
/** A gap narrower than this is no use: the slot then covers the nearest group (the filters first). */
const MIN_ROOM = 160;

/** The slot's insets from its row's edges; `null` – the whole row (its class's `inset-x-0`). */
function place(slot: HTMLElement, left: number | null, right: number | null) {
  slot.style.left = left === null ? '' : `${Math.round(left)}px`;
  slot.style.right = right === null ? '' : `${Math.round(right)}px`;
}

/**
 * Fits the split handle's spot (`slot`) into the gap the controls row leaves in the middle,
 * between its groups left and right of the centre: the handle sits in the middle of that gap and
 * the bars growing out of it (find, voice, comment selection) take its width – their contents
 * follow by container query. Too narrow a gap takes in the groups next to it, nearest first and
 * those on the right (the filters) before the tools. Kept up as the row, its groups or the window
 * resize.
 */
export function useHandleRoom(slot: HTMLElement | null, rowRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const row = rowRef.current;
    const parent = slot?.offsetParent;
    if (!slot || !row || !(parent instanceof HTMLElement)) return;

    // The controls are the children of the row's own child (the controls node); the right-aligned
    // cluster (`data-controls-cluster`) counts by its own parts.
    const groups = () =>
      row.querySelectorAll<HTMLElement>(
        ':scope > * > :not([data-controls-cluster]), :scope > * > [data-controls-cluster] > *',
      );

    const measure = () => {
      const box = parent.getBoundingClientRect();
      const centre = box.left + box.width / 2;
      // Edges facing the middle, nearest first.
      const lefts: number[] = [];
      const rights: number[] = [];
      for (const group of groups()) {
        const rect = group.getBoundingClientRect();
        if (rect.width < 2) continue;
        if (rect.left + rect.width / 2 < centre) lefts.push(rect.right);
        else rights.push(rect.left);
      }
      lefts.sort((a, b) => b - a);
      rights.sort((a, b) => a - b);
      for (let skipped = 0; skipped <= lefts.length + rights.length; skipped++) {
        for (let skipRight = skipped; skipRight >= 0; skipRight--) {
          const skipLeft = skipped - skipRight;
          if (skipLeft > lefts.length || skipRight > rights.length) continue;
          const left = lefts[skipLeft] ?? box.left;
          const right = rights[skipRight] ?? box.right;
          if (right - left - 2 * GAP < MIN_ROOM) continue;
          place(slot, left - box.left + GAP, box.right - right + GAP);
          return;
        }
      }
      place(slot, null, null);
    };
    const update = rafThrottle(measure);

    const resize = new ResizeObserver(update.schedule);
    const observeAll = () => {
      resize.disconnect();
      resize.observe(parent);
      for (const group of groups()) resize.observe(group);
    };
    // Groups come and go (a template's controls).
    const mutations = new MutationObserver(() => {
      observeAll();
      update.schedule();
    });
    mutations.observe(row, { childList: true, subtree: true });
    observeAll();
    measure();
    return () => {
      resize.disconnect();
      mutations.disconnect();
      update.cancel();
      place(slot, null, null);
    };
  }, [slot, rowRef]);
}
