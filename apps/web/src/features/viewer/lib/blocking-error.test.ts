import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { blockingError } from './blocking-error';

const offline = new ApiError(0, 'internal', 'Keine Verbindung zum Server.');
const badGateway = new ApiError(502, 'internal', 'Etwas ist schiefgelaufen.');
const gone = new ApiError(404, 'not_found', 'Nicht gefunden');
const revoked = new ApiError(403, 'forbidden', 'Kein Zugriff');

describe('blockingError', () => {
  it('keeps the viewer up when a refetch fails but the data is still there', () => {
    expect(
      blockingError([
        { data: {}, error: null },
        { data: [], error: offline },
        { data: [], error: badGateway },
        { data: [], error: new ApiError(429, 'rate_limited', 'Zu viele Anfragen') },
      ]),
    ).toBeNull();
  });

  it('shows the error when there is nothing to show yet', () => {
    expect(
      blockingError([
        { data: {}, error: null },
        { data: undefined, error: offline },
      ]),
    ).toBe(offline);
  });

  it('shows final answers even with data: the deck is gone or access was revoked', () => {
    expect(blockingError([{ data: {}, error: gone }])).toBe(gone);
    expect(
      blockingError([
        { data: {}, error: null },
        { data: [], error: revoked },
      ]),
    ).toBe(revoked);
  });

  it('takes the first blocking error in order', () => {
    expect(
      blockingError([
        { data: {}, error: offline },
        { data: undefined, error: badGateway },
        { data: {}, error: gone },
      ]),
    ).toBe(badGateway);
  });
});
