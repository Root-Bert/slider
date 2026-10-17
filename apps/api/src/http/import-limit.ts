import { createMiddleware } from 'hono/factory';
import type { ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { ApiError } from './errors';
import { clientAddress, fixedWindow } from './rate-limit';

/**
 * Imports per account and hour: uploads, links, OneDrive picks, new versions and "Neu rendern"
 * together. Each one is up to 200 MB downloaded or uploaded, parsed and rendered by LibreOffice
 * in the one import queue – without a cap one account (open sign-up on the demo) could keep the
 * queue busy for everyone, or make the server fetch URLs in a loop. Failed attempts count too.
 */
export const IMPORTS_PER_HOUR = { limited: 20, unlimited: 200 } as const;
/** Per address: several people behind one office NAT share it. */
const CLIENT_FACTOR = 5;
const HOUR_MS = 60 * 60_000;

const limiters = new WeakMap<AppDeps, ReturnType<typeof createImportLimit>>();

function createImportLimit(deps: AppDeps) {
  const perUser = deps.config.limited ? IMPORTS_PER_HOUR.limited : IMPORTS_PER_HOUR.unlimited;
  const byUser = fixedWindow({ limit: perUser, windowMs: HOUR_MS, clock: deps.clock });
  const byClient = fixedWindow({
    limit: perUser * CLIENT_FACTOR,
    windowMs: HOUR_MS,
    clock: deps.clock,
  });
  return createMiddleware<ViewerEnv>(async (c, next) => {
    const user = byUser.hit(c.var.viewer.author.id);
    const client = byClient.hit(clientAddress(c));
    if (!user.allowed || !client.allowed) {
      const retryAfterS = Math.max(
        user.allowed ? 0 : user.retryAfterS,
        client.allowed ? 0 : client.retryAfterS,
      );
      c.header('Retry-After', String(retryAfterS));
      throw new ApiError(
        429,
        'rate_limited',
        `Du hast gerade sehr viele Präsentationen importiert. Bitte versuch es in ${Math.ceil(retryAfterS / 60)} Minuten noch einmal.`,
      );
    }
    await next();
  });
}

/** One budget per app, shared by every import route (after `viewerMiddleware`). */
export function importLimit(deps: AppDeps) {
  let limiter = limiters.get(deps);
  if (!limiter) {
    limiter = createImportLimit(deps);
    limiters.set(deps, limiter);
  }
  return limiter;
}

/** Deck files (uploads and new versions) one account may send at once – each is buffered whole. */
export const DECK_UPLOADS_IN_FLIGHT = 2;
/** All accounts together: bounds the memory of parallel uploads (up to 200 MB each, copied). */
export const DECK_UPLOADS_IN_FLIGHT_TOTAL = 4;

const uploadSlots = new WeakMap<AppDeps, ReturnType<typeof createUploadSlot>>();

function createUploadSlot() {
  const byUser = new Map<string, number>();
  let total = 0;
  return createMiddleware<ViewerEnv>(async (c, next) => {
    const userId = c.var.viewer.author.id;
    const running = byUser.get(userId) ?? 0;
    if (running >= DECK_UPLOADS_IN_FLIGHT || total >= DECK_UPLOADS_IN_FLIGHT_TOTAL) {
      c.header('Retry-After', '5');
      throw new ApiError(
        429,
        'rate_limited',
        running >= DECK_UPLOADS_IN_FLIGHT
          ? 'Deine anderen Präsentationen werden noch hochgeladen. Bitte warte einen Moment.'
          : 'Gerade werden viele Präsentationen gleichzeitig hochgeladen. Bitte versuch es gleich noch einmal.',
      );
    }
    byUser.set(userId, running + 1);
    total += 1;
    try {
      await next();
    } finally {
      total -= 1;
      const left = (byUser.get(userId) ?? 1) - 1;
      if (left > 0) byUser.set(userId, left);
      else byUser.delete(userId);
    }
  });
}

/**
 * Caps deck files in flight, per account and in total, shared by `POST /decks/upload` and
 * `POST /decks/:id/revisions`. Goes after the access check and {@link importLimit} and before
 * `bodyLimit`, so a refused request is never buffered.
 */
export function deckUploadSlot(deps: AppDeps) {
  let slot = uploadSlots.get(deps);
  if (!slot) {
    slot = createUploadSlot();
    uploadSlots.set(deps, slot);
  }
  return slot;
}
