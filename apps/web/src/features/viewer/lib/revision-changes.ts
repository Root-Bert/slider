import type {
  Comment,
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
import { formatRelativeTime } from '@/lib/format';

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

/** What an earlier revision changed, as far as "Geändert seit Kommentar" needs it. */
export interface RevisionChanges {
  createdAt: string;
  slides: readonly Pick<SlideDiff, 'slideId' | 'status'>[];
}

/**
 * When each slide's content last changed: the newest revision that modified it – the current
 * one (from `slide.change`) or an earlier one (`history`, their diffs). Moved-only and new
 * slides don't count – a comment on them still refers to the same content.
 */
export function slideModifiedAt(
  slides: readonly Pick<Slide, 'id' | 'change'>[],
  revisionCreatedAt: string | null | undefined,
  history: readonly RevisionChanges[] = [],
): Map<string, string> {
  const result = new Map<string, string>();
  const note = (slideId: string, at: string) => {
    const known = result.get(slideId);
    if (known === undefined || Date.parse(at) > Date.parse(known)) result.set(slideId, at);
  };
  for (const revision of history)
    for (const entry of revision.slides)
      if (entry.status === 'modified') note(entry.slideId, revision.createdAt);
  if (revisionCreatedAt)
    for (const slide of slides)
      if (slide.change?.status === 'modified') note(slide.id, revisionCreatedAt);
  return result;
}

/**
 * Earlier revisions whose diff can still flag a comment: ready, not the first or the current
 * one, and made after the oldest open comment (`since`) – older changes can't concern it.
 */
export function revisionsToCheck(
  revisions: readonly Revision[] | undefined,
  since: string | null,
): Revision[] {
  if (!revisions || since === null) return [];
  const from = Date.parse(since);
  return revisions.filter(
    (revision) =>
      !revision.isCurrent &&
      revision.number > 1 &&
      revision.status === 'ready' &&
      Date.parse(revision.createdAt) > from,
  );
}

/** Creation date of the oldest open root comment on a slide, `null` without any. */
export function oldestOpenComment(
  comments: readonly Pick<Comment, 'slideId' | 'parentId' | 'status' | 'createdAt'>[],
): string | null {
  let oldest: string | null = null;
  for (const comment of comments) {
    if (comment.parentId !== null || comment.status !== 'open' || !comment.slideId) continue;
    if (oldest === null || Date.parse(comment.createdAt) < Date.parse(oldest))
      oldest = comment.createdAt;
  }
  return oldest;
}

/**
 * "Geändert seit Kommentar": an open root comment written before its slide was last modified.
 * Done threads, replies and comments deleted in PowerPoint are never flagged.
 */
export function isChangedSinceComment(
  comment: Pick<Comment, 'slideId' | 'parentId' | 'status' | 'createdAt' | 'sourceStatus'>,
  modifiedAt: ReadonlyMap<string, string>,
): boolean {
  if (comment.parentId !== null || comment.status !== 'open' || !comment.slideId) return false;
  // Deleted in PowerPoint: that already says more than "the slide changed".
  if (comment.sourceStatus === 'removed_in_pptx') return false;
  const changed = modifiedAt.get(comment.slideId);
  return changed !== undefined && Date.parse(comment.createdAt) < Date.parse(changed);
}

/** The current revision's entry of a revision list (newest first). */
export const currentRevision = (revisions: readonly Revision[] | undefined) =>
  revisions?.find((revision) => revision.isCurrent) ?? null;

// ── Copy ────────────────────────────────────────────────────────────────────

export interface SummaryChip {
  tone: 'success' | 'warning' | 'info' | 'danger' | 'neutral';
  label: string;
}

/** Coloured slide count chips of a revision summary (Figma D1): "2 neu", "3 geändert", … */
export function summaryChips(summary: SyncSummary | null | undefined): SummaryChip[] {
  if (!summary) return [];
  const chips: SummaryChip[] = [];
  if (summary.slidesNew > 0) chips.push({ tone: 'success', label: `${summary.slidesNew} neu` });
  if (summary.slidesModified > 0)
    chips.push({ tone: 'warning', label: `${summary.slidesModified} geändert` });
  if (summary.slidesMoved > 0)
    chips.push({ tone: 'info', label: `${summary.slidesMoved} verschoben` });
  if (summary.slidesDeleted > 0)
    chips.push({ tone: 'danger', label: `${summary.slidesDeleted} gelöscht` });
  return chips;
}

/**
 * The comment side of a summary as one short line ("1 neuer Kommentar · 3 Kommentare
 * entfernt"), `null` without comment changes. Shown as text next to the slide chips, so the
 * banner stays one compact block.
 */
export function commentChangesText(summary: SyncSummary | null | undefined): string | null {
  if (!summary) return null;
  const parts: string[] = [];
  const add = (count: number, one: string, many: string) => {
    if (count > 0) parts.push(`${count} ${count === 1 ? one : many}`);
  };
  add(summary.commentsNew, 'neuer Kommentar', 'neue Kommentare');
  add(summary.commentsUpdated, 'Kommentar geändert', 'Kommentare geändert');
  add(summary.commentsRemoved, 'Kommentar entfernt', 'Kommentare entfernt');
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Banner headline after a new revision arrived: "Neue Version geladen · 3 Folien geändert, 1 neu". */
export function revisionBannerText(summary: SyncSummary | null | undefined): string {
  return summary ? `Neue Version geladen · ${summary.text}` : 'Neue Version geladen';
}

export type ToastTone = 'neutral' | 'danger';

/** Toast after "Neu laden" / "Neue Version hochladen". */
export function syncResultMessage(result: SyncResult): { text: string; tone: ToastTone } {
  switch (result.status) {
    case 'unchanged':
      return { text: 'Keine Änderungen', tone: 'neutral' };
    case 'updated':
      return {
        text: result.summary
          ? `Neue Version geladen · ${result.summary.text}`
          : 'Neue Version geladen',
        tone: 'neutral',
      };
    case 'queued':
      return { text: 'Änderung erkannt – wird übernommen …', tone: 'neutral' };
    case 'error':
      return {
        text: result.error?.message ?? 'Die Präsentation konnte nicht aktualisiert werden.',
        tone: 'danger',
      };
  }
}

/** Tooltip line of the "Neu laden" button. */
export function lastCheckedLabel(
  sync: Pick<DeckSync, 'lastCheckedAt'> | null | undefined,
  now?: Date,
) {
  if (!sync?.lastCheckedAt) return 'Noch nicht geprüft';
  const relative = formatRelativeTime(sync.lastCheckedAt, now);
  return relative === 'jetzt' ? 'Gerade eben geprüft' : `Zuletzt geprüft ${relative}`;
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

/** Headline of the sync error banner (the server's `message` is the detail line). */
export function syncErrorTitle(code: SyncErrorCode): string {
  switch (code) {
    case 'auth_required':
      return 'Anmeldung bei Microsoft abgelaufen';
    case 'consent_required':
      return 'Zugriff auf OneDrive nicht freigegeben';
    case 'access_revoked':
      return 'Kein Zugriff mehr auf die Präsentation';
    case 'not_found':
      return 'Präsentation nicht mehr gefunden';
    case 'unreachable':
      return 'Quelle gerade nicht erreichbar';
    default:
      return 'Aktualisierung fehlgeschlagen';
  }
}
