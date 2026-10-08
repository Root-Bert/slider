import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { accentColor } from '@/lib/accent';
import { formatRelativeTime, pluralize } from '@/lib/format';
import { AvatarStack, Icon, IconButton } from '@/ui';
import type { Thread } from '../lib/comment-selectors';
import { locationLabel } from '../lib/labels';
import { collapseReplies } from '../lib/replies';
import { isChangedSinceComment } from '../lib/revision-changes';
import { useRevisionData } from '../state/revision-data';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { ReplyComposer } from './ReplyComposer';
import { ResolveButton } from './ResolveButton';
import { ChangedSinceCommentNote } from './RevisionNotes';
import { ThreadMessage } from './ThreadMessage';
import { GuestCommentHint } from '../components/GuestCommentHint';

/** Thread side panel (B4) – a bottom sheet on phones. */
export function ThreadPanel() {
  const { threadPanelOpen, focusedThreadId } = useViewerState();
  const { threadById } = useViewerData();
  const thread = focusedThreadId ? threadById.get(focusedThreadId) : undefined;
  if (!threadPanelOpen || !thread) return null;
  return <ThreadPanelView key={thread.id} thread={thread} />;
}

function ThreadPanelView({ thread }: { thread: Thread }) {
  const { deck, viewer, canComment, slideIndex } = useViewerData();
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
  const location = deletedSlide
    ? `Gelöschte Folie ${deletedSlide.previousPosition + 1}`
    : locationLabel(root.anchor, root.slideId, (id) => slideIndex.get(id));
  const changedSince = isChangedSinceComment(root, modifiedAt);
  const canManage = (comment: Thread['root']) =>
    comment.source === 'app' && comment.author.id === viewer.author.id;

  // Focus moves into the panel; the thread's slide becomes active and comes into view (gap
  // threads: the slide before the gap).
  const homeSlideId =
    root.slideId ??
    (root.anchor.type === 'gap' ? (root.anchor.afterSlideId ?? root.anchor.beforeSlideId) : null);
  const homeOnTrack = homeSlideId !== null && slideIndex.has(homeSlideId);
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
      historyRef.current?.scrollTo({ top: historyRef.current.scrollHeight, behavior: 'smooth' });
    previousCount.current = replyCount;
  }, [replyCount]);

  const close = () => dispatch({ type: 'threadPanelClosed' });

  return (
    <aside
      ref={panelRef}
      // Target of the connector line from the focused thread (B4).
      data-thread-panel
      tabIndex={-1}
      aria-labelledby={titleId}
      style={{ '--card-accent': accentColor(root.author.color) } as CSSProperties}
      className={[
        'glass-elevated fixed z-40 flex flex-col outline-none',
        'transition-transform duration-300 ease-out',
        // Phone: bottom sheet.
        'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-panel starting:translate-y-full',
        // Tablet and up: right side panel.
        'md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[400px] md:rounded-none md:starting:translate-x-full md:starting:translate-y-0',
      ].join(' ')}
    >
      <header className="flex flex-col gap-2.5 border-b border-hairline px-5 pt-[18px] pb-3.5">
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
      </header>

      <div
        ref={historyRef}
        // The connector rail (B4) ends at the root message, or at this edge once it scrolled away.
        data-thread-history
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pt-3.5 pb-4"
      >
        <ThreadMessage
          comment={root}
          deckId={deck.id}
          isRoot
          canManage={canManage(root)}
          onDeleted={close}
        />
        {hidden > 0 && (
          <div className="mt-2.5 flex items-center gap-1.5 pl-[26px]">
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="-ml-1 inline-flex items-center gap-1.5 rounded-badge px-1 py-0.5 text-xs font-medium text-fg-muted hover:bg-white/10 hover:text-fg"
            >
              <Icon name="expandMore" size={16} />
              {hidden === 1 ? '1 frühere Antwort anzeigen' : `${hidden} frühere Antworten anzeigen`}
            </button>
            <span className="ml-auto text-[11px] text-white/40">Älteste zuerst</span>
          </div>
        )}
        {visible.length > 0 && (
          // Figma 112:623: 2px thread rail at x=25, replies start at x=39.
          <ol aria-label="Antworten" className="relative mt-2.5 flex flex-col gap-2 pl-[39px]">
            <span
              aria-hidden
              className="absolute inset-y-0 left-[25px] w-0.5 rounded-full bg-white/12"
            />
            {visible.map((reply) => (
              <li key={reply.id}>
                <ThreadMessage
                  comment={reply}
                  deckId={deck.id}
                  isRoot={false}
                  canManage={canManage(reply)}
                />
              </li>
            ))}
          </ol>
        )}
        {root.source === 'pptx' && (
          <p className="mt-3 text-[11px] text-fg-faint">
            Antworten bleiben in Slider – die PowerPoint-Datei wird nicht verändert.
          </p>
        )}
      </div>

      {canComment ? (
        <ReplyComposer root={root} deckId={deck.id} />
      ) : (
        viewer.kind === 'guest' && <GuestCommentHint deckId={deck.id} className="m-3 mt-0" />
      )}
    </aside>
  );
}
