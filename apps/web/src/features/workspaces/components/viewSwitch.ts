import { useLayoutEffect } from 'react';

/*
 * Switching between views whose labels are the page's title (`ViewTitles`, the mailboxes'
 * `MailboxTabs`): the labels morph into each other, the page crossfades (`styles/index.css`).
 */

/** Longer than the switch's view transition (see `styles/index.css`), so it isn't cut short. */
const SWITCH_MS = 600;

/** Set by a click on another view, taken by the view that shows next (`useViewSwitchTop`). */
let switching = false;
/** Clears `data-transition` after the last switch – one timer, so a quick second switch keeps it. */
let transitionReset: ReturnType<typeof setTimeout> | undefined;

/** The other views' labels: smaller and lighter than the open one, ink on hover. */
export const VIEW_LINK_CLASS =
  'text-xl font-medium text-fg-subtle transition-colors duration-200 hover:text-fg';

/**
 * A click on another view's label (a `Link` with `viewTransition`): the labels morph and the
 * page crossfades (`styles/index.css`) instead of the import stage's transition. Also the
 * mailboxes' (`MailboxTabs`), with their own names.
 */
export function startViewSwitch() {
  switching = true;
  // Picks the light switch transition instead of the import stage's (index.css).
  const root = document.documentElement;
  root.dataset.transition = 'workspace-view';
  // An earlier click's timer would clear it in the middle of this switch: the page
  // then fell back to the import stage's blur and the header to the crossfade.
  clearTimeout(transitionReset);
  transitionReset = setTimeout(() => delete root.dataset.transition, SWITCH_MS);
}

/**
 * Clicks while a view transition still runs – a switch of views or mailboxes, a folder's files
 * flying in: what moves is pictures over the page, and the real things under them take no click
 * (the browser's rule) – so the click lands on the page's root. It ends the transition at once
 * and goes on to what stands there now: the next view, mailbox or folder opens without waiting.
 */
export function installClickThrough() {
  document.addEventListener('click', clickThrough);
}

function clickThrough(event: MouseEvent) {
  if (event.target !== document.documentElement) return;
  const transition = (document as Document & { activeViewTransition?: ViewTransition | null })
    .activeViewTransition;
  if (!transition) return;
  const { clientX: x, clientY: y } = event;
  transition.skipTransition();
  void transition.finished.finally(() =>
    document.elementFromPoint(x, y)?.closest<HTMLElement>('a[href], button')?.click(),
  );
}

/**
 * The other view starts at the top. Without this it kept the scroll offset (a trackpad nudge
 * of 1px is enough): on a view too short to scroll, Safari only clamps it to 0 a moment after
 * the switch, and the whole page dropped by that much. Before paint – and inside the view
 * transition's update, so its new snapshot already shows the page at the top. `current`: the
 * open view – a page that stays mounted (the mailboxes) switches without mounting anew.
 */
export function useViewSwitchTop(current: string) {
  useLayoutEffect(() => {
    if (!switching) return;
    switching = false;
    window.scrollTo(0, 0);
  }, [current]);
}
