import { MAX_COMMENT_BODY_LENGTH } from '@slider/shared';
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from 'react';
import { ringColor } from '@/lib/accent';
import { useAiProposals, useCancelProposal } from '@/lib/api';
import { isTypingTarget } from '@/lib/dom';
import { typesCharacter } from '@/lib/keyboard';
import { AutosizeTextarea, cn, IconButton, useFocusLoop, useIsNarrow } from '@/ui';
import { useEditing } from '../editing/editing-context';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { useHoldUnsavedWork } from '../lib/unsaved-work';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, type Draft } from '../state/viewer-state';
import { useViewerToast } from '../state/viewer-toast';
import { VoiceAvatar } from '../voice/VoiceBar';
import { useVoice } from '../voice/voice-context';
import { useHeardWords } from '../voice/hooks/useHeardWords';
import { runningIn, type SendAiBox } from './hooks/useSendAiBox';
import { useComposerPosition } from './hooks/useComposerPosition';
import { useFloatingFollow } from './hooks/useFloatingFollow';
import { locationLabel } from './lib/labels';

/**
 * The field beside a box drawn while speaking to the AI: what is said meanwhile shows in it word
 * for word (and can be typed into or corrected), ↵ sends it to the AI, Esc drops it. Whatever takes
 * its place (another box, a click, another slide, the other mode) sends it first – it is never in
 * the way. Small and in the AI's look – its avatar, its sage light while words come in. Opened on
 * one's own request still at work (`Draft.aiThreadId`) it adds to that one and can stop it.
 */
