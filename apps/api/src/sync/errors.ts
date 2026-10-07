import { PptxError } from '@slider/pptx';
import type { SyncError, SyncErrorCode } from '@slider/shared';
import { ApiError } from '../http/errors';

/**
 * Maps whatever went wrong during an automatic update to a {@link SyncError} with a German
 * banner text (BER-107). The deck always keeps its last good revision, and the messages say so.
 */

export const SYNC_MESSAGES = {
  auth_required:
    'Die Verbindung zu Microsoft ist abgelaufen. Melde dich erneut an, damit Slider Änderungen an der PowerPoint übernimmt. Bis dahin siehst du die letzte Version.',
  consent_required:
    'Deine Organisation erlaubt Slider keinen Zugriff mehr auf die Datei. Eine Administratorin oder ein Administrator muss Slider einmalig freigeben (Admin-Zustimmung). Bis dahin siehst du die letzte Version.',
  not_configured:
    'Die Microsoft-Anmeldung ist auf diesem Server nicht mehr eingerichtet – automatische Aktualisierung ist pausiert.',
  access_revoked:
    'Slider hat keinen Zugriff mehr auf die Datei – die Freigabe wurde vermutlich entfernt. Es bleibt die letzte Version sichtbar.',
  not_found: 'Die Datei wurde gelöscht oder verschoben. Slider zeigt weiter die letzte Version.',
  unreachable: 'Die Quelle ist gerade nicht erreichbar. Slider versucht es automatisch erneut.',
  not_a_powerpoint: 'Unter dem Link liegt keine PowerPoint-Datei mehr.',
  internal: 'Aktualisierung fehlgeschlagen. Slider versucht es später erneut.',
} satisfies Partial<Record<SyncErrorCode, string>>;

const PARSE_MESSAGES: Record<PptxError['code'], string> = {
  corrupt:
    'Die neue Version ist beschädigt und konnte nicht gelesen werden. Es bleibt die letzte Version sichtbar.',
  encrypted:
    'Die neue Version ist passwortgeschützt und kann nicht gelesen werden. Es bleibt die letzte Version sichtbar.',
  not_pptx:
    'Die neue Version ist keine PowerPoint-Datei (.pptx). Es bleibt die letzte Version sichtbar.',
};

/** Errors that are probably temporary: shown only after a few failures in a row. */
export const TRANSIENT_SYNC_ERRORS: ReadonlySet<SyncErrorCode> = new Set(['unreachable']);

/** Where the owner signs in again; comes back to the deck. */
export const deckLoginUrl = (deckId: string) =>
  `/api/auth/microsoft/login?returnTo=${encodeURIComponent(`/d/${deckId}`)}`;

/** `null` means "unexpected" – the caller logs it. */
function mapCode(error: unknown): { code: SyncErrorCode; message: string } | null {
  if (error instanceof PptxError) {
    return { code: 'parse_failed', message: PARSE_MESSAGES[error.code] };
  }
  if (!(error instanceof ApiError)) return null;
  switch (error.code) {
    case 'microsoft_login_required':
      return { code: 'auth_required', message: SYNC_MESSAGES.auth_required };
    case 'microsoft_consent_required':
      return { code: 'consent_required', message: SYNC_MESSAGES.consent_required };
    case 'microsoft_not_configured':
      return { code: 'not_configured', message: SYNC_MESSAGES.not_configured };
    case 'source_forbidden':
    case 'forbidden':
      return { code: 'access_revoked', message: SYNC_MESSAGES.access_revoked };
    case 'source_not_found':
    case 'unsupported_link':
    case 'not_found':
      return { code: 'not_found', message: SYNC_MESSAGES.not_found };
    case 'source_unreachable':
      return { code: 'unreachable', message: SYNC_MESSAGES.unreachable };
    case 'not_a_powerpoint':
      return { code: 'not_a_powerpoint', message: SYNC_MESSAGES.not_a_powerpoint };
    case 'file_too_large':
      return { code: 'file_too_large', message: error.message };
    default:
      return null;
  }
}

export function toSyncError(
  error: unknown,
  deckId: string,
  now: Date,
): { error: SyncError; expected: boolean } {
  const mapped = mapCode(error);
  const { code, message } = mapped ?? {
    code: 'internal' as const,
    message: SYNC_MESSAGES.internal,
  };
  return {
    error: {
      code,
      message,
      at: now.toISOString(),
      ...(code === 'auth_required' ? { loginUrl: deckLoginUrl(deckId) } : {}),
    },
    expected: mapped !== null,
  };
}

/** The banner text for a new file that cannot be parsed. */
export const parseFailedMessage = (error: unknown): string =>
  error instanceof PptxError ? PARSE_MESSAGES[error.code] : SYNC_MESSAGES.internal;
