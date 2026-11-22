/**
 * Opening a folder whose newest files peek out of it (`FolderCard`, `FolderMini`): those files
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
