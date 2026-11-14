import type { AppDeps } from '../deps';
import { fixedWindow } from './rate-limit';

/** Text searches per account and minute (BER-175): a search asks once typing pauses. */
export const SEARCHES_PER_MINUTE = 60;

const MINUTE_MS = 60_000;

function createWindows(deps: AppDeps) {
  const perMinute = (limit: number) =>
    fixedWindow({ limit, windowMs: MINUTE_MS, clock: deps.clock });
  return {
    // Each AI request runs on the workspace's AI key: a person asks a few a minute at most.
    aiRequests: perMinute(20),
    // A deck is built a few times a day at most; a script asking again and again is stopped.
    deckCreations: perMinute(6),
    // „Fragen“ on the material page: each answer reads up to a dozen turns of material.
    materialQuestions: perMinute(10),
    // Every search reads and decrypts the text of all decks: typing pauses ask, a loop does not.
    searches: perMinute(SEARCHES_PER_MINUTE),
    // A PDF or slide picture is drawn by LibreOffice, which only draws a few files at once.
    pdfs: perMinute(5),
    // Everything a KI-App asks over MCP, whatever the tool.
    mcpCalls: perMinute(120),
  };
}

const windows = new WeakMap<AppDeps, ReturnType<typeof createWindows>>();

/**
 * Per-person windows (keyed by account id) for work that costs the workspace's AI key or the
 * server's time – one budget per app, shared by the web routes and the MCP tools that start the
 * same work, so a KI-App cannot go around the page's limits.
 */
export function aiLimits(deps: AppDeps) {
  let found = windows.get(deps);
  if (!found) {
    found = createWindows(deps);
    windows.set(deps, found);
  }
  return found;
}
