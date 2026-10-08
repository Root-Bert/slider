import { useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useCreateComment } from '@/lib/queries';
import { Avatar, Button, cn } from '@/ui';
import { AutosizeTextarea } from '../components/AutosizeTextarea';
import { MediaTabs } from '../components/MediaTabs';
import { useComposerPosition } from '../hooks/useComposerPosition';
import { useIsNarrow } from '../hooks/useMediaQuery';
import { accentAlpha } from '../lib/colors';
import { locationLabel } from '../lib/labels';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState, type Draft } from '../state/viewer-state';

/** Popover for a new comment, anchored next to the draft mark (B2). Rendered only while drafting. */
export function Composer() {
  const { draft } = useViewerState();
  if (!draft) return null;
  // Remount per slide (or for gaps) so text and errors do not leak between drafts.
  return <ComposerPopover key={draft.slideId ?? 'gap'} draft={draft} />;
}

function ComposerPopover({ draft }: { draft: Draft }) {
  const { deck, viewer, slideIndex } = useViewerData();
  const dispatch = useViewerDispatch();
  const createComment = useCreateComment(deck.id);
  const [body, setBody] = useState('');
  const popoverRef = useRef<HTMLFormElement>(null);
  const narrow = useIsNarrow();
  const placement = useComposerPosition(narrow ? null : draft, popoverRef);
  const titleId = useId();

  const { author } = viewer;
  const canSend = body.trim().length > 0 || draft.strokes.length > 0;
  const subtitle =
    draft.anchor.type === 'gap'
      ? locationLabel(draft.anchor, null, (id) => slideIndex.get(id))
      : `Neuer Kommentar · ${locationLabel(draft.anchor, draft.slideId, (id) => slideIndex.get(id))}`;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend || createComment.isPending) return;
    createComment.mutate(
      {
        slideId: draft.slideId,
        parentId: null,
        body: body.trim(),
        anchor: draft.anchor,
        strokes: draft.strokes,
      },
      { onSuccess: () => dispatch({ type: 'draftSubmitted' }) },
    );
  };

  return (
    <form
      ref={popoverRef}
      role="dialog"
      aria-labelledby={titleId}
      onSubmit={submit}
      className={cn(
        'glass-elevated fixed z-50 flex w-[min(340px,calc(100vw-24px))] animate-pop-in flex-col gap-3 rounded-panel p-3',
        narrow && 'inset-x-3 bottom-24 w-auto',
      )}
      style={
        {
          ...(narrow ? {} : { left: placement?.left ?? 0, top: placement?.top ?? 0 }),
          visibility: narrow || placement ? 'visible' : 'hidden',
          boxShadow: `inset 0 0 0 1px ${accentAlpha(author.color, 90)}, 0 0 32px ${accentAlpha(author.color, 35)}, var(--shadow-float)`,
        } as CSSProperties
      }
    >
      <header className="flex items-center gap-2">
        <Avatar author={author} size={24} />
        <div className="flex min-w-0 flex-col">
          <span id={titleId} className="text-xs font-medium text-fg">
            {author.name} <span className="font-normal text-fg-subtle">jetzt</span>
          </span>
          <span className="truncate text-[11px] text-fg-subtle">{subtitle}</span>
        </div>
      </header>

      <MediaTabs />

      <div className="rounded-control-sm bg-white/5 px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] focus-within:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.35)]">
        <AutosizeTextarea
          // While drawing, keep focus on the stage so ⌘Z undoes strokes.
          autoFocus={draft.strokes.length === 0}
          aria-label="Kommentar"
          placeholder={
            draft.strokes.length > 0 ? 'Optional: Was soll sich ändern?' : 'Was fällt dir auf?'
          }
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
          }}
          className="text-[13px] leading-5 text-fg"
        />
      </div>

      {createComment.isError && (
        <p role="alert" className="text-xs text-danger">
          {createComment.error.message}
        </p>
      )}

      <footer className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg-faint" title="Esc verwirft den Entwurf">
          ⌘↵ zum Senden
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => dispatch({ type: 'draftCancelled' })}>
            Abbrechen
          </Button>
          <Button type="submit" size="sm" disabled={!canSend} loading={createComment.isPending}>
            Senden
          </Button>
        </div>
      </footer>
    </form>
  );
}
