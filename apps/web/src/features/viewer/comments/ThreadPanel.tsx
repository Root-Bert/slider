import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { accentColor } from '@/lib/accent';
import { smoothScroll } from '@/lib/motion';
import { formatRelativeTime, pluralize } from '@/lib/format';
import { AvatarStack, Button, IconButton, Notice } from '@/ui';
import { SidePanel, SidePanelHeader } from '../components/SidePanel';
import { homeSlideId as threadHomeSlideId, placeGap, type Thread } from './lib/comment-selectors';
import { locationLabel } from './lib/labels';
import { collapseReplies } from './lib/replies';
import { isChangedSinceComment } from '../revisions/lib/revision-changes';
import { useRevisionData } from '../state/revision-data';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { ReplyComposer } from './ReplyComposer';
import { ResolveButton } from './ResolveButton';
import { ChangedSinceCommentNote } from './RevisionNotes';
import { ThreadMessage } from './ThreadMessage';
import { VIEW_ONLY_HINT } from './lib/view-only';

/** Thread side panel (B4) – a bottom sheet on phones. */
export function ThreadPanel() {
  const { threadPanelOpen, focusedThreadId } = useViewerState();
  const { threadById } = useViewerData();
  const thread = focusedThreadId ? threadById.get(focusedThreadId) : undefined;
  if (!threadPanelOpen || !thread) return null;
  return <ThreadPanelView key={thread.id} thread={thread} />;
}

function ThreadPanelView({ thread }: { thread: Thread }) {
  const { deck, canComment, slides, slideIndex } = useViewerData();
  const { modifiedAt, deletedSlides } = useRevisionData();
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();
  const panelRef = useRef<HTMLElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [showAll, setShowAll] = useState(false);
  const { root, replies } = thread;
  const { hidden, visible } = collapseReplies(replies, showAll);
  const deletedSlide = deletedSlides.find((slide) => slide.slideId === root.slideId);
  // A gap comment is named after the gap it sits at now – its neighbours may have moved apart.
  const gap =
    root.anchor.type === 'gap' ? (placeGap(root.anchor, slides, slideIndex) ?? root.anchor) : null;
  const location = deletedSlide
    ? `Gelöschte Folie ${deletedSlide.previousPosition + 1}`
    : locationLabel(gap ? { type: 'gap', ...gap } : root.anchor, root.slideId, (id) =>
        slideIndex.get(id),
      );
  const changedSince = isChangedSinceComment(root, modifiedAt);

  // Focus moves into the panel; the thread's slide becomes active and comes into view (gap
  // threads: the slide before the gap).
  const homeSlideId = threadHomeSlideId(root, slides, slideIndex);
  const homeOnTrack = homeSlideId !== null && slideIndex.has(homeSlideId);
  useRestoreFocus();
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    // A thread of a deleted slide has no slide on the track to show.
    if (!homeSlideId || !homeOnTrack) return;
    dispatch({ type: 'activeSlideChanged', slideId: homeSlideId });
    registry.revealSlide(homeSlideId, { align: 'nearest' });
  }, [registry, dispatch, homeSlideId, homeOnTrack]);

  // A new reply (own or polled) scrolls into view at the bottom of the history.
  const replyCount = replies.length;
  const previousCount = useRef(replyCount);
  useEffect(() => {
    if (replyCount > previousCount.current)
      historyRef.current?.scrollTo({
        top: historyRef.current.scrollHeight,
        behavior: smoothScroll(),
      });
    previousCount.current = replyCount;
  }, [replyCount]);

  const close = () => dispatch({ type: 'threadPanelClosed' });

  return (
    <SidePanel
      ref={panelRef}
      // Target of the connector line from the focused thread (B4).
      data-thread-panel
      aria-labelledby={titleId}
      style={{ '--card-accent': accentColor(root.author.color) } as CSSProperties}
    >
      <SidePanelHeader>
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            Thread · {location}
          </h2>
          {canComment && <ResolveButton comment={root} deckId={deck.id} variant="chip" />}
          <IconButton icon="close" label="Thread schließen (Esc)" size="sm" onClick={close} />
        </div>
        <p className="flex items-center gap-2 text-xs text-fg-subtle">
          <AvatarStack authors={thread.participants} size={18} max={5} />
          <span>
            {pluralize(replies.length, 'Antwort', 'Antworten')} ·{' '}
            {pluralize(thread.participants.length, 'Person', 'Personen')} · zuletzt{' '}
            {formatRelativeTime(thread.lastActivityAt)}
          </span>
        </p>
        {changedSince && (
          <ChangedSinceCommentNote comment={root} deckId={deck.id} canResolve={canComment} />
        )}
      </SidePanelHeader>

      <div
        ref={historyRef}
        // The connector rail (B4) ends at the root message, or at this edge once it scrolled away.
        data-thread-history
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pt-3.5 pb-4"
      >
        <ThreadMessage comment={root} deckId={deck.id} isRoot onDeleted={close} />
        {hidden > 0 && (
          <div className="mt-2.5 flex items-center gap-1.5 pl-[26px]">
            <Button
              variant="ghost"
              size="2xs"
              icon="expandMore"
              onClick={() => setShowAll(true)}
              className="-ml-1.5"
            >
              {hidden === 1 ? '1 frühere Antwort anzeigen' : `${hidden} frühere Antworten anzeigen`}
            </Button>
            <span className="ml-auto text-caption text-fg-subtle">Älteste zuerst</span>
          </div>
        )}
        {visible.length > 0 && (
          // Figma 112:623: 2px thread rail at x=25, replies start at x=39.
          <ol aria-label="Antworten" className="relative mt-2.5 flex flex-col gap-2 pl-[39px]">
            <span
              aria-hidden
              className="absolute inset-y-0 left-[25px] w-0.5 rounded-full bg-surface-3"
            />
            {visible.map((reply) => (
              <li key={reply.id}>
                <ThreadMessage comment={reply} deckId={deck.id} isRoot={false} />
              </li>
            ))}
          </ol>
        )}
        {root.source === 'pptx' && (
          <p className="mt-3 text-caption text-fg-faint">
            Antworten bleiben in Slider – die PowerPoint-Datei wird nicht verändert.
          </p>
        )}
      </div>

      {canComment ? (
        <ReplyComposer root={root} deckId={deck.id} />
      ) : (
        <Notice variant="plain" tone="neutral" icon="visibility" className="m-3 mt-0">
          {VIEW_ONLY_HINT}
        </Notice>
      )}
    </SidePanel>
  );
}