export function AiBoxComposer({ draft, onSend }: { draft: Draft; onSend: SendAiBox }) {
  const { aiAuthor, viewer, slideIndex, deck, threads } = useViewerData();
  const dispatch = useViewerDispatch();
  const voice = useVoice();
  const showToast = useViewerToast();
  const editing = useEditing();
  const narrow = useIsNarrow();
  const formRef = useRef<HTMLFormElement>(null);
  const placement = useComposerPosition(narrow ? null : draft, formRef);
  useFloatingFollow(formRef, placement);
  useFocusLoop(formRef);
  useRestoreFocus();
  const [body, setBody] = useState('');

  // What the live stream hears from now on is the box's: taken into the field as it comes.
  useHeardWords(setBody);

  const text = body.trim();
  // Sent, dropped (Esc) or its request stopped: nothing more to send as it closes.
  const closed = useRef(false);
  const send = () => {
    if (!text) return false;
    closed.current = true;
    onSend(draft, text.slice(0, MAX_COMMENT_BODY_LENGTH));
    return true;
  };
  const drop = () => {
    closed.current = true;
    dispatch({ type: 'draftCancelled' });
  };
  // Something else took its place (another box or comment, a click elsewhere, the deck left): what
  // it holds goes to the AI all the same – its field is gone already.
  const latest = useRef({ draft, text });
  useEffect(() => {
    latest.current = { draft, text };
  });
  useEffect(
    () => () => {
      const { draft: last, text: words } = latest.current;
      if (closed.current || !words) return;
      closed.current = true;
      onSend(last, words.slice(0, MAX_COMMENT_BODY_LENGTH), false);
    },
    // Once, as it closes (`onSend` is made anew each render; the latest is used).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // The other mode (Besprechen ⇄ Bearbeiten): sent as it is, or gone when empty.
  const mode = useRef(editing.active);
  const modeChanged = useEffectEvent(() => {
    if (!send()) drop();
  });
  useEffect(() => {
    if (mode.current === editing.active) return;
    mode.current = editing.active;
    modeChanged();
  }, [editing.active]);

  // Adding to a request still at work: its thread, and the AI's run there (to stop).
  const thread = draft.aiThreadId
    ? threads.find((each) => each.id === draft.aiThreadId)
    : undefined;
  const { data: proposals } = useAiProposals(deck.id, !!thread);
  const running = thread
    ? runningIn(proposals, new Set([thread.root.id, ...thread.replies.map((reply) => reply.id)]))
    : null;
  const cancel = useCancelProposal(deck.id);
  const stop = () => {
    if (!running) return;
    cancel.mutate(running.id, { onError: (error) => showToast(error.message, 'danger') });
    drop();
  };

  const held = text !== '';
  useEffect(() => {
    dispatch({ type: 'draftHeld', held });
  }, [dispatch, held]);
  useHoldUnsavedWork(held);

  // Focus elsewhere (a click on the slide, the editor's): typing goes on into the field – before
  // the viewer's letter shortcuts.
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const onWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (event.target instanceof Element && event.target.closest('dialog')) return;
    if (event.key === 'Escape') {
      // Esc anywhere drops it (`useViewerShortcuts`) – not sent as it closes. Taken back when
      // something else kept the Esc and the field stays.
      closed.current = true;
      window.setTimeout(() => {
        closed.current = false;
      });
      return;
    }
    if (isTypingTarget(event.target)) return;
    const field = fieldRef.current;
    if (!field || !typesCharacter(event) || event.key === ' ') return;
    event.stopImmediatePropagation();
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onWindowKeyDown(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    send();
  };
  const listening = voice.status === 'listening';
  // Words coming in: the AI's light runs round the field, as round a card it works on.
  const lit = listening && voice.speaking && voice.live !== null;
  const location = locationLabel(draft.anchor, draft.slideId, (id) => slideIndex.get(id));

  return (
    <form
      ref={formRef}
      data-composer
      data-ai-box
      role="dialog"
      aria-label={`${thread ? 'Ergänzung an' : 'An'} ${aiAuthor.name} | ${location}`}
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        drop();
      }}
      className={cn(
        'fixed z-(--z-popover) w-[min(300px,calc(100vw-24px))] animate-pop-in',
        narrow && 'inset-x-3 bottom-24 w-auto',
      )}
      style={
        {
          ...(narrow ? {} : { left: placement?.left ?? 0, top: placement?.top ?? 0 }),
          visibility: narrow || placement ? 'visible' : 'hidden',
        } as CSSProperties
      }
    >
      {lit && (
        <span aria-hidden className="ai-glow pointer-events-none absolute -inset-1 rounded-panel" />
      )}
      {thread && (
        <p className="glass-elevated relative mb-1 w-fit rounded-full px-2 py-0.5 text-caption text-fg-muted">
          {running ? 'Ergänzt den laufenden Auftrag' : 'Ergänzt den Auftrag'}
        </p>
      )}
      <div
        className="glass-elevated relative flex items-start gap-1.5 rounded-panel py-1 pr-1 pl-1.5"
        style={{
          boxShadow:
            'inset 0 0 0 1px color-mix(in srgb, var(--color-sage) 55%, transparent), 0 0 24px color-mix(in srgb, var(--color-sage) 25%, transparent), var(--shadow-float)',
        }}
      >
        {lit && (
          <span
            aria-hidden
            className="ai-rim pointer-events-none absolute -inset-px rounded-[inherit]"
          />
        )}
        <VoiceAvatar
          author={aiAuthor}
          active={listening}
          recognitions={0}
          color={ringColor(viewer.author.color)}
        />
        <AutosizeTextarea
          ref={fieldRef}
          // The comment field the slide's keys go on into (`focusCommentField`).
          aria-label="Kommentar"
          autoFocus
          rows={1}
          maxHeight={160}
          maxLength={MAX_COMMENT_BODY_LENGTH}
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
          }}
          placeholder={
            thread
              ? `Was soll ${aiAuthor.name} noch beachten?`
              : listening && voice.live
                ? `Sag oder tippe, was ${aiAuthor.name} hier tun soll`
                : `Was soll ${aiAuthor.name} hier tun?`
          }
          onKeyDown={(event) => {
            // ↵ sends (⌘↵ too: it goes to the AI anyway), ⇧↵ adds a line.
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            send();
          }}
          className="min-w-0 flex-1 py-1.5 text-body leading-5 text-fg placeholder:text-fg-subtle"
        />
        {running && (
          <IconButton
            icon="stop"
            label="Auftrag abbrechen"
            title="Auftrag abbrechen"
            size="compact"
            disabled={cancel.isPending}
            onClick={stop}
          />
        )}
        <IconButton
          type="submit"
          icon="send"
          label={`An ${aiAuthor.name} senden`}
          title={`An ${aiAuthor.name} senden (↵)`}
          size="compact"
          disabled={!text}
        />
      </div>
    </form>
  );
}
