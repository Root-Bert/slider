import { MAX_COMMENT_BODY_LENGTH, MAX_COMMENT_IMAGES, type Comment } from '@slider/shared';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { isApplePlatform } from '@/lib/platform';
import { useCreateComment, useDeleteComment } from '@/lib/api';
import {
  Avatar,
  Button,
  cn,
  DeleteButton,
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
import { isUnreachable, useQueueMediaUpload } from '../media/hooks/useQueueMediaUpload';
import { useOnline } from '@/lib/offline';
import { asUploads, useImageAttachments } from '../media/hooks/useImageAttachments';
import type { Recording } from '../media/hooks/useRecorder';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { useComposerPosition } from './hooks/useComposerPosition';
import { usePushAside } from '../hooks/usePushAside';
import { useFloatingFollow } from './hooks/useFloatingFollow';
import { useMentions } from './hooks/useMentions';
import { locationLabel } from './lib/labels';
import { draftSubmission } from '../stage/lib/text-box';
import { SEND_TO_AI } from './lib/composer-focus';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState, type Draft } from '../state/viewer-state';
import { draftHasContent } from '../state/draft-reducer';
import { useViewerToast } from '../state/viewer-toast';
import { useHoldUnsavedWork } from '../lib/unsaved-work';
import { AiBoxComposer } from './AiBoxComposer';
import { useSendAiBox } from './hooks/useSendAiBox';
import { MentionMenu } from './MentionMenu';
import { MentionTextarea } from './MentionTextarea';
import { useAskAi } from '../editing/hooks/useAskAi';
import { isModEnter, isModKey, typesCharacter } from '@/lib/keyboard';

/** Popover for a new comment, anchored next to the draft mark (B2). Rendered only while drafting. */
export function Composer() {
  const { draft } = useViewerState();
  const sendAiBox = useSendAiBox();
  if (!draft) return null;
  // A box drawn while speaking to the AI: its small field, a new one per box.
  if (draft.aiBox !== undefined)
    return <AiBoxComposer key={`ai-${draft.aiBox}`} draft={draft} onSend={sendAiBox} />;
  // Remount per slide (or for gaps, or per drawing) so text and errors do not leak between drafts.
  return <ComposerPopover key={draft.commentId ?? draft.slideId ?? 'gap'} draft={draft} />;
}

