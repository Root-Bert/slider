import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  useDeckStatus,
  useDeletedSlides,
  useInvalidateRevision,
  useInvalidateSlideImages,
  useLatestDiff,
} from '@/lib/api';
import { threadsByDeletedSlide } from '../comments/lib/comment-selectors';
import { slideBadges } from '../revisions/lib/revision-changes';
import {
  markRevisionSeen,
  seenRevision,
  shouldAnnounceRevision,
} from '../revisions/lib/seen-revisions';
import {
  isDeckLinked,
  RevisionDataContext,
  type RevisionAnnouncement,
  type RevisionData,
} from './revision-data';
import { useViewerData } from './viewer-data';
import { useViewerDispatch } from './viewer-state';

/**
 * Keeps the open deck current (BER-107): polls the cheap status endpoint while the tab is
 * visible (and on focus), reloads deck, slides and comments when a new revision shows up, and
 * provides what that revision changed – badges, deleted slides, the "V5 geladen" notice.
 */
export function RevisionProvider({ children }: { children: ReactNode }) {
  const { deck, slides, threads } = useViewerData();
  const dispatch = useViewerDispatch();
  const deckId = deck.id;
  const revisionId = deck.currentRevisionId ?? null;
  const hasHistory = deck.revisionNumber > 1;

  const status = useDeckStatus(deckId);
  const diff = useLatestDiff(deckId, revisionId, hasHistory);
  const deleted = useDeletedSlides(deckId, revisionId, hasHistory);
  const invalidate = useInvalidateRevision(deckId);

  // A newer revision on the server: reload everything that belongs to a revision – once per number.
  const statusRevision = status.data?.revisionNumber;
  const reloadedFor = useRef(deck.revisionNumber);
  useEffect(() => {
    // Reloaded by other means already (e.g. after uploading a new version).
    reloadedFor.current = Math.max(reloadedFor.current, deck.revisionNumber);
  }, [deck.revisionNumber]);
  useEffect(() => {
    if (statusRevision === undefined || statusRevision <= reloadedFor.current) return;
    reloadedFor.current = statusRevision;
    void invalidate();
  }, [statusRevision, invalidate]);

  // Slide images re-rendered in the background (BER-94): the old files are gone, reload the list.
  const renderedAt = status.data?.renderedAt;
  const renderedSeen = useRef<string | null | undefined>(undefined);
  const invalidateImages = useInvalidateSlideImages(deckId);
  useEffect(() => {
    if (renderedAt === undefined) return;
    const seen = renderedSeen.current;
    renderedSeen.current = renderedAt;
    if (seen !== undefined && renderedAt !== null && renderedAt !== seen) void invalidateImages();
  }, [renderedAt, invalidateImages]);

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
    // The Änderungshinweise stay as set – the notice's "Änderungen ansehen" turns them on.
    setAnnouncement({ revisionNumber: current, summary });
  }, [deck.revisionNumber, deckId, summary]);
  // The summary may arrive after the number (status poll vs deck refetch).
  const shownAnnouncement = useMemo(
    () =>
      announcement && announcement.revisionNumber === deck.revisionNumber && !announcement.summary
        ? { ...announcement, summary }
        : announcement,
    [announcement, deck.revisionNumber, summary],
  );

  const badges = useMemo(
    () => (hasHistory ? slideBadges(slides, diff.data) : new Map()),
    [hasHistory, slides, diff.data],
  );
  const deletedSlides = useMemo(() => deleted.data ?? [], [deleted.data]);
  // The panel lists the deleted slides: once the current revision has none (a sync brought them
  // back), close it – else its empty side strip would stay, with nothing left to close it by.
  const noneDeleted =
    deleted.data !== undefined && !deleted.isPlaceholderData && deleted.data.length === 0;
  useEffect(() => {
    if (noneDeleted) dispatch({ type: 'deletedPanelSet', open: false });
  }, [noneDeleted, dispatch]);
  const deletedThreads = useMemo(
    () =>
      threadsByDeletedSlide(
        threads,
        deletedSlides.map((slide) => slide.slideId),
        slides,
      ),
    [deletedSlides, threads, slides],
  );

  const value = useMemo<RevisionData>(
    () => ({
      revisionNumber: deck.revisionNumber,
      sync: status.data?.sync ?? deck.sync ?? null,
      isLinked: isDeckLinked({ sync: deck.sync, source: deck.source }),
      badges,
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
      deletedSlides,
      deletedThreads,
      shownAnnouncement,
    ],
  );

  return <RevisionDataContext value={value}>{children}</RevisionDataContext>;
}
