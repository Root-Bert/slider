import { MAX_SLIDES, PptxError } from '@slider/pptx';
import { parseNextcloudLink, type SyncError, type SyncErrorCode } from '@slider/shared';
import { googleDriveConnectUrl } from '../auth/google';
import type { DeckRow } from '../db/schema';
import { ApiError } from '../http/errors';
import { ImportCrashLoop } from '../import/attempts';
import { PdfTimedOut } from '../import/pdf-jobs';

/**
 * Maps whatever went wrong during an automatic update to a {@link SyncError} with a German
 * banner text (BER-107). The deck always keeps its last good revision, and the messages say so.
 */

export const SYNC_MESSAGES = {
  auth_required:
    'Die Verbindung zu Microsoft ist abgelaufen. Melde dich erneut an, damit Slider Änderungen an der PowerPoint übernimmt. Bis dahin siehst du die letzte Version.',
  nextcloud_auth_required:
    'Die Verbindung zu Nextcloud ist getrennt. Verbinde dein Nextcloud-Konto erneut, damit Slider Änderungen an der PowerPoint übernimmt. Bis dahin siehst du die letzte Version.',
  google_auth_required:
    'Slider darf die Datei in Google Drive nicht mehr lesen. Verbinde dein Google-Konto erneut, damit Slider Änderungen übernimmt. Bis dahin siehst du die letzte Version.',
  consent_required:
    'Deine Organisation erlaubt Slider keinen Zugriff mehr auf die Datei. Eine Administratorin oder ein Administrator muss Slider einmalig freigeben (Admin-Zustimmung). Bis dahin siehst du die letzte Version.',
  not_configured:
    'Die Microsoft-Anmeldung ist auf diesem Server nicht mehr eingerichtet – automatische Aktualisierung ist pausiert.',
  access_revoked:
    'Slider hat keinen Zugriff mehr auf die Datei – die Freigabe wurde vermutlich entfernt. Es bleibt die letzte Version sichtbar.',
  not_found: 'Die Datei wurde gelöscht oder verschoben. Slider zeigt weiter die letzte Version.',
  unreachable: 'Die Quelle ist gerade nicht erreichbar. Slider versucht es automatisch erneut.',
  not_a_powerpoint: 'Unter dem Link liegt keine PowerPoint-Datei und kein PDF mehr.',
  internal: 'Aktualisierung fehlgeschlagen. Slider versucht es später erneut.',
} satisfies Partial<
  Record<SyncErrorCode | 'nextcloud_auth_required' | 'google_auth_required', string>
>;

/** Banner of a deck archived because the file is in the OneDrive of someone who left. */
export const OWNER_LEFT_MESSAGE =
  'Die PowerPoint liegt im OneDrive einer Person, die nicht mehr im Workspace ist. Slider aktualisiert die Präsentation nicht mehr – es bleibt die letzte Version sichtbar.';

/** The same for a file in the Nextcloud of someone who left. */
export const NEXTCLOUD_OWNER_LEFT_MESSAGE =
  'Die PowerPoint liegt in der Nextcloud einer Person, die nicht mehr im Workspace ist. Slider aktualisiert die Präsentation nicht mehr, es bleibt die letzte Version sichtbar.';

/** The same for a file in the Google Drive of someone who left. */
export const GOOGLE_OWNER_LEFT_MESSAGE =
  'Die Präsentation liegt im Google Drive einer Person, die nicht mehr im Workspace ist. Slider aktualisiert sie nicht mehr, es bleibt die letzte Version sichtbar.';

const SOURCE_NAMES: Record<DeckRow['source'], string> = {
  onedrive: 'OneDrive',
  sharepoint: 'SharePoint',
  nextcloud: 'Nextcloud',
  google: 'Google Drive',
  url: 'der Quelle',
  upload: 'der Quelle',
};

/**
 * Banner of a deck whose new version doesn't fit into the workspace's storage (BER-151): it
 * waits, and the next check after something was deleted takes it over by itself.
 */
export const storageFullMessage = (deck: Pick<DeckRow, 'source'>) =>
  `Speicher voll – neue Versionen aus ${SOURCE_NAMES[deck.source]} werden erst wieder übernommen, wenn Platz frei ist.`;

/** The owner-left banner in the words of the deck's source. */
export const ownerLeftMessage = (deck: Pick<DeckRow, 'source'>) =>
  deck.source === 'nextcloud'
    ? NEXTCLOUD_OWNER_LEFT_MESSAGE
    : deck.source === 'google'
      ? GOOGLE_OWNER_LEFT_MESSAGE
      : OWNER_LEFT_MESSAGE;

