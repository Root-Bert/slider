import { useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useCreateComment } from '@/lib/queries';
import { Avatar, Button, cn } from '@/ui';
import { AutosizeTextarea } from '../components/AutosizeTextarea';
import { MediaTabs } from '../components/MediaTabs';
import type { MediaKindId } from '../lib/media-kinds';
import { RecorderPanel } from '../media/RecorderPanel';
import { useCreateMediaComment } from '../media/useMediaComment';
import type { Recording } from '../media/useRecorder';
import { useComposerPosition } from '../hooks/useComposerPosition';
import { useIsNarrow } from '../hooks/useMediaQuery';
import { accentAlpha } from '../lib/colors';
import { locationLabel } from '../lib/labels';
import { draftSubmission } from '../lib/text-box';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState, type Draft } from '../state/viewer-state';

/** Popover for a new comment, anchored next to the draft mark (B2). Rendered only while drafting. */
export function Composer() {
  const { draft } = useViewerState();
  if (!draft) return null;
  // Remount per slide (or for gaps) so text and errors do not leak between drafts; the tool bar's
  // mic and camera reopen it in their tab.
  return (
    <ComposerPopover key={`${draft.slideId ?? 'gap'}:${draft.recordKind ?? ''}`} draft={draft} />
  );
}

function ComposerPopover({ draft }: { draft: Draft }) {
  const { deck, viewer, slideIndex } = useViewerData();
  const dispatch = useViewerDispatch();
  const createComment = useCreateComment(deck.id);
  const createMediaComment = useCreateMediaComment(deck.id);
  const [body, setBody] = useState('');
  const [tab, setTab] = useState<MediaKindId>(draft.recordKind ?? 'text');
  // Opened from the tool bar's mic: recording starts right away.
  const [autoStart, setAutoStart] = useState(draft.recordKind === 'audio');
  const [recording, setRecording] = useState<Recording | null>(null);
  const popoverRef = useRef<HTMLFormElement>(null);
  const narrow = useIsNarrow();
  const placement = useComposerPosition(narrow ? null : draft, popoverRef);
  const titleId = useId();

  const { author } = viewer;
  // "Text auf Folie": the text is typed on the slide; the composer adds an optional comment.
  const onSlideText = draft.textBox !== null;
  const recordingTab = tab === 'audio' || tab === 'video';
  const textSubmission = draftSubmission(draft, body, author.color);
  // With a recording, text and drawing are optional: the recording is the comment (BER-116).
  const submission =
    recordingTab && recording
      ? (textSubmission ?? { body: body.trim(), anchor: draft.anchor, strokes: draft.strokes })
      : recordingTab
        ? null
        : textSubmission;
  const canSend = submission !== null;
  const pending = createComment.isPending || createMediaComment.isPending;
  const error = createComment.error ?? createMediaComment.error;
  const subtitle =
    draft.anchor.type === 'gap'
      ? locationLabel(draft.anchor, null, (id) => slideIndex.get(id))
      : `Neuer Kommentar · ${locationLabel(draft.anchor, draft.slideId, (id) => slideIndex.get(id))}`;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!submission || pending) return;
    const input = { slideId: draft.slideId, parentId: null, ...submission };
    const onSuccess = () => dispatch({ type: 'draftSubmitted' });
    if (recordingTab && recording) createMediaComment.mutate({ input, recording }, { onSuccess });
    else createComment.mutate(input, { onSuccess });
  };

  return (
    <form
      ref={popoverRef}
      // The on-slide text box sends through this form (⌘↵).
      data-composer
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

      <MediaTabs
        value={tab}
        onChange={(next) => {
          setTab(next);
          setRecording(null);
          setAutoStart(false);
        }}
      />

      {recordingTab && (
        // Remount per kind: switching tabs turns the previous device off.
        <RecorderPanel
          key={tab}
          kind={tab}
          deckId={deck.id}
          onChange={setRecording}
          autoStart={autoStart}
        />
      )}

      <div className="rounded-control-sm bg-white/5 px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] focus-within:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.35)]">
        <AutosizeTextarea
          // While drawing or writing on the slide, keep focus there (⌘Z undoes strokes).
          autoFocus={draft.strokes.length === 0 && !onSlideText && !recordingTab}
          aria-label="Kommentar"
          placeholder={
            recordingTab
              ? 'Optional: Notiz zur Aufnahme'
              : onSlideText
                ? 'Optional: Kommentar zum Text auf der Folie'
                : draft.strokes.length > 0
                  ? 'Optional: Was soll sich ändern?'
                  : 'Was fällt dir auf?'
          }
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
            // Shift+Tab goes back to the text on the slide.
            if (event.key === 'Tab' && event.shiftKey && onSlideText) {
              const slideText = document.querySelector<HTMLTextAreaElement>(
                '[data-text-editor] textarea',
              );
              if (!slideText) return;
              event.preventDefault();
              slideText.focus();
            }
          }}
          className="text-[13px] leading-5 text-fg"
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error.message}
        </p>
      )}

      <footer className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg-faint" title="Esc verwirft den Entwurf">
          ⌘↵ zum Senden
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Unmounting aborts the upload too; Esc relies on that (BER-116).
              createMediaComment.cancel();
              dispatch({ type: 'draftCancelled' });
            }}
          >
            Abbrechen
          </Button>
          <Button type="submit" size="sm" disabled={!canSend} loading={pending}>
            {createMediaComment.isPending && createMediaComment.progress < 1
              ? `${Math.round(createMediaComment.progress * 100)} %`
              : 'Senden'}
          </Button>
        </div>
      </footer>
    </form>
  );
}
