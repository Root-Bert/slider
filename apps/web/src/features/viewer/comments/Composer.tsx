import { MAX_COMMENT_BODY_LENGTH, MAX_COMMENT_IMAGES, type Comment } from '@slider/shared';
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { isApplePlatform } from '@/lib/platform';
import { useCreateComment, useDeleteComment } from '@/lib/api';
import {
  Avatar,
  Button,
  cn,
  ErrorText,
  Icon,
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
import { useAskAi } from '../editing/hooks/useAskAi';
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
  const ai = useAskAi();
  const [body, setBody] = useState(draft.initialBody ?? '');
  const [tab, setTab] = useState<MediaKindId>('text');
  // The text tab's mic: a voice comment, the text its note (text and audio are one tab).
  const [voice, setVoice] = useState(false);
  // The mic starts recording at once; reached by Tab it waits for Space, so Tab can go on.
  const [voiceAutoStart, setVoiceAutoStart] = useState(true);
  // Reached by Tab, not started yet: the mic beside the field turns into "Aufnehmen".
  const voiceArmed = voice && !voiceAutoStart;
  const micRef = useRef<HTMLButtonElement>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
  // The video's start beside the field, like the mic: counted up per click.
  const [videoStart, setVideoStart] = useState(0);
  // Dropping a video remounts its recorder: a fresh take, the picture source kept.
  const [videoTake, setVideoTake] = useState(0);
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
  // Taken apart in 3D the slide shows more of itself: the popover can be pushed aside by its
  // handle, while it is open (a margin – its place and the following stay as they are).
  const [pushed, setPushed] = useState({ x: 0, y: 0 });
  const push = useRef<{ x: number; y: number; from: { x: number; y: number } } | null>(null);
  const movable = useViewerState().layersOpen && !narrow;
  const onHandleDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    push.current = { x: event.clientX, y: event.clientY, from: pushed };
  };
  const onHandleMove = (event: ReactPointerEvent<HTMLElement>) => {
    const start = push.current;
    if (!start) return;
    setPushed({
      x: start.from.x + event.clientX - start.x,
      y: start.from.y + event.clientY - start.y,
    });
  };
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
  const imageTab = tab === 'image';
  // The mic beside the field: a voice comment on the text tab, a memo to the sketch on the image tab.
  const recorderKind =
    tab === 'video' ? 'video' : (tab === 'text' || imageTab) && voice ? 'audio' : null;
  // The recording is the comment – the sketch's memo only goes along with it.
  const recordingTab = tab === 'video' || (tab === 'text' && voice);
  // The sketch's memo records (or pauses): sending now would leave it behind.
  const memoRunning = imageTab && recordingRunning;
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
  const canSend = submission !== null && !images.busy && !sketchTooMany && !memoRunning;
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
    setVoiceAutoStart(true);
    setRecording(null);
    setRecordingRunning(false);
  };

  // On video the recorder is always there: the mic starts it, and is on once something runs.
  const videoOn = tab === 'video' && (recording !== null || recordingRunning);
  const micOn = tab === 'video' ? videoOn : voice;
  const micLabel =
    tab === 'video'
      ? 'Videoaufnahme starten'
      : imageTab
        ? 'Sprachmemo zur Skizze aufnehmen'
        : 'Sprachkommentar aufnehmen';
  const micOffLabel = tab === 'video' ? 'Videoaufnahme verwerfen' : 'Sprachaufnahme verwerfen';
  const micTitle =
    tab === 'video'
      ? 'Aufnahme starten (Leertaste)'
      : imageTab
        ? 'Sprachmemo aufnehmen'
        : 'Sprachmemo aufnehmen (Tab)';
  const toggleVideo = () => {
    if (!videoOn) {
      setVideoStart((count) => count + 1);
      return;
    }
    setVideoTake((take) => take + 1);
    setRecording(null);
    setRecordingRunning(false);
  };

  // Tab walks the kinds in a loop: comment → Memo → Video → Skizze → comment, from the comment
  // field, the recorder or the sheet (after the text on the slide, which Tab leaves for the comment
  // field). Once something is recorded or drawn, Tab moves the focus on as usual – nothing is
  // dropped by it; Esc and ⌘↵ work all along.
  const onFormKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.defaultPrevented || event.key !== 'Tab' || event.shiftKey) return;
    if (isModKey(event) || event.altKey || event.nativeEvent.isComposing) return;
    if (recording !== null || recordingRunning || sketch !== null) return;
    const target = event.target instanceof Element ? event.target : null;
    if (tab === 'text' && !voice && target === commentRef.current) {
      event.preventDefault();
      setVoice(true);
      setVoiceAutoStart(false);
    } else if (voiceArmed && target === micRef.current) {
      event.preventDefault();
      switchTab('video');
    } else if (recordingTab && target?.closest('[data-recorder]')) {
      event.preventDefault();
      switchTab(recorderKind === 'audio' ? 'video' : 'image');
    } else if (imageTab && target?.closest('[data-sketch]') && !target.closest('dialog')) {
      event.preventDefault();
      switchTab('text');
      focusFieldNext.current = true;
    }
  };
  useEffect(() => {
    if (voiceArmed) micRef.current?.focus();
  }, [voiceArmed]);
  // Back on the comment after the sheet: the field takes the focus the sheet had.
  const focusFieldNext = useRef(false);
  useEffect(() => {
    if (!focusFieldNext.current) return;
    focusFieldNext.current = false;
    commentRef.current?.focus();
  }, [tab]);

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
  // last control), typing writes the comment. Inside, Tab walks the kinds (`onFormKeyDown`) or
  // moves the focus as usual.
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

  // Enter sends the comment; ⌘↵ sends it and asks the AI to change the slide (BER-183).
  const submit = (event?: FormEvent, { askAi = false } = {}) => {
    event?.preventDefault();
    if (!submission || !canSend || pending) return;
    const input = { slideId: draft.slideId, parentId: null, ...submission };
    const onSuccess = (comment: Comment) => {
      // The comment carries the drawing now; the bare one goes.
      if (draft.commentId) deleteComment.mutate({ commentId: draft.commentId });
      dispatch({ type: 'draftSubmitted' });
      if (askAi) ai.ask(comment);
    };
    const drawn = imageTab ? sketch : null;
    const memo = recorderKind ? recording : null;
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
      onKeyDown={onFormKeyDown}
      className={cn(
        'glass-elevated fixed z-(--z-popover) flex w-[min(340px,calc(100vw-24px))] animate-pop-in flex-col gap-3 rounded-panel p-3',
        // The sheet to draw on needs room.
        imageTab && 'w-[min(440px,calc(100vw-24px))]',
        narrow && 'inset-x-3 bottom-24 w-auto',
      )}
      style={
        {
          ...(narrow ? {} : { left: placement?.left ?? 0, top: placement?.top ?? 0 }),
          ...(movable ? { marginLeft: pushed.x, marginTop: pushed.y } : {}),
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
        {movable && (
          <span
            data-composer-handle
            title="Verschieben"
            className="ml-auto flex shrink-0 cursor-grab touch-none self-start rounded-thumb p-0.5 text-fg-subtle hover:text-fg-muted active:cursor-grabbing"
            onPointerDown={onHandleDown}
            onPointerMove={onHandleMove}
            onPointerUp={() => (push.current = null)}
            onPointerCancel={() => (push.current = null)}
          >
            <Icon name="dragIndicator" size={14} />
          </span>
        )}
      </header>

      <MediaTabs value={tab} onChange={switchTab} />

      {imageTab && (
        <SketchPanel
          deckId={deck.id}
          color={author.color}
          authorName={author.name}
          aspect={sketchAspect}
          onChange={setSketch}
          autoFocus
          withMemo={false}
          actions={{ canSend, pending, onSend: () => submit(), onCancel: cancel }}
        />
      )}

      {recorderKind && !voiceArmed && (
        // Remount per kind: switching tabs turns the previous device off. The mic starts at once.
        <RecorderPanel
          key={`${recorderKind}-${videoTake}`}
          kind={recorderKind}
          deckId={deck.id}
          onChange={setRecording}
          onRecordingChange={setRecordingRunning}
          autoStart={recorderKind === 'audio' && voiceAutoStart}
          autoFocus
          startButton={recorderKind === 'audio'}
          startRequest={videoStart}
        />
      )}

      <div className="flex items-end gap-2">
        <div className="field-well focus-field relative min-w-0 flex-1 rounded-control-sm px-3 py-2">
          <MentionMenu mentions={mentions} />
          <MentionTextarea
            {...mentions.fieldProps}
            ref={commentRef}
            // While drawing or writing on the slide, keep focus there (⌘Z undoes strokes).
            // A saved drawing's comment is typed right away.
            autoFocus={
              forDrawing ||
              (draft.strokes.length === 0 &&
                !onSlideText &&
                !recordingTab &&
                !imageTab &&
                !freshBox)
            }
            aria-label="Kommentar"
            onPaste={images.onPaste}
            maxLength={MAX_COMMENT_BODY_LENGTH}
            placeholder={
              recordingTab
                ? 'Optional: Notiz zur Aufnahme'
                : imageTab
                  ? 'Optional: Notiz zur Skizze'
                  : onSlideText
                    ? 'Optional: Kommentar zum Text auf der Folie'
                    : draft.strokes.length > 0 && !forDrawing
                      ? 'Optional: Kommentar zur Zeichnung'
                      : 'Was fällt dir auf?'
            }
            value={body}
            onKeyDown={(event) => {
              if (mentions.onKeyDown(event)) return;
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                // Shift+Enter adds a line.
                event.preventDefault();
                submit(undefined, { askAi: isModEnter(event) });
                return;
              }
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
        {/* Right of the field, so a voice memo is as near at hand as typing. */}
        {voiceArmed ? (
          <Button
            ref={micRef}
            size="sm"
            icon="mic"
            title="Aufnahme starten (Leertaste)"
            disabled={pending}
            onClick={() => setVoiceAutoStart(true)}
            className="mb-0.5"
          >
            Aufnehmen
          </Button>
        ) : (
          // One mic in every kind: it records (the video too), pressed it drops the take again.
          <IconButton
            ref={micRef}
            icon="mic"
            label={micOn ? micOffLabel : micLabel}
            title={micOn ? micOffLabel : micTitle}
            // White like its "Aufnehmen" form; the pressed look while recording.
            variant={micOn ? 'subtle' : 'primary'}
            size="sm"
            active={micOn}
            disabled={pending}
            onClick={tab === 'video' ? toggleVideo : toggleVoice}
            className="mb-0.5"
          />
        )}
      </div>

      {memoRunning && sketch !== null && (
        <p role="status" className="text-caption text-fg-subtle">
          Beende erst die Aufnahme – dann kannst du senden.
        </p>
      )}

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
        </div>
        <div className="flex items-center gap-1">
          {ai.available && draft.slideId !== null && (
            <IconButton
              icon="autoAwesome"
              label="Senden und die KI die Folie ändern lassen"
              title={`Senden und an die KI geben (${isApplePlatform() ? '⌘' : 'Strg'}↵)`}
              size="sm"
              disabled={!canSend || pending}
              onClick={() => submit(undefined, { askAi: true })}
            />
          )}
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
