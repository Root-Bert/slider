import type { DeletedSlide } from '@slider/shared';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { accentColor } from '@/lib/accent';
import { pluralize } from '@/lib/format';
import { Badge, Button, cn, Icon, IconButton } from '@/ui';
import { SidePanel, SidePanelHeader } from '../components/SidePanel';
import { ReplyComposer } from '../comments/ReplyComposer';
import { ResolveButton } from '../comments/ResolveButton';
import { ThreadMessage } from '../comments/ThreadMessage';
import type { Thread } from '../comments/lib/comment-selectors';
import { slideLabel } from '../comments/lib/labels';
import { LOW_CONFIDENCE } from './lib/revision-changes';
import { useRevisionData } from '../state/revision-data';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/**
 * Side panel (bottom sheet on phones) with every slide that was deleted in a later version:
 * its last image and all its comments, which can still be read, answered and resolved
 * (BER-109 – nothing ever disappears from a review).
 */
export function DeletedSlidesPanel() {
  const { deletedPanelOpen } = useViewerState();
  const { deletedSlides } = useRevisionData();
  if (!deletedPanelOpen || deletedSlides.length === 0) return null;
  return <DeletedSlidesPanelView deletedSlides={deletedSlides} />;
}

function DeletedSlidesPanelView({ deletedSlides }: { deletedSlides: readonly DeletedSlide[] }) {
  const dispatch = useViewerDispatch();
  const { deletedThreads } = useRevisionData();
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const threadCount = [...deletedThreads.values()].reduce((sum, list) => sum + list.length, 0);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <SidePanel ref={panelRef} data-deleted-panel aria-labelledby={titleId}>
      <SidePanelHeader gap="sm">
        <div className="flex items-center gap-2">
          <Icon name="delete" size={20} className="shrink-0 text-fg-muted" />
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            Gelöschte Folien ({deletedSlides.length})
          </h2>
          <IconButton
            icon="close"
            label="Schließen (Esc)"
            size="sm"
            onClick={() => dispatch({ type: 'deletedPanelSet', open: false })}
          />
        </div>
        <p className="text-xs leading-4 text-fg-subtle">
          {threadCount > 0
            ? `${pluralize(threadCount, 'Kommentar bleibt', 'Kommentare bleiben')} erhalten – du kannst sie weiter lesen, beantworten und erledigen.`
            : 'Diese Folien sind in der aktuellen Version nicht mehr enthalten.'}
        </p>
      </SidePanelHeader>
      <ol className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-5 pt-4 pb-6">
        {deletedSlides.map((slide) => (
          <DeletedSlideItem
            key={slide.slideId}
            slide={slide}
            threads={deletedThreads.get(slide.slideId) ?? []}
          />
        ))}
      </ol>
    </SidePanel>
  );
}

function DeletedSlideItem({ slide, threads }: { slide: DeletedSlide; threads: Thread[] }) {
  const uncertain = slide.confidence < LOW_CONFIDENCE;
  const label = slideLabel(slide.previousPosition);
  return (
    <li data-deleted-slide={slide.slideId} className="flex flex-col gap-3">
      <figure className="flex flex-col gap-2">
        <div
          className="relative overflow-hidden rounded-control bg-placeholder ring-hairline"
          style={{ aspectRatio: slide.aspectRatio }}
        >
          <img
            src={slide.imageUrl}
            alt={slide.title ?? label}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="size-full object-contain opacity-80"
          />
        </div>
        <figcaption className="flex flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate text-body font-medium text-fg">
              {label}
              {slide.title && <span className="text-fg-muted"> · {slide.title}</span>}
            </span>
            <Badge tone="danger" className="ml-auto">
              <Icon name="delete" size={12} />
              Gelöscht
            </Badge>
          </span>
          <span className="text-caption text-fg-subtle">
            Zuletzt in Version {slide.lastRevisionNumber} ·{' '}
            {threads.length === 0
              ? 'keine Kommentare'
              : pluralize(threads.length, 'Kommentar', 'Kommentare')}
          </span>
          {uncertain && (
            <span className="mt-1 flex items-start gap-1.5 text-caption leading-4 text-warning">
              <Icon name="warning" size={14} className="mt-px shrink-0" />
              Zuordnung prüfen – vielleicht wurde die Folie stark umgebaut statt gelöscht.
            </span>
          )}
        </figcaption>
      </figure>
      {threads.length > 0 && (
        <ul aria-label={`Kommentare zu ${label}`} className="flex flex-col gap-3">
          {threads.map((thread) => (
            <li key={thread.id}>
              <DeletedThread thread={thread} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** One thread of a deleted slide: root, replies, resolve and an inline reply box. */
function DeletedThread({ thread }: { thread: Thread }) {
  const { deck, canComment } = useViewerData();
  const [replying, setReplying] = useState(false);
  const { root, replies } = thread;

  return (
    <article
      data-deleted-thread={thread.id}
      className={cn(
        'flex flex-col gap-2 transition-opacity',
        root.status === 'done' && 'opacity-60 focus-within:opacity-100 hover:opacity-100',
      )}
      style={{ '--card-accent': accentColor(root.author.color) } as CSSProperties}
    >
      <ThreadMessage comment={root} deckId={deck.id} isRoot />
      {replies.length > 0 && (
        <ol aria-label="Antworten" className="relative flex flex-col gap-2 pl-[39px]">
          <span
            aria-hidden
            className="absolute inset-y-0 left-[25px] w-0.5 rounded-full bg-surface-3"
          />
          {replies.map((reply) => (
            <li key={reply.id}>
              <ThreadMessage comment={reply} deckId={deck.id} isRoot={false} />
            </li>
          ))}
        </ol>
      )}
      {canComment && replying && (
        <div className="pl-[39px]">
          <ReplyComposer
            root={root}
            deckId={deck.id}
            variant="inline"
            autoFocus
            onCancel={() => setReplying(false)}
            onSent={() => setReplying(false)}
          />
        </div>
      )}
      {canComment && (
        <div className="flex items-center gap-2 pl-[39px]">
          {!replying && (
            <Button
              variant="ghost"
              size="sm"
              icon="chatBubble"
              iconSize={16}
              onClick={() => setReplying(true)}
            >
              Antworten
            </Button>
          )}
          <ResolveButton comment={root} deckId={deck.id} variant="chip" />
        </div>
      )}
    </article>
  );
}
