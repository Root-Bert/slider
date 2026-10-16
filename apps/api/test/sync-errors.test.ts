import { describe, expect, it } from 'vitest';
import { PptxError } from '@slider/pptx';
import {
  ApiError,
  badRequest,
  fileTooLarge,
  forbidden,
  notAPowerPoint,
  notFound,
} from '../src/http/errors';
import {
  microsoftConsentRequired,
  microsoftLoginRequired,
  microsoftNotConfigured,
  sourceForbidden,
  sourceNotFound,
  sourceUnreachable,
} from '../src/sources/errors';
import { deckLoginUrl, parseFailedMessage, SYNC_MESSAGES, toSyncError } from '../src/sync/errors';

const NOW = new Date(Date.UTC(2026, 9, 16, 12));

describe('toSyncError', () => {
  it.each([
    [microsoftConsentRequired(), 'consent_required'],
    [microsoftNotConfigured(), 'not_configured'],
    [sourceForbidden(), 'access_revoked'],
    [forbidden(), 'access_revoked'],
    [sourceNotFound(), 'not_found'],
    [new ApiError(400, 'unsupported_link', 'x'), 'not_found'],
    [notFound(), 'not_found'],
    [sourceUnreachable(), 'unreachable'],
    [notAPowerPoint(), 'not_a_powerpoint'],
  ] as const)('maps %s to %s with the banner text', (error, code) => {
    const { error: mapped, expected } = toSyncError(error, 'deck-1', NOW);
    expect(expected).toBe(true);
    expect(mapped).toEqual({
      code,
      message: SYNC_MESSAGES[code as keyof typeof SYNC_MESSAGES],
      at: NOW.toISOString(),
    });
  });

  it('links an expired Microsoft login back to the deck', () => {
    const { error, expected } = toSyncError(microsoftLoginRequired('https://x'), 'deck-1', NOW);
    expect(expected).toBe(true);
    expect(error).toEqual({
      code: 'auth_required',
      message: SYNC_MESSAGES.auth_required,
      at: NOW.toISOString(),
      loginUrl: deckLoginUrl('deck-1'),
    });
    expect(deckLoginUrl('deck-1')).toBe('/api/auth/microsoft/login?returnTo=%2Fd%2Fdeck-1');
  });

  it('keeps the size message of a file that grew too large', () => {
    const tooLarge = fileTooLarge(50 * 1024 * 1024);
    expect(toSyncError(tooLarge, 'd', NOW).error).toMatchObject({
      code: 'file_too_large',
      message: tooLarge.message,
    });
  });

  it('maps unreadable files to parse_failed', () => {
    const { error, expected } = toSyncError(new PptxError('encrypted', 'x'), 'd', NOW);
    expect(expected).toBe(true);
    expect(error.code).toBe('parse_failed');
    expect(error.message).toBe(parseFailedMessage(new PptxError('encrypted', 'x')));
  });

  it('reports anything else as unexpected internal error', () => {
    for (const error of [new Error('boom'), 'text', badRequest('nope')]) {
      expect(toSyncError(error, 'd', NOW)).toEqual({
        error: { code: 'internal', message: SYNC_MESSAGES.internal, at: NOW.toISOString() },
        expected: false,
      });
    }
  });
});

describe('parseFailedMessage', () => {
  it('has its own text per PptxError code and falls back to internal', () => {
    const texts = (['corrupt', 'encrypted', 'not_pptx'] as const).map((code) =>
      parseFailedMessage(new PptxError(code, 'x')),
    );
    expect(new Set(texts).size).toBe(3);
    expect(texts[0]).toContain('beschädigt');
    expect(texts[1]).toContain('passwortgeschützt');
    expect(texts[2]).toContain('keine PowerPoint-Datei');
    expect(parseFailedMessage(new Error('x'))).toBe(SYNC_MESSAGES.internal);
  });
});