const PARSE_MESSAGES: Record<PptxError['code'], string> = {
  corrupt:
    'Die neue Version ist beschädigt und konnte nicht gelesen werden. Es bleibt die letzte Version sichtbar.',
  encrypted:
    'Die neue Version ist passwortgeschützt und kann nicht gelesen werden. Es bleibt die letzte Version sichtbar.',
  not_pptx:
    'Die neue Version ist keine PowerPoint-Datei (.pptx). Es bleibt die letzte Version sichtbar.',
  too_many_slides: `Die neue Version hat mehr als ${MAX_SLIDES} Folien – so große Decks können wir nicht übernehmen. Es bleibt die letzte Version sichtbar.`,
};

/** Errors that are probably temporary: shown only after a few failures in a row. */
export const TRANSIENT_SYNC_ERRORS: ReadonlySet<SyncErrorCode> = new Set(['unreachable']);

/**
 * Where the owner signs in again; comes back to the deck. With the deck's connection, Microsoft
 * preselects that account (`connection=` → `login_hint`).
 */
export const deckLoginUrl = (deckId: string, connectionId?: string | null) =>
  `/api/auth/microsoft/login?returnTo=${encodeURIComponent(`/d/${deckId}`)}${
    connectionId ? `&connection=${encodeURIComponent(connectionId)}` : ''
  }`;

/** Where the owner connects their Nextcloud again (`/konto`); comes back to the deck. */
export const nextcloudDeckLoginUrl = (deckId: string, server: string) =>
  `/konto?nextcloud=${encodeURIComponent(server)}&returnTo=${encodeURIComponent(`/d/${deckId}`)}`;

/** The sign-in that fixes `auth_required` for this deck: Microsoft, Nextcloud or Google. */
export function loginUrlOfDeck(
  deck: Pick<DeckRow, 'id' | 'source' | 'sourceRef' | 'microsoftConnectionId'> & {
    googleConnectionId?: string | null;
  },
): string {
  if (deck.source === 'google') {
    return googleDriveConnectUrl(`/d/${deck.id}`, deck.googleConnectionId);
  }
  if (deck.source === 'nextcloud' && deck.sourceRef) {
    let server: string | undefined;
    try {
      server = parseNextcloudLink(new URL(deck.sourceRef))?.base;
    } catch {
      // Not a URL: fall through.
    }
    if (server) return nextcloudDeckLoginUrl(deck.id, server);
  }
  return deckLoginUrl(deck.id, deck.microsoftConnectionId);
}

/** `null` means "unexpected" – the caller logs it. */
function mapCode(error: unknown): { code: SyncErrorCode; message: string } | null {
  if (error instanceof PptxError) {
    return { code: 'parse_failed', message: PARSE_MESSAGES[error.code] };
  }
  if (!(error instanceof ApiError)) return null;
  switch (error.code) {
    case 'microsoft_login_required':
      return { code: 'auth_required', message: SYNC_MESSAGES.auth_required };
    case 'nextcloud_login_required':
      return { code: 'auth_required', message: SYNC_MESSAGES.nextcloud_auth_required };
    case 'google_login_required':
      return { code: 'auth_required', message: SYNC_MESSAGES.google_auth_required };
    case 'google_not_configured':
      return { code: 'not_configured', message: error.message };
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
  {
    connectionId,
    loginUrl,
  }: {
    connectionId?: string | null;
    /** Where to sign in instead of Microsoft (see {@link loginUrlOfDeck}). */
    loginUrl?: string;
  } = {},
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
      ...(code === 'auth_required'
        ? { loginUrl: loginUrl ?? deckLoginUrl(deckId, connectionId) }
        : {}),
    },
    expected: mapped !== null,
  };
}

/** The banner text for a new file that cannot be parsed. */
export const parseFailedMessage = (error: unknown): string =>
  error instanceof PptxError
    ? PARSE_MESSAGES[error.code]
    : error instanceof ImportCrashLoop
      ? CRASH_LOOP_MESSAGE
      : error instanceof PdfTimedOut
        ? PDF_TIMEOUT_MESSAGE
        : SYNC_MESSAGES.internal;

const PDF_TIMEOUT_MESSAGE =
  'Die neue Version zu lesen hat zu lange gedauert – sie ist vermutlich zu aufwendig. Es bleibt die letzte Version sichtbar.';

const CRASH_LOOP_MESSAGE =
  'Die neue Version ist zu groß oder beschädigt – ihr Import wurde mehrmals abgebrochen. Es bleibt die letzte Version sichtbar.';
