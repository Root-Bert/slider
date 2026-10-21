import type { DeckStatus } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api-client';
import {
  isGoneError,
  STATUS_POLL_MS,
  STATUS_POLL_PENDING_MS,
  STATUS_POLL_RENDERING_MS,
  statusPollInterval,
} from './status';

const withStatus = (data: Partial<DeckStatus> | undefined, error: unknown = null) => ({
  state: { data: data as DeckStatus | undefined, error },
});
const idle = { sync: { pending: false } } as Partial<DeckStatus>;

describe('statusPollInterval', () => {
  const bulk = { queuedMs: STATUS_POLL_MS };

  it('polls fast only while the deck is actually being rendered', () => {
    const running = { ...idle, rendering: { status: 'running', done: 2, total: 9 } } as const;
    expect(statusPollInterval(withStatus(running), bulk)).toBe(STATUS_POLL_RENDERING_MS);
  });

  it('polls a deck that only waits in the serial render queue slowly', () => {
    const queued = { ...idle, rendering: { status: 'queued', done: 0, total: 0 } } as const;
    expect(statusPollInterval(withStatus(queued), bulk)).toBe(STATUS_POLL_MS);
    expect(statusPollInterval(withStatus(queued), { queuedMs: STATUS_POLL_PENDING_MS })).toBe(
      STATUS_POLL_PENDING_MS,
    );
  });

  it('keeps the idle and pending-sync intervals', () => {
    expect(statusPollInterval(withStatus(idle), bulk)).toBe(STATUS_POLL_MS);
    const pending = { sync: { pending: true } } as Partial<DeckStatus>;
    expect(statusPollInterval(withStatus(pending), bulk)).toBe(STATUS_POLL_PENDING_MS);
  });

  it('stops polling a deck that is gone (4xx), but not after a server hiccup', () => {
    const running = { ...idle, rendering: { status: 'running', done: 0, total: 1 } } as const;
    expect(
      statusPollInterval(withStatus(running, new ApiError(404, 'not_found', 'Weg')), bulk),
    ).toBe(false);
    expect(
      statusPollInterval(withStatus(running, new ApiError(503, 'bad_request', 'Kurz weg')), bulk),
    ).toBe(STATUS_POLL_RENDERING_MS);
  });
});

describe('isGoneError', () => {
  it('treats deleted / forbidden as final, timeouts and rate limits not', () => {
    expect(isGoneError(new ApiError(404, 'not_found', 'Weg'))).toBe(true);
    expect(isGoneError(new ApiError(403, 'forbidden', 'Nein'))).toBe(true);
    expect(isGoneError(new ApiError(408, 'internal', 'Zu langsam'))).toBe(false);
    expect(isGoneError(new ApiError(429, 'rate_limited', 'Zu viele'))).toBe(false);
    expect(isGoneError(new ApiError(503, 'internal', 'Kurz weg'))).toBe(false);
  });
});
