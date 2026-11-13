// Online, signed in, the server is the truth (BER-201): the tabs show its pages, live with
// everyone else, as in the browser. The local server keeps copies of the account's decks in the
// background, so that offline the tabs can move to them and work goes on; back online its passes
// bring the steps made offline to the server first, then the tabs move back.
//
// The same presentation has an id here and one there: a page address is moved across by swapping
// the deck and workspace ids in it (`/d/:id`, `/w/:id/…`, `?workspace=`). Nothing to swap to (a
// deck made offline, not uploaded yet): `null`, the tab stays where it is.

/** `{ a: b }` → `{ b: a }`. */
export const flip = (record) =>
  Object.fromEntries(Object.entries(record).map(([key, value]) => [value, key]));

/**
 * `url` moved from origin `from` to origin `to`. `decks` and `workspaces` map ids at `from` to
 * ids at `to`. Another origin than `from`: unchanged. Unknown id: `null`.
 */
export function moveUrl(url, { from, to, decks, workspaces }) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== from) return url;
  let known = true;
  const pathname = parsed.pathname.replace(/^\/(d|w)\/([^/]+)/, (whole, kind, id) => {
    const other = (kind === 'd' ? decks : workspaces)[decodeURIComponent(id)];
    if (!other) {
      known = false;
      return whole;
    }
    return `/${kind}/${encodeURIComponent(other)}`;
  });
  if (!known) return null;
  const workspace = parsed.searchParams.get('workspace');
  if (workspace) {
    const other = workspaces[workspace];
    if (other) parsed.searchParams.set('workspace', other);
    else parsed.searchParams.delete('workspace');
  }
  return `${to}${pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Whether the server answers – two misses in a row before it counts as gone, so one slow answer
 * does not move every tab.
 */
export function createReachability(check) {
  let misses = 0;
  let up = false;
  return async () => {
    const ok = await check().catch(() => false);
    if (ok) {
      misses = 0;
      up = true;
    } else if (++misses >= 2) up = false;
    return up;
  };
}
