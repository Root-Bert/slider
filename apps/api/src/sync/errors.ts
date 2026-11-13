import { MAX_SLIDES, PptxError } from '@slider/pptx';
import { parseNextcloudLink, type SyncError, type SyncErrorCode } from '@slider/shared';
import type { DeckRow } from '../db/schema';
import { ApiError } from '../http/errors';
import { ImportCrashLoop } from '../import/attempts';
import { PdfTimedOut } from '../import/pdf-jobs';

/**
 * Maps whatever went wrong while pulling a deck's file to a {@link SyncError} with a German
 * banner text (BER-107). The deck always keeps its last good revision, and the messages say so.
 */

export const SYNC_MESSAGES = {
  nextcloud_auth_required:
    'Die Verbindung zu Nextcloud ist getrennt. Verbinde dein Nextcloud-Konto erneut, um neue Versionen der Datei zu holen. Bis dahin siehst du die letzte Version.',
  access_revoked:
    'Slider hat keinen Zugriff mehr auf die Datei – die Freigabe wurde vermutlich entfernt. Es bleibt die letzte Version sichtbar.',
  not_found: 'Die Datei wurde gelöscht oder verschoben. Slider zeigt weiter die letzte Version.',
  unreachable: 'Die Quelle ist gerade nicht erreichbar. Versuche es später noch einmal.',
  not_a_powerpoint: 'Unter dem Link liegt keine PowerPoint-Datei und kein PDF mehr.',
  internal: 'Die neue Version konnte nicht geholt werden. Versuche es später noch einmal.',
} satisfies Partial<Record<SyncErrorCode | 'nextcloud_auth_required', string>>;

/** Banner of a deck archived because the file is in the Nextcloud of someone who left. */
export const NEXTCLOUD_OWNER_LEFT_MESSAGE =
  'Die Präsentation liegt in der Nextcloud einer Person, die nicht mehr im Workspace ist. Neue Versionen der Datei lassen sich nicht mehr holen, es bleibt die letzte Version sichtbar.';

/** The same for a file elsewhere (old OneDrive, SharePoint or Google decks among them). */
export const OWNER_LEFT_MESSAGE =
  'Die Präsentation gehört einer Person, die nicht mehr im Workspace ist. Neue Versionen der Datei lassen sich nicht mehr holen, es bleibt die letzte Version sichtbar.';

// Old OneDrive, SharePoint and Google decks keep their source (enum) but are no longer synced.
const SOURCE_NAMES: Record<DeckRow['source'], string> = {
  onedrive: 'der Quelle',
  sharepoint: 'der Quelle',
  nextcloud: 'Nextcloud',
  google: 'der Quelle',
  url: 'der Quelle',
  upload: 'der Quelle',
};

/**
 * Banner of a deck whose new version doesn't fit into the workspace's storage (BER-151): it
 * waits until something was deleted or the plan upgraded.
 */
export const storageFullMessage = (deck: Pick<DeckRow, 'source'>) =>
  `Speicher voll – neue Versionen aus ${SOURCE_NAMES[deck.source]} lassen sich erst wieder holen, wenn Platz frei ist.`;

/** The owner-left banner in the words of the deck's source. */
export const ownerLeftMessage = (deck: Pick<DeckRow, 'source'>) =>
  deck.source === 'nextcloud' ? NEXTCLOUD_OWNER_LEFT_MESSAGE : OWNER_LEFT_MESSAGE;

const PARSE_MESSAGES: Record<PptxError['code'], string> = {
  corrupt:
    'Die neue Version ist beschädigt und konnte nicht gelesen werden. Es bleibt die letzte Version sichtbar.',
  encrypted:
    'Die neue Version ist passwortgeschützt und kann nicht gelesen werden. Es bleibt die letzte Version sichtbar.',
  not_pptx:
    'Die neue Version ist keine PowerPoint-Datei (.pptx). Es bleibt die letzte Version sichtbar.',
  too_many_slides: `Die neue Version hat mehr als ${MAX_SLIDES} Folien – so große Decks können wir nicht übernehmen. Es bleibt die letzte Version sichtbar.`,
};

/** Where the owner connects their Nextcloud again (`/konto`); comes back to the deck. */
export const nextcloudDeckLoginUrl = (deckId: string, server: string) =>
  `/konto?nextcloud=${encodeURIComponent(server)}&returnTo=${encodeURIComponent(`/d/${deckId}`)}`;

/** The sign-in that fixes `auth_required` for this deck: its Nextcloud, if it has one. */
export function loginUrlOfDeck(
  deck: Pick<DeckRow, 'id' | 'source' | 'sourceRef'>,
): string | undefined {
  if (deck.source === 'nextcloud' && deck.sourceRef) {
    let server: string | undefined;
    try {
      server = parseNextcloudLink(new URL(deck.sourceRef))?.base;
    } catch {
      // Not a URL: fall through.
    }
    if (server) return nextcloudDeckLoginUrl(deck.id, server);
  }
  return undefined;
}

/** `null` means "unexpected" – the caller logs it. */
function mapCode(error: unknown): { code: SyncErrorCode; message: string } | null {
  if (error instanceof PptxError) {
    return { code: 'parse_failed', message: PARSE_MESSAGES[error.code] };
  }
  if (!(error instanceof ApiError)) return null;
  switch (error.code) {
    case 'nextcloud_login_required':
      return { code: 'auth_required', message: SYNC_MESSAGES.nextcloud_auth_required };
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
    loginUrl,
  }: {
    /** Where to sign in again (see {@link loginUrlOfDeck}). */
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
      ...(code === 'auth_required' && loginUrl ? { loginUrl } : {}),
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
