import type {
  DeckSync,
  Revision,
  RevisionDiff,
  Slide,
  SlideChange,
  SlideDiff,
  SyncError,
  SyncErrorCode,
  SyncResult,
  SyncSummary,
} from '@slider/shared';

/**
 * What a new revision changed, in the words of the viewer (BER-107, BER-108, BER-109, BER-114):
 * slide badges, "changed since comment", banner and toast copy. Pure functions.
 */

/** Below this, the matching isn't sure it's the same slide: "Zuordnung prüfen". */
export const LOW_CONFIDENCE = 0.7;

export type SlideBadgeKind = 'new' | 'modified' | 'moved';

export interface SlideBadge {
  kind: SlideBadgeKind;
  /** Short chip text: "Neu", "Geändert", "Verschoben 4→2". */
  label: string;
  /** Text for tiny chips (minimap, phones): "Neu", "Geändert", "4→2" (with the ↔ icon). */
  short: string;
  /** The slide also changed its place (modified slides): show a ↔ next to the chip. */
  moved: boolean;
  /** Matching is unsure – the chip gets a warning and the tooltip asks to check. */
  uncertain: boolean;
  /** Tooltip / accessible description. */
  description: string;
}

const UNCERTAIN_HINT =
  'Zuordnung prüfen – Slider ist nicht ganz sicher, ob das dieselbe Folie wie vorher ist.';

/**
 * Badge of a slide for the latest revision, `null` for unchanged slides and revision 1.
 * `diff` (optional) adds the old and new position to a moved slide's chip.
 */
export function slideBadge(
  change: SlideChange | null | undefined,
  diff?: Pick<SlideDiff, 'position' | 'previousPosition'>,
): SlideBadge | null {
  if (!change || change.status === 'unchanged') return null;
  const uncertain = change.status !== 'new' && change.confidence < LOW_CONFIDENCE;
  const from = diff?.previousPosition;
  const positions = diff && from != null ? ` ${from + 1}→${diff.position + 1}` : '';
  const withHint = (text: string) => (uncertain ? `${text}. ${UNCERTAIN_HINT}` : text);
  switch (change.status) {
    case 'new':
      return {
        kind: 'new',
        label: 'Neu',
        short: 'Neu',
        moved: false,
        uncertain: false,
        description: 'Neue Folie in dieser Version',
      };
    case 'moved':
      return {
        kind: 'moved',
        label: `Verschoben${positions}`,
        short: positions.trim(),
        moved: true,
        uncertain,
        description: withHint(
          positions
            ? `Verschoben von Position${positions.replace('→', ' nach ')}`
            : 'An eine andere Stelle verschoben',
        ),
      };
    case 'modified':
      return {
        kind: 'modified',
        label: 'Geändert',
        short: 'Geändert',
        moved: change.moved,
        uncertain,
        description: withHint(
          change.moved
            ? `Inhalt geändert und verschoben${positions ? ` (Position${positions.replace('→', ' nach ')})` : ''}`
            : 'Inhalt in dieser Version geändert',
        ),
      };
  }
}

/** A slide hidden or shown again in the latest revision – apart from its content badge. */
export interface VisibilityChange {
  kind: 'hidden' | 'shown';
  /** Chip text: "Ausgeblendet", "Wieder eingeblendet". */
  label: string;
  /** Tooltip / accessible description. */
  description: string;
}

/** `null` when the slide's visibility did not change in the latest revision. */
export function visibilityChange(
  change: Pick<SlideChange, 'hiddenChanged'> | null | undefined,
): VisibilityChange | null {
  switch (change?.hiddenChanged) {
    case 'hidden':
      return {
        kind: 'hidden',
        label: 'Ausgeblendet',
        description: 'In dieser Version ausgeblendet',
      };
    case 'shown':
      return {
        kind: 'shown',
        label: 'Wieder eingeblendet',
        description: 'In dieser Version wieder eingeblendet',
      };
    default:
      return null;
  }
}

/** Badges per slide id for the latest revision (slides without a badge are left out). */
export function slideBadges(
  slides: readonly Pick<Slide, 'id' | 'change'>[],
  diff: Pick<RevisionDiff, 'slides'> | null | undefined,
): Map<string, SlideBadge> {
  const diffById = new Map(diff?.slides.map((entry) => [entry.slideId, entry]));
  const result = new Map<string, SlideBadge>();
  for (const slide of slides) {
    const entry = diffById.get(slide.id);
    // The diff is fetched separately; until it arrives the slide's own `change` is enough.
    const badge = slideBadge(entry ?? slide.change, entry);
    if (badge) result.set(slide.id, badge);
  }
  return result;
}

