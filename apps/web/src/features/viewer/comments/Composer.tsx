import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { isApplePlatform } from '@/lib/platform';
import { useCreateComment, useDeleteComment } from '@/lib/queries';
import { Avatar, Button, cn, Kbd, ReturnKey } from '@/ui';
import { AutosizeTextarea } from '../components/AutosizeTextarea';
import { MediaTabs } from '../components/MediaTabs';
import { MEDIA_KINDS, type MediaKindId } from '../lib/media-kinds';
import { RecorderPanel } from '../media/RecorderPanel';
import { DEFAULT_SKETCH_ASPECT, exportSketch } from '../media/sketch';
import { SketchPanel, type Sketch } from '../media/SketchPanel';
import { useCreateMediaComment } from '../media/useMediaComment';
import type { Recording } from '../media/useRecorder';
import { useComposerPosition } from '../hooks/useComposerPosition';
import { useMentions } from '../hooks/useMentions';
import { useIsNarrow } from '../hooks/useMediaQuery';
import { accentAlpha } from '../lib/colors';
import { isTypingTarget } from '../lib/dom';
import { locationLabel } from '../lib/labels';
import { draftSubmission } from '../lib/text-box';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState, type Draft } from '../state/viewer-state';
import { MentionMenu } from './MentionMenu';

/** Popover for a new comment, anchored next to the draft mark (B2). Rendered only while drafting. */
export function Composer() {
  const { draft } = useViewerState();
  if (!draft) return null;
  // Remount per slide (or for gaps, or per drawing) so text and errors do not leak between drafts.
  return <ComposerPopover key={draft.commentId ?? draft.slideId ?? 'gap'} draft={draft} />;
}

