import { SELECT_ID } from '@/lib/collection-selection';

/**
 * Opening a folder whose newest files peek out of it (`FolderPicture`, `FolderMini`): those files
 * slide from the folder to where they lie inside, as on a phone's home screen. The browser draws
 * it (view transitions): the sheet in the folder and the file's picture in the list carry the
 * same name for the one change of page, and only then – two things with one name end it.
 */
let flying: ReadonlySet<string> = new Set();

const nameOf = (id: string) => `cloud-fly-${id}`;
const FLY_MS = 420;

/** For a file's picture in a list: the name it carries while it is flown to. */
export const flyStyle = (
  id: string,
): { viewTransitionName: string; viewTransitionClass: string } | undefined =>
  flying.has(id) ? { viewTransitionName: nameOf(id), viewTransitionClass: 'cloud-fly' } : undefined;

/**
 * Goes into the folder with its peeking files flying. `ready` is the folder's list being
 * fetched: waited for a moment only, the folder opens without the flight when it takes longer.
 */
export async function flyInto(
  peek: readonly string[],
  ready: Promise<unknown>,
  go: (flown: boolean) => void,
) {
  const sheets = peek.flatMap((id) => {
    const sheet = document.querySelector<HTMLElement>(`[data-peek="${id}"]`);
    return sheet ? [{ id, sheet }] : [];
  });
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (sheets.length === 0 || still || !('startViewTransition' in document)) return go(false);
  const arrived = await Promise.race([
    ready.then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
  ]);
  if (!arrived) return go(false);
  for (const { id, sheet } of sheets) {
    sheet.style.setProperty('view-transition-name', nameOf(id));
    sheet.style.setProperty('view-transition-class', 'cloud-fly');
  }
  flying = new Set(sheets.map((each) => each.id));
  go(true);
  setTimeout(() => {
    flying = new Set();
    for (const { sheet } of sheets) {
      sheet.style.removeProperty('view-transition-name');
      sheet.style.removeProperty('view-transition-class');
    }
    // The pictures flown to keep theirs until drawn again: taken off by hand.
    for (const picture of document.querySelectorAll<HTMLElement>('[data-flown]')) {
      picture.style.removeProperty('view-transition-name');
      picture.style.removeProperty('view-transition-class');
    }
  }, FLY_MS + 200);
}

/** Longest a move's view transition waits for the list to lose what went – the page is still meanwhile. */
const LEAVE_WAIT_MS = 300;

/**
 * Moving things out of the list shown (dropped on a folder, the path, the side bar, „Verschieben“):
 * what went shrinks and fades from its place – an empty frame, when it was dragged – and the rest
 * slide up to fill it, instead of everything jumping at once. A view transition, as the folder's
 * flight: the items on screen carry names for this one change. `change` makes it; the list's
 * cache is patched a moment later, so it is waited for until `gone` have left the page.
 */
export function leaveList(gone: readonly string[], change: () => void) {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const busy = (document as Document & { activeViewTransition?: ViewTransition | null })
    .activeViewTransition;
  if (still || busy || !('startViewTransition' in document)) return change();
  const named: HTMLElement[] = [];
  const seen = new Set<string>();
  for (const item of document.querySelectorAll<HTMLElement>(`[${SELECT_ID}]`)) {
    const id = item.getAttribute(SELECT_ID) ?? '';
    const box = item.getBoundingClientRect();
    if (seen.has(id) || box.bottom < 0 || box.top > window.innerHeight) continue;
    seen.add(id);
    named.push(item);
  }
  // Nothing that goes is on screen: nothing to see leave.
  if (!gone.some((id) => seen.has(id))) return change();
  for (const item of named) {
    item.style.setProperty('view-transition-name', `cloud-item-${item.getAttribute(SELECT_ID)}`);
    item.style.setProperty('view-transition-class', 'cloud-leave');
  }
  const root = document.documentElement;
  root.dataset.transition = 'cloud-leave';
  const present = () => gone.some((id) => document.querySelector(`[${SELECT_ID}="${id}"]`));
  const transition = document.startViewTransition(async () => {
    change();
    for (let waited = 0; waited < LEAVE_WAIT_MS && present(); waited += 20) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
  void transition.finished.finally(() => {
    for (const item of named) {
      item.style.removeProperty('view-transition-name');
      item.style.removeProperty('view-transition-class');
    }
    if (root.dataset.transition === 'cloud-leave') delete root.dataset.transition;
  });
}
