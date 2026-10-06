import { useEffect, useId, useRef } from 'react';
import { formatRelativeTime, pluralize } from '@/lib/format';
import { AvatarStack, IconButton } from '@/ui';
import type { Thread } from '../lib/comment-selectors';
import { locationLabel } from '../lib/labels';
import { useStageRegistry } from '../state/stage-registry';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { ReplyComposer } from './ReplyComposer';
import { ResolveButton } from './ResolveButton';
import { ThreadMessage } from './ThreadMessage';

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
  const dispatch = useViewerDispatch();
  const registry = useStageRegistry();
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const { root, replies } = thread;
  const location = locationLabel(root.anchor, root.slideId, (id) => slideIndex.get(id));
  const canManage = (comment: Thread['root']) =>
    comment.source === 'app' && comment.author.id === viewer.author.id;

  // Focus moves into the panel and the thread's slide comes into view.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    if (root.slideId) registry.scrollToSlide(root.slideId);
  }, [registry, root.slideId]);

  const close = () => dispatch({ type: 'threadPanelClosed' });

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={[
        'glass-elevated fixed z-40 flex flex-col outline-none',
        'transition-transform duration-300 ease-out',
        // Phone: bottom sheet.
        'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-panel starting:translate-y-full',
        // Tablet and up: right side panel.
        'md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[400px] md:rounded-none md:starting:translate-x-full md:starting:translate-y-0',
      ].join(' ')}
    >
      <header className="flex flex-col gap-2 border-b border-hairline px-5 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            Thread · {location}
          </h2>
          {canComment && <ResolveButton comment={root} deckId={deck.id} variant="chip" />}
          <IconButton icon="close" label="Thread schließen (Esc)" size="sm" onClick={close} />
        </div>
        <p className="flex items-center gap-2 text-xs text-fg-subtle">
          <AvatarStack authors={thread.participants} size={16} max={5} />
          <span>
            {pluralize(replies.length, 'Antwort', 'Antworten')} ·{' '}
            {pluralize(thread.participants.length, 'Person', 'Personen')} · zuletzt{' '}
            {formatRelativeTime(thread.lastActivityAt)}
          </span>
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
        <ThreadMessage
          comment={root}
          deckId={deck.id}
          isRoot
          canManage={canManage(root)}
          onDeleted={close}
        />
        {replies.length > 0 && (
          <ol
            aria-label="Antworten"
            className="ml-3 flex flex-col gap-2 border-l border-white/15 pl-3"
          >
            {replies.map((reply) => (
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
          <p className="text-[11px] text-fg-faint">
            Antworten bleiben in Slider – die PowerPoint-Datei wird nicht verändert.
          </p>
        )}
      </div>

      {canComment && <ReplyComposer root={root} deckId={deck.id} />}
    </aside>
  );
}
