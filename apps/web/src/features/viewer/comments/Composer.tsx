import { MAX_COMMENT_BODY_LENGTH, MAX_COMMENT_IMAGES } from '@slider/shared';
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
import { useCreateComment, useDeleteComment } from '@/lib/api';
import {
  Avatar,
  Button,
  cn,
  ErrorText,
  IconButton,
  Kbd,
  Notice,
  ReturnKey,
  useIsNarrow,
} from '@/ui';
import { accentAlpha } from '@/lib/accent';
import { isTypingTarget } from '@/lib/dom';
import { MediaTabs } from './MediaTabs';
import type { MediaKindId } from './lib/media-kinds';
import { RecorderPanel } from '../media/RecorderPanel';
import { DEFAULT_SKETCH_ASPECT, exportSketch } from '../media/lib/sketch';
import { SketchPanel, type Sketch } from '../media/SketchPanel';
import { AttachedImages, AttachImageButton } from '../media/AttachedImages';
import { useCreateMediaComment } from '../media/hooks/useMediaComment';
import { asUploads, useImageAttachments } from '../media/hooks/useImageAttachments';
import type { Recording } from '../media/hooks/useRecorder';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { useComposerPosition } from './hooks/useComposerPosition';
import { useFloatingFollow } from './hooks/useFloatingFollow';
import { useMentions } from './hooks/useMentions';
import { locationLabel } from './lib/labels';
import { draftSubmission } from '../stage/lib/text-box';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState, type Draft } from '../state/viewer-state';
import { draftHasContent } from '../state/draft-reducer';
import { useViewerToast } from '../state/viewer-toast';
import { useHoldUnsavedWork } from '../lib/unsaved-work';
import { MentionMenu } from './MentionMenu';
import { MentionTextarea } from './MentionTextarea';
import { isModEnter, isModKey, typesCharacter } from '@/lib/keyboard';

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
  // The text tab's mic: a voice comment, the text its note (text and audio are one tab).
  const [voice, setVoice] = useState(false);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [sketch, setSketch] = useState<Sketch | null>(null);
  // Pasted or picked images (BER-174), in every kind of comment – like its note. A drawn sketch
  // takes one of the places.
  const images = useImageAttachments(sketch === null ? 0 : 1);
  const attached = images.attachments.length > 0;
  // A recording running or paused: not in `recording` until it is stopped.
  const [recordingRunning, setRecordingRunning] = useState(false);
  const showToast = useViewerToast();
  const popoverRef = useRef<HTMLFormElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);
  const narrow = useIsNarrow();
  const placement = useComposerPosition(narrow ? null : draft, popoverRef);
  // Measured right away, shown floating after the mark – it hovers over the slide.
  useFloatingFollow(popoverRef, placement);
  const titleId = useId();
  // The sheet takes the commented slide's format.
  const sketchAspect =
    slides.find((slide) => slide.id === draft.slideId)?.aspectRatio ?? DEFAULT_SKETCH_ASPECT;
  const mentions = useMentions(body, setBody, commentRef);
  // Closed (sent, Esc): back to what had the focus, e.g. the drawing's badge.
  useRestoreFocus();

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
  const recorderKind = tab === 'video' ? 'video' : tab === 'text' && voice ? 'audio' : null;
  const recordingTab = recorderKind !== null;
  const imageTab = tab === 'image';
  // A box just drawn: the first keys are typed into it on the slide (`DraftMark`), not here.
  const freshBox =
    draft.anchor.type === 'rect' && !draft.anchorFromStrokes && draft.strokes.length === 0;
  // Commenting on a saved drawing: the drawing alone is already there, so it needs text.
  const forDrawing = draft.commentId !== null;
  const textSubmission =
    forDrawing && body.trim() === '' ? null : draftSubmission(draft, body, author.color);
  // With a recording or images, text and drawing are optional: that is the comment (BER-116).
  const mediaReady = attached || (recordingTab ? recording !== null : imageTab && sketch !== null);
  // The slide left the deck (new revision) or is hidden now: nothing to send it to.
  const submission = draft.slideGone
    ? null
    : mediaReady
      ? (textSubmission ?? { body: body.trim(), anchor: draft.anchor, strokes: draft.strokes })
      : recordingTab || imageTab
        ? null
        : textSubmission;
  // Ten images attached on the text tab leave no place for a sketch drawn after.
  const sketchTooMany =
    imageTab && sketch !== null && images.attachments.length >= MAX_COMMENT_IMAGES;
  // An image still turning into a PNG would be left out: sent once it's there.
  const canSend = submission !== null && !images.busy && !sketchTooMany;
  const pending = createComment.isPending || createMediaComment.isPending;
  const error = createComment.error ?? createMediaComment.error;
  const subtitle =
    draft.anchor.type === 'gap'
      ? locationLabel(draft.anchor, null, (id) => slideIndex.get(id))
      : `${forDrawing ? 'Kommentar zur Zeichnung' : 'Neuer Kommentar'} | ${locationLabel(draft.anchor, draft.slideId, (id) => slideIndex.get(id))}`;

  const switchTab = (next: MediaKindId) => {
    setTab(next);
    setVoice(false);
    setRecording(null);
    setSketch(null);
    setRecordingRunning(false);
  };

  const toggleVoice = () => {
    setVoice((on) => !on);
    setRecording(null);
    setRecordingRunning(false);
  };

  // What only the composer holds keeps the draft from being replaced by a click on another slide
  // (`keepsDraft`) – and, with the draft's own strokes and slide text, from leaving unasked.
  const held =
    body.trim() !== '' ||
    recording !== null ||
    recordingRunning ||
    sketch !== null ||
    attached ||
    pending;
  useEffect(() => {
    dispatch({ type: 'draftHeld', held });
  }, [dispatch, held]);
  useHoldUnsavedWork(held || draftHasContent(draft));
  // A click that would have started another comment was ignored: say why.
  const nudge = draft.nudge ?? 0;
  useEffect(() => {
    if (nudge > 0) showToast('Dein Kommentar ist noch offen – sende oder verwirf ihn zuerst.');
  }, [nudge, showToast]);

  // Focus outside the composer – after a click on the slide: Tab moves into it (Shift+Tab to its
  // last control), typing writes the comment. Inside, Tab moves the focus as usual – the kinds
  // switch with ←/→ on their tabs – so nothing (a recording, a sketch) is dropped by a key press.
  // A fresh box takes the keys itself (`DraftMark`).
  const onWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || isTypingTarget(event.target)) return;
    if (freshBox) return;
    const target = event.target instanceof Element ? event.target : null;
    // Dialogs, and the Bild sheet while a box is selected (typing writes into the box).
    if (target?.closest('dialog, [data-sketch-keys]')) return;
    if (event.key === 'Tab') {
      if (isModKey(event) || event.altKey) return;
      const popover = popoverRef.current;
      if (!popover || (target && popover.contains(target))) return;
      const stops = tabStops(popover);
      const stop = event.shiftKey ? stops.at(-1) : stops[0];
      if (!stop) return;
      event.preventDefault();
      stop.focus();
      return;
    }
    // Space stays with buttons and the recorder.
    const field = commentRef.current;
    if (!typesCharacter(event) || event.key === ' ' || !field) return;
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

  const cancel = () => {
    // Unmounting aborts the upload too; Esc relies on that (BER-116).
    createMediaComment.cancel();
    dispatch({ type: 'draftCancelled' });
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!submission || !canSend || pending) return;
    const input = { slideId: draft.slideId, parentId: null, ...submission };
    const onSuccess = () => {
      // The comment carries the drawing now; the bare one goes.
      if (draft.commentId) deleteComment.mutate({ commentId: draft.commentId });
      dispatch({ type: 'draftSubmitted' });
    };
    const drawn = imageTab ? sketch : null;
    const memo = recordingTab ? recording : (drawn?.memo ?? null);
    const pictures = [
      ...(drawn ? [() => exportSketch(drawn.strokes, sketchAspect)] : []),
      ...asUploads(images.attachments),
    ];
    if (memo || pictures.length > 0)
      createMediaComment.mutate({ input, recording: memo, images: pictures }, { onSuccess });
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
        'glass-elevated fixed z-(--z-popover) flex w-[min(340px,calc(100vw-24px))] animate-pop-in flex-col gap-3 rounded-panel p-3',
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
          <span className="text-xs font-medium text-fg">
            {author.name} <span className="font-normal text-fg-subtle">jetzt</span>
          </span>
          {/* Names the dialog: what it is, not who writes ("Neuer Kommentar | Folie 3"). */}
          <span id={titleId} className="truncate text-caption text-fg-subtle">
            {subtitle}
          </span>
        </div>
      </header>

      <MediaTabs value={tab} onChange={switchTab} />

      {recorderKind && (
        // Remount per kind: switching tabs turns the previous device off. The mic starts at once.
        <RecorderPanel
          key={recorderKind}
          kind={recorderKind}
          deckId={deck.id}
          onChange={setRecording}
          onRecordingChange={setRecordingRunning}
          autoStart={recorderKind === 'audio'}
          autoFocus
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
          actions={{ canSend, pending, onSend: () => submit(), onCancel: cancel }}
        />
      )}

      <div className="field-well focus-field relative rounded-control-sm px-3 py-2">
        <MentionMenu mentions={mentions} />
        <MentionTextarea
          {...mentions.fieldProps}
          ref={commentRef}
          // While drawing or writing on the slide, keep focus there (⌘Z undoes strokes).
          // A saved drawing's comment is typed right away.
          autoFocus={
            forDrawing ||
            (draft.strokes.length === 0 && !onSlideText && !recordingTab && !imageTab && !freshBox)
          }
          aria-label="Kommentar"
          onPaste={images.onPaste}
          maxLength={MAX_COMMENT_BODY_LENGTH}
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
            if (isModEnter(event)) submit();
            if (event.key !== 'Tab' || !event.shiftKey || isModKey(event) || event.altKey) return;
            // Shift+Tab goes back to the text on the slide; otherwise Tab moves on as usual.
            const slideText =
              tab === 'text'
                ? document.querySelector<HTMLTextAreaElement>('[data-text-editor] textarea')
                : null;
            if (!slideText) return;
            event.preventDefault();
            slideText.focus();
          }}
          className="text-body leading-5 text-fg"
        />
        <AttachedImages attachments={images.attachments} onRemove={images.remove} />
      </div>

      {sketchTooMany && (
        <ErrorText role="alert" size="xs">
          Höchstens {MAX_COMMENT_IMAGES} Bilder pro Kommentar – entferne ein Bild, um die Skizze zu
          senden.
        </ErrorText>
      )}

      {images.error && (
        <ErrorText role="alert" size="xs">
          {images.error}
        </ErrorText>
      )}

      {draft.slideGone && (
        <Notice variant="tinted" tone="warning" size="sm" role="alert">
          {draft.anchor.type === 'gap'
            ? 'Die Folien um diese Lücke sind in der aktuellen Version nicht mehr zu sehen.'
            : 'Diese Folie ist in der aktuellen Version nicht mehr zu sehen.'}{' '}
          Senden geht so nicht mehr – kopiere deinen Text, bevor du abbrichst.
        </Notice>
      )}

      {error && (
        <ErrorText role="alert" size="xs">
          {error.message}
        </ErrorText>
      )}

      <footer className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={cancel}>
            Abbrechen
          </Button>
          <AttachImageButton
            onPick={(files) => void images.attach(files)}
            busy={images.busy}
            disabled={pending || images.room === 0}
          />
          {tab === 'text' && (
            <IconButton
              icon="mic"
              label={voice ? 'Sprachaufnahme verwerfen' : 'Sprachkommentar aufnehmen'}
              variant="subtle"
              size="sm"
              active={voice}
              disabled={pending}
              onClick={toggleVoice}
            />
          )}
        </div>
        <div className="flex items-center gap-1">
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
                <Kbd className="-mr-1 hidden text-on-primary/55 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-on-primary)_15%,transparent)] group-hover:inline-flex group-focus-visible:inline-flex max-sm:hidden max-sm:group-hover:hidden">
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

/** The elements Tab stops at, in order (roving tabs: only the selected one). */
function tabStops(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href], [tabindex]',
    ),
  ].filter((element) => element.tabIndex >= 0);
}
