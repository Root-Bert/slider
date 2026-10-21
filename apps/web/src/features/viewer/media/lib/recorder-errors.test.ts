import { describe, expect, it } from 'vitest';
import { describeError, describeScreenError } from './recorder-errors';

const domError = (name: string) => new DOMException('x', name);

describe('describeError', () => {
  it('explains missing permission per device', () => {
    expect(describeError(domError('NotAllowedError'), 'audio')).toBe(
      'Kein Zugriff auf Mikrofon. Bitte im Browser erlauben und erneut versuchen.',
    );
    expect(describeError(domError('SecurityError'), 'video')).toBe(
      'Kein Zugriff auf Kamera und Mikrofon. Bitte im Browser erlauben und erneut versuchen.',
    );
  });

  it('names a missing or busy device', () => {
    expect(describeError(domError('NotFoundError'), 'audio')).toBe('Kein Mikrofon gefunden.');
    expect(describeError(domError('OverconstrainedError'), 'video')).toBe('Keine Kamera gefunden.');
    expect(describeError(domError('NotReadableError'), 'audio')).toBe(
      'Mikrofon wird gerade von einer anderen App benutzt.',
    );
  });

  it('falls back for anything else', () => {
    const fallback = 'Die Aufnahme ist fehlgeschlagen. Bitte erneut versuchen.';
    expect(describeError(domError('AbortError'), 'audio')).toBe(fallback);
    expect(describeError(new Error('NotAllowedError'), 'audio')).toBe(fallback);
  });
});

describe('describeScreenError', () => {
  it('is no error when the share dialog was closed', () => {
    expect(describeScreenError(domError('NotAllowedError'))).toBeNull();
    expect(describeScreenError(domError('AbortError'))).toBeNull();
  });

  it('explains a failed share', () => {
    expect(describeScreenError(domError('NotReadableError'))).toBe(
      'Der Bildschirm lässt sich gerade nicht teilen. Bitte erneut versuchen.',
    );
    expect(describeScreenError(new Error('x'))).toBe(
      'Bildschirm teilen ist fehlgeschlagen. Bitte erneut versuchen.',
    );
  });
});
