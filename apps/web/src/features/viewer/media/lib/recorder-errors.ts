import type { MediaKind } from '@slider/shared';

/** German copy for a recorder that could not start (permissions, missing or busy devices). */

const DEVICE_NAMES: Record<MediaKind, string> = { audio: 'Mikrofon', video: 'Kamera und Mikrofon' };

export function describeError(error: unknown, kind: MediaKind): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return `Kein Zugriff auf ${DEVICE_NAMES[kind]}. Bitte im Browser erlauben und erneut versuchen.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return `${kind === 'audio' ? 'Kein Mikrofon' : 'Keine Kamera'} gefunden.`;
  if (name === 'NotReadableError')
    return `${DEVICE_NAMES[kind]} wird gerade von einer anderen App benutzt.`;
  return 'Die Aufnahme ist fehlgeschlagen. Bitte erneut versuchen.';
}

/** `null`: the person closed the browser's share dialog – no error, just not shared. */
export function describeScreenError(error: unknown): string | null {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'AbortError') return null;
  if (name === 'NotReadableError')
    return 'Der Bildschirm lässt sich gerade nicht teilen. Bitte erneut versuchen.';
  return 'Bildschirm teilen ist fehlgeschlagen. Bitte erneut versuchen.';
}