function ComposerPopover({ draft }: { draft: Draft }) {
  const { deck, viewer, slides, slideIndex } = useViewerData();
  const dispatch = useViewerDispatch();
  const createComment = useCreateComment(deck.id);
  const createMediaComment = useCreateMediaComment(deck.id);
  const deleteComment = useDeleteComment(deck.id);
  const [body, setBody] = useState(draft.initialBody ?? '');
  const [tab, setTab] = useState<MediaKindId>('text');
  const [recording, setRecording] = useState<Recording | null>(null);
  const [sketch, setSketch] = useState<Sketch | null>(null);
  const popoverRef = useRef<HTMLFormElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const narrow = useIsNarrow();
  const placement = useComposerPosition(narrow ? null : draft, popoverRef);
  const titleId = useId();
  // The sheet takes the commented slide's format.
  const sketchAspect =
    slides.find((slide) => slide.id === draft.slideId)?.aspectRatio ?? DEFAULT_SKETCH_ASPECT;
  const mentions = useMentions(body, setBody, commentRef);

  // Typed right after drawing: go on after the first characters.
  useEffect(() => {
    const field = commentRef.current;
    if (!draft.initialBody || !field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [draft.initialBody]);

  const { author } = viewer;
  // "Text auf Folie": the text is typed on the slide; the composer adds an optional comment.
  const onSlideText = draft.textBox !== null;
  const recordingTab = tab === 'audio' || tab === 'video';
  const imageTab = tab === 'image';
  // A box just drawn: the first keys are typed into it on the slide (`DraftMark`), not here.
  const freshBox =
    draft.anchor.type === 'rect' && !draft.anchorFromStrokes && draft.strokes.length === 0;
  // Commenting on a saved drawing: the drawing alone is already there, so it needs text.
  const forDrawing = draft.commentId !== null;
  const textSubmission =
    forDrawing && body.trim() === '' ? null : draftSubmission(draft, body, author.color);
  // With a recording or a drawn image, text and drawing are optional: that is the comment (BER-116).
  const mediaReady = recordingTab ? recording !== null : imageTab ? sketch !== null : false;
  const submission = mediaReady
    ? (textSubmission ?? { body: body.trim(), anchor: draft.anchor, strokes: draft.strokes })
    : recordingTab || imageTab
      ? null
      : textSubmission;
  const canSend = submission !== null;
  const pending = createComment.isPending || createMediaComment.isPending;
  const error = createComment.error ?? createMediaComment.error;
  const subtitle =
    draft.anchor.type === 'gap'
      ? locationLabel(draft.anchor, null, (id) => slideIndex.get(id))
      : `${forDrawing ? 'Kommentar zur Zeichnung' : 'Neuer Kommentar'} · ${locationLabel(draft.anchor, draft.slideId, (id) => slideIndex.get(id))}`;

  const switchTab = (next: MediaKindId) => {
    setTab(next);
    setRecording(null);
    setSketch(null);
  };

  /** Tab / Shift+Tab: Text → Audio → Video → Bild → Text; the recorder takes the keys (Space, ↵). */
  const cycleTab = (backwards: boolean) => {
    const kinds = MEDIA_KINDS.map((kind) => kind.id);
    const index = kinds.indexOf(tab);
    const next = kinds[(index + (backwards ? kinds.length - 1 : 1)) % kinds.length] ?? 'text';
    switchTab(next);
    if (next === 'text') commentRef.current?.focus();
  };

  // Focus outside a field – after a click on the slide, or on the sketch or recorder: Tab steps
  // through the kinds, typing writes the comment. A fresh box takes the keys itself (`DraftMark`).
  const onWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey || freshBox) return;
    const target = event.target instanceof Element ? event.target : null;
    // Dialogs, and the Bild sheet while a box is selected (typing writes into the box).
    if (target?.closest('dialog, [data-sketch-keys]')) return;
    if (event.key === 'Tab') {
      // In the composer its panels and controls handle Tab.
      if (target && popoverRef.current?.contains(target)) return;
      event.preventDefault();
      cycleTab(event.shiftKey);
      return;
    }
    // Space stays with buttons and the recorder.
    const field = commentRef.current;
    if (event.key.length !== 1 || event.key === ' ' || !field) return;
    // The key goes on into the field; the viewer's letter shortcuts (F, B, G, H) skip it.
    event.stopPropagation();
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onWindowKeyDown(event);
    // Capture: before the viewer's shortcuts and the panels' own keys.
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!submission || pending) return;
    const input = { slideId: draft.slideId, parentId: null, ...submission };
    const onSuccess = () => {
      // The comment carries the drawing now; the bare one goes.
      if (draft.commentId) deleteComment.mutate({ commentId: draft.commentId });
      dispatch({ type: 'draftSubmitted' });
    };
    if (recordingTab && recording) createMediaComment.mutate({ input, recording }, { onSuccess });
    else if (imageTab && sketch) {
      const { strokes, memo } = sketch;
      createMediaComment.mutate(
        { input, recording: memo, image: () => exportSketch(strokes, sketchAspect) },
        { onSuccess },
      );
    } else createComment.mutate(input, { onSuccess });
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
        // The sheet to draw on needs room.
        imageTab && 'w-[min(440px,calc(100vw-24px))]',
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

      <MediaTabs value={tab} onChange={switchTab} />

      {recordingTab && (
        // Remount per kind: switching tabs turns the previous device off.
        <RecorderPanel
          key={tab}
          kind={tab}
          deckId={deck.id}
          onChange={setRecording}
          autoFocus
          onTab={cycleTab}
        />
      )}

      {imageTab && (
        <SketchPanel
          deckId={deck.id}
          color={author.color}
          authorName={author.name}
          aspect={sketchAspect}
          onChange={setSketch}
          autoFocus
          onTab={cycleTab}
        />
      )}

      <div className="relative rounded-control-sm bg-white/5 px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] focus-within:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.35)]">
        <MentionMenu mentions={mentions} />
        <AutosizeTextarea
          {...mentions.fieldProps}
          ref={commentRef}
          // While drawing or writing on the slide, keep focus there (⌘Z undoes strokes).
          // A saved drawing's comment is typed right away.
          autoFocus={
            forDrawing ||
            (draft.strokes.length === 0 && !onSlideText && !recordingTab && !imageTab && !freshBox)
          }
          aria-label="Kommentar"
          placeholder={
            recordingTab
              ? 'Optional: Notiz zur Aufnahme'
              : imageTab
                ? 'Optional: Notiz zum Bild'
                : onSlideText
                  ? 'Optional: Kommentar zum Text auf der Folie'
                  : draft.strokes.length > 0 && !forDrawing
                    ? 'Optional: Kommentar zur Zeichnung'
                    : 'Was fällt dir auf?'
          }
          value={body}
          onKeyDown={(event) => {
            if (mentions.onKeyDown(event)) return;
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
            if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey) return;
            // Shift+Tab goes back to the text on the slide.
            const slideText =
              event.shiftKey && tab === 'text'
                ? document.querySelector<HTMLTextAreaElement>('[data-text-editor] textarea')
                : null;
            event.preventDefault();
            if (slideText) slideText.focus();
            else cycleTab(event.shiftKey);
          }}
          className="text-[13px] leading-5 text-fg"
        />
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error.message}
        </p>
      )}

      <footer className="flex items-center justify-end gap-2">
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
          <Button
            type="submit"
            size="sm"
            icon="send"
            disabled={!canSend}
            loading={pending}
            title="Esc verwirft den Entwurf"
            className="group"
          >
            {createMediaComment.isPending && createMediaComment.progress < 1 ? (
              `${Math.round(createMediaComment.progress * 100)} %`
            ) : (
              <>
                Senden
                {/* Only on hover / keyboard focus, so the button stays calm. */}
                <Kbd className="-mr-1 hidden text-on-primary/55 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)] group-hover:inline-flex group-focus-visible:inline-flex max-sm:hidden max-sm:group-hover:hidden">
                  {isApplePlatform() ? '⌘' : 'Strg'}
                  <ReturnKey />
                </Kbd>
              </>
            )}
          </Button>
        </div>
      </footer>
    </form>
  );
}
