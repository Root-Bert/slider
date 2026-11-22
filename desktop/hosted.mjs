// The hosted Slider, as @slider/shared names it (desktop.ts: `HOSTED_URL`, `FORMER_HOSTED_URLS`,
// `movedServer`) – the desktop apps are no workspace of the repo and import nothing from it.

/** Where the apps sign in unless told otherwise. */
export const HOSTED_SERVER = 'https://office.bertro.dev';
/** Where it was before (up to 1.6): the same server, still answering the apps there. */
const FORMER = ['https://slider.bertro.dev'];

/** A server kept from before, as it is called now; any other stays. */
export const movedServer = (server) => (FORMER.includes(server) ? HOSTED_SERVER : server);

/** A page address kept from before (a tab of last time), at its server as it is called now. */
export function movedUrl(url) {
  try {
    const { origin, pathname, search, hash } = new URL(url);
    const now = movedServer(origin);
    return now === origin ? url : `${now}${pathname}${search}${hash}`;
  } catch {
    return url;
  }
}

/**
 * A session kept from before (`{ server, token, … }`) at its server as it is called now – the
 * same account there – and stored so by `keep`; not stored, it is moved again next start.
 */
export function movedSession(kept, keep) {
  if (!kept?.server || movedServer(kept.server) === kept.server) return kept;
  const moved = { ...kept, server: movedServer(kept.server) };
  try {
    keep(moved);
  } catch {
    // Moved for this start all the same.
  }
  return moved;
}
