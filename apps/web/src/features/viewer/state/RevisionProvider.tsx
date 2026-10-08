import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  useDeckStatus,
  useDeletedSlides,
  useInvalidateRevision,
  useLatestDiff,
  useRevisionDiffs,
  useRevisions,
} from '@/lib/queries';
import type { Thread } from '../lib/comment-selectors';
import {
  currentRevision,
  oldestOpenComment,
  revisionsToCheck,
  slideBadges,
  slideModifiedAt,
  type RevisionChanges,
} from '../lib/revision-changes';
import { markRevisionSeen, seenRevision, shouldAnnounceRevision } from '../lib/seen-revisions';
import { RevisionDataContext, type RevisionAnnouncement, type RevisionData } from './revision-data';
import { useViewerData } from './viewer-data';
import { useViewerDispatch } from './viewer-state';

/**
 * Keeps the open deck current (BER-107): polls the cheap status endpoint while the tab is
 * visible (and on focus), reloads deck, slides and comments when a new revision shows up, and
 * provides what that revision changed – badges, deleted slides, the "Neue Version" banner.
 */
export function RevisionProvider({ children }: { children: ReactNode }) {
  const { deck, slides, threads } = useViewerData();
  const dispatch = useViewerDispatch();
  const deckId = deck.id;
  const revisionId = deck.currentRevisionId ?? null;
  const hasHistory = deck.revisionNumber > 1;

  const status = useDeckStatus(deckId);
  const revisions = useRevisions(deckId, hasHistory);
  const diff = useLatestDiff(deckId, revisionId, hasHistory);
  const deleted = useDeletedSlides(deckId, revisionId, hasHistory);
  const invalidate = useInvalidateRevision(deckId);

  // A newer revision on the server: reload everything that belongs to a revision – once per number.
  const statusRevision = status.data?.revisionNumber;
  const reloadedFor = useRef(deck.revisionNumber);
  useEffect(() => {
    // Reloaded by other means already (e.g. after "Neu laden").
    reloadedFor.current = Math.max(reloadedFor.current, deck.revisionNumber);
  }, [deck.revisionNumber]);
  useEffect(() => {
    if (statusRevision === undefined || statusRevision <= reloadedFor.current) return;
    reloadedFor.current = statusRevision;
    void invalidate();
  }, [statusRevision, invalidate]);

  // Announce a revision that is new to this browser: on opening the deck and live.
  const [announcement, setAnnouncement] = useState<RevisionAnnouncement | null>(null);
  const announcedFor = useRef<number | null>(null);
  const summary = deck.sync?.latestSummary ?? status.data?.sync.latestSummary ?? null;
  useEffect(() => {
    const current = deck.revisionNumber;
    if (announcedFor.current === null) {
      // First render of this deck: compare with what this browser saw last time.
      announcedFor.current = current;
      const seen = seenRevision(deckId);
      markRevisionSeen(deckId, current);
      if (!shouldAnnounceRevision(seen, current)) return;
    } else if (current <= announcedFor.current) {
      return;
    } else {
      announcedFor.current = current;
      markRevisionSeen(deckId, current);
    }
    setAnnouncement({ revisionNumber: current, summary });
    dispatch({ type: 'showChangesSet', show: true });
  }, [deck.revisionNumber, deckId, summary, dispatch]);
  // The summary may arrive after the number (status poll vs deck refetch).
  const shownAnnouncement = useMemo(
    () =>
      announcement && announcement.revisionNumber === deck.revisionNumber && !announcement.summary
        ? { ...announcement, summary }
        : announcement,
    [announcement, deck.revisionNumber, summary],
  );

  const revisionCreatedAt = currentRevision(revisions.data)?.createdAt ?? null;
  const badges = useMemo(
    () => (hasHistory ? slideBadges(slides, diff.data) : new Map()),
    [hasHistory, slides, diff.data],
  );
  // "Geändert seit Kommentar" looks at every revision since the oldest open comment, not just
  // the latest one – a later revision that leaves the slide alone doesn't clear the flag.
  const roots = useMemo(() => threads.map((thread) => thread.root), [threads]);
  const since = useMemo(() => oldestOpenComment(roots), [roots]);
  const earlier = useMemo(() => revisionsToCheck(revisions.data, since), [revisions.data, since]);
  const earlierIds = useMemo(() => earlier.map((revision) => revision.id), [earlier]);
  const earlierDiffs = useRevisionDiffs(deckId, earlierIds);
  const history = useMemo(() => {
    const result: RevisionChanges[] = [];
    earlier.forEach((revision, index) => {
      const entry = earlierDiffs[index];
      if (entry) result.push({ createdAt: revision.createdAt, slides: entry.slides });
    });
    return result;
  }, [earlier, earlierDiffs]);
  const modifiedAt = useMemo(
    () => slideModifiedAt(slides, revisionCreatedAt, history),
    [slides, revisionCreatedAt, history],
  );
  const deletedSlides = useMemo(() => deleted.data ?? [], [deleted.data]);
  const deletedThreads = useMemo(() => {
    const result = new Map<string, Thread[]>(deletedSlides.map((slide) => [slide.slideId, []]));
    for (const thread of threads) {
      const slideId = thread.root.slideId;
      if (slideId) result.get(slideId)?.push(thread);
    }
    return result;
  }, [deletedSlides, threads]);

  const value = useMemo<RevisionData>(
    () => ({
      revisionNumber: deck.revisionNumber,
      sync: status.data?.sync ?? deck.sync ?? null,
      isLinked: deck.sync?.enabled ?? deck.source !== 'upload',
      badges,
      modifiedAt,
      deletedSlides,
      deletedThreads,
      announcement: shownAnnouncement,
      dismissAnnouncement: () => setAnnouncement(null),
    }),
    [
      deck.revisionNumber,
      deck.sync,
      deck.source,
      status.data?.sync,
      badges,
      modifiedAt,
      deletedSlides,
      deletedThreads,
      shownAnnouncement,
    ],
  );

  return <RevisionDataContext value={value}>{children}</RevisionDataContext>;
}