function ComposerPopover({ draft }: { draft: Draft }) {
  const { deck, viewer, slides, slideIndex } = useViewerData();
  const dispatch = useViewerDispatch();
  const createComment = useCreateComment(deck.id, viewer.author);
  const createMediaComment = useCreateMediaComment(deck.id);
  const queueMediaComment = useQueueMediaUpload(deck.id, viewer.author);
  const online = useOnline();
  const deleteComment = useDeleteComment(deck.id);
  const ai = useAskAi();
  const [body, setBody] = useState(draft.initialBody ?? '');
  const [tab, setTab] = useState<MediaKindId>('text');
  // The field's mic, as in a messenger: text or a voice memo (the memo takes the field's place).
  const [voice, setVoice] = useState(false);
  const micRef = useRef<HTMLButtonElement>(null);
  const [recording, setRecording] = useState<Recording | null>(null);
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
  // handle and its name, while it is open.
  const { pushed, handle } = usePushAside();
  const movable = useViewerState().layersOpen && !narrow;
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
  // A video is the comment itself: no note goes with it (the field is gone meanwhile). A voice
  // comment keeps the field for a note, as when editing one (`ThreadMessage`).
  const typed = tab === 'video' ? '' : body;
  const textSubmission =
    forDrawing && typed.trim() === '' ? null : draftSubmission(draft, typed, author.color);
  // With a recording or images, text and drawing are optional: that is the comment (BER-116).
  const mediaReady = attached || (recordingTab ? recording !== null : imageTab && sketch !== null);
  // The slide left the deck (new revision) or is hidden now: nothing to send it to.
  const submission = draft.slideGone
    ? null
    : mediaReady
      ? (textSubmission ?? { body: typed.trim(), anchor: draft.anchor, strokes: draft.strokes })
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
  const dialogLabel =
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

  // The mic is for voice: on video the recorder starts itself, from its preview.
  const micLabel = imageTab ? 'Sprachmemo zur Skizze aufnehmen' : 'Sprachkommentar aufnehmen';
  const micTitle = imageTab ? 'Sprachmemo aufnehmen' : 'Sprachmemo aufnehmen (Tab)';
  // The bin of a video: a fresh recorder (it takes the focus), the picture source kept.
  const discardVideo = () => {
    setVideoTake((take) => take + 1);
    setRecording(null);
    setRecordingRunning(false);
  };
  // The recorder's bin: back to the field, the note typed so far kept.
  const discardVoice = () => {
    toggleVoice();
    commentRef.current?.focus({ preventScroll: true });
  };
  // As in a messenger: the mic while the field is empty – typed text and a memo are either/or.
  // Video has no mic at all.
  const showMic = tab !== 'video' && !voice && body.trim() === '';

  // Tab walks the kinds in a loop: comment → Memo → Video → Skizze → comment, from the comment
  // field, the recorder or the sheet (after the text on the slide, which Tab leaves for the comment
  // field). Once something is recorded or drawn, Tab moves the focus on as usual – nothing is
  // dropped by it; Esc and ⌘↵ work all along.
  const onFormKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.defaultPrevented) return;
    // Without a field beside a recording, Enter sends from the recorder (⌘↵ to the AI) – the
    // recorder took it first while a take runs or plays.
    if (
      recordingTab &&
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      !(event.target instanceof HTMLButtonElement) &&
      !isTypingTarget(event.target)
    ) {
      event.preventDefault();
      submit(undefined, { askAi: isModEnter(event) });
      return;
    }
    if (event.key !== 'Tab' || event.shiftKey) return;
    if (isModKey(event) || event.altKey || event.nativeEvent.isComposing) return;
    if (recording !== null || recordingRunning || sketch !== null) return;
    const target = event.target instanceof Element ? event.target : null;
    if (tab === 'text' && !voice && target === commentRef.current) {
      event.preventDefault();
      // To the mic (Space records); with text typed there is none – on to video.
      if (micRef.current) micRef.current.focus();
      else switchTab('video');
    } else if (tab === 'text' && !voice && target === micRef.current) {
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

  // Löschen: like Abbrechen, and a saved drawing the comment was for goes as well.
  const discard = () => {
    if (draft.commentId) deleteComment.mutate({ commentId: draft.commentId });
    cancel();
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
    if (memo || pictures.length > 0) {
      // Without a connection (or lost on the way): kept with its files, sent once it is back.
      const queue = () =>
        void queueMediaComment(input, memo, pictures).then(onSuccess, (failure: Error) =>
          showToast(failure.message, 'danger'),
        );
      if (!online) return queue();
      createMediaComment.mutate(
        { input, recording: memo, images: pictures },
        { onSuccess, onError: (failure) => isUnreachable(failure) && queue() },
      );
    } else createComment.mutate(input, { onSuccess });
  };
  // ⌘↵ in the sticker on the slide: sent and given to the AI, as from the comment field.
  const sendToAi = useEffectEvent(() => submit(undefined, { askAi: true }));

  // The recorder's send while it records: the take ends, and the comment goes once it is there –
  // to the AI where there is one.
  const aiAsks = ai.available && draft.slideId !== null;
  const sendWhenRecorded = useRef<{ askAi: boolean } | null>(null);
  const sendRecorded = useEffectEvent((askAi: boolean) => submit(undefined, { askAi }));
  useEffect(() => {
    const send = sendWhenRecorded.current;
    if (!send || !recording || recordingRunning) return;
    sendWhenRecorded.current = null;
    sendRecorded(send.askAi);
  }, [recording, recordingRunning]);
  // Video and the voice comment send from the recorder; the sketch's memo goes with the sketch:
  // it only stops.
  const sendNow = recordingTab
    ? {
        run: (askAi: boolean) => {
          sendWhenRecorded.current = { askAi };
        },
        ai: aiAsks,
      }
    : undefined;
  useEffect(() => {
    const form = popoverRef.current;
    if (!form) return;
    const listener = () => sendToAi();
    form.addEventListener(SEND_TO_AI, listener);
    return () => form.removeEventListener(SEND_TO_AI, listener);
  }, []);

  return (
    <form
      ref={popoverRef}
      // The on-slide text box sends through this form (⌘↵, `SEND_TO_AI`).
      data-composer
      role="dialog"
      // Names the dialog: what it is, not who writes – shown it says nothing new.
      aria-label={dialogLabel}
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
        <span
          {...(movable && handle)}
          className={cn(
            'min-w-0 truncate text-xs font-medium text-fg',
            movable && 'cursor-grab touch-none select-none active:cursor-grabbing',
          )}
        >
          {author.name} <span className="font-normal text-fg-subtle">jetzt</span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {movable && (
            <span
              data-composer-handle
              title="Verschieben"
              className="flex shrink-0 cursor-grab touch-none rounded-thumb p-0.5 text-fg-subtle hover:text-fg-muted active:cursor-grabbing"
              {...handle}
            >
              <Icon name="dragIndicator" size={14} />
            </span>
          )}
          {/* The draft goes with its marks on the slide; on a saved drawing the drawing too. */}
          {/* Two clicks, as an element's: the first turns it into a red „Löschen“. */}
          <DeleteButton
            label={forDrawing ? 'Zeichnung löschen' : 'Entwurf löschen'}
            // Tab goes into the composer at its kinds, not here; Esc discards from the keys.
            tabIndex={-1}
            disabled={pending}
            onDelete={discard}
          />
        </div>
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

      {recorderKind === 'video' && (
        // Remount per kind: switching tabs turns the previous device off. The mic starts at once.
        <RecorderPanel
          key={`${recorderKind}-${videoTake}`}
          kind={recorderKind}
          deckId={deck.id}
          onChange={setRecording}
          onRecordingChange={setRecordingRunning}
          autoFocus
          onDiscard={discardVideo}
          onSend={sendNow}
        />
      )}

      {(tab !== 'video' || attached) && (
        <div className="flex items-end gap-2">
          {tab === 'video' ? (
            // The video is the comment: no note beside it, only the images it carries.
            <div className="min-w-0 flex-1">
              <AttachedImages attachments={images.attachments} onRemove={images.remove} />
            </div>
          ) : recorderKind === 'audio' ? (
            // The memo in the field's place – text or memo, as in a messenger. Faded in as the
            // field comes back after its bin.
            <div className="min-w-0 flex-1 animate-fade-in">
              <RecorderPanel
                kind="audio"
                deckId={deck.id}
                onChange={setRecording}
                onRecordingChange={setRecordingRunning}
                autoStart
                autoFocus
                onDiscard={discardVoice}
                onSend={sendNow}
              />
              <AttachedImages attachments={images.attachments} onRemove={images.remove} />
            </div>
          ) : (
            <div
              className={cn(
                'field-well focus-field relative flex min-w-0 flex-1 animate-fade-in items-end gap-1 rounded-control-sm py-2 pl-3',
                showMic ? 'pr-1.5' : 'pr-3',
              )}
            >
              <div className="min-w-0 flex-1">
                <MentionMenu mentions={mentions} />
                <MentionTextarea
                  {...mentions.fieldProps}
                  ref={commentRef}
                  // While drawing or writing on the slide, keep focus there (⌘Z undoes strokes).
                  // A saved drawing's comment is typed right away.
                  autoFocus={
                    forDrawing ||
                    (draft.strokes.length === 0 && !onSlideText && !imageTab && !freshBox)
                  }
                  aria-label="Kommentar"
                  onPaste={images.onPaste}
                  maxLength={MAX_COMMENT_BODY_LENGTH}
                  placeholder={
                    imageTab
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
                    if (
                      event.key === 'Enter' &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      // Shift+Enter adds a line.
                      event.preventDefault();
                      submit(undefined, { askAi: isModEnter(event) });
                      return;
                    }
                    if (event.key !== 'Tab' || !event.shiftKey || isModKey(event) || event.altKey)
                      return;
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
              {/* In the field, as in a messenger: while it is empty, a memo instead of text. */}
              {showMic && (
                <IconButton
                  ref={micRef}
                  icon="mic"
                  label={micLabel}
                  title={micTitle}
                  variant="subtle"
                  size="xs"
                  disabled={pending}
                  onClick={toggleVoice}
                  className="-my-1"
                />
              )}
            </div>
          )}
        </div>
      )}

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