/** The current revision's entry of a revision list (newest first). */
export const currentRevision = (revisions: readonly Revision[] | undefined) =>
  revisions?.find((revision) => revision.isCurrent) ?? null;

// ── Copy ────────────────────────────────────────────────────────────────────

/**
 * Short notice in the version pill after a new revision arrived: "V5 geladen | 3 Folien
 * geändert, 1 neu" (the summary text comes from the server, see `formatSyncSummary`).
 */
export function revisionNoticeText(
  revisionNumber: number,
  summary: SyncSummary | null | undefined,
): string {
  const head = `V${revisionNumber} geladen`;
  return summary?.text ? `${head} | ${summary.text}` : head;
}

export type ToastTone = 'neutral' | 'danger';

/**
 * Toast after "Neue Version hochladen". `null` for a new version: that one is
 * announced by the notice next to the button (`RevisionNotice`), for everybody watching.
 */
export function syncResultMessage(result: SyncResult): { text: string; tone: ToastTone } | null {
  switch (result.status) {
    case 'unchanged':
      return { text: 'Keine Änderungen', tone: 'neutral' };
    case 'updated':
      return null;
    case 'queued':
      return { text: 'Änderung erkannt – wird übernommen …', tone: 'neutral' };
    case 'error':
      return {
        text: result.error?.message ?? 'Die Präsentation konnte nicht aktualisiert werden.',
        tone: 'danger',
      };
  }
}

/**
 * The sync error the banner shows, if any. Only link imports update themselves: a failed
 * upload of an uploaded deck was already reported to its uploader (toast) and has nothing to
 * retry, so it never becomes a banner for everybody. An error older than the last successful
 * update is stale.
 */
export function bannerSyncError(
  sync: Pick<DeckSync, 'lastSyncError' | 'lastSyncAt'> | null | undefined,
  isLinked: boolean,
): SyncError | null {
  const error = sync?.lastSyncError;
  if (!isLinked || !error) return null;
  if (sync.lastSyncAt && Date.parse(sync.lastSyncAt) > Date.parse(error.at)) return null;
  return error;
}

/** Errors the owner can fix by signing in with Microsoft again. */
export const isLoginError = (code: SyncErrorCode) =>
  code === 'auth_required' || code === 'consent_required';

/** Nextcloud decks send the owner to /konto to connect again (BER-135), not to Microsoft. */
export const isNextcloudLogin = (loginUrl: string | undefined) =>
  loginUrl?.startsWith('/konto') ?? false;

/** Google Drive decks connect a Google account again (BER-119). */
export const isGoogleLogin = (loginUrl: string | undefined) =>
  loginUrl?.startsWith('/api/auth/google/') ?? false;

/** The button that fixes a source's `auth_required`. */
export const sourceLoginLabel = (loginUrl: string | undefined) =>
  isNextcloudLogin(loginUrl)
    ? 'Nextcloud verbinden'
    : isGoogleLogin(loginUrl)
      ? 'Google Drive verbinden'
      : 'Mit Microsoft anmelden';

/** Headline of the sync error banner (the server's `message` is the detail line). */
export function syncErrorTitle(code: SyncErrorCode, loginUrl?: string): string {
  switch (code) {
    case 'auth_required':
      return isNextcloudLogin(loginUrl)
        ? 'Anmeldung bei Nextcloud abgelaufen'
        : isGoogleLogin(loginUrl)
          ? 'Verbindung zu Google Drive getrennt'
          : 'Anmeldung bei Microsoft abgelaufen';
    case 'consent_required':
      return 'Zugriff auf OneDrive nicht freigegeben';
    case 'access_revoked':
      return 'Kein Zugriff mehr auf die Präsentation';
    case 'not_found':
      return 'Präsentation nicht mehr gefunden';
    case 'unreachable':
      return 'Quelle gerade nicht erreichbar';
    case 'storage_full':
      return 'Speicher der Organisation voll';
    default:
      return 'Aktualisierung fehlgeschlagen';
  }
}
