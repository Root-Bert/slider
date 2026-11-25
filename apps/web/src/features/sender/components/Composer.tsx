import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import {
  EVERYONE_TAG,
  MAX_SENDER_MESSAGE,
  searchFold,
  type AccountAuthor,
  type Attachment,
} from '@slider/shared';
import {
  AttachButton,
  AttachmentChips,
  useCloudDrop,
  type Attachments,
} from '@/features/attachments';
import { AgentAvatar } from '@/features/cloud';
import { canRecord, RecorderPanel } from '@/features/viewer';
import { suggestVideoCuts } from '@/lib/api';
import { isModEnter, isModKey } from '@/lib/keyboard';
import { useTallField } from '@/lib/useTallField';
import { useTypeInto } from '@/lib/useTypeInto';
import { isApplePlatform } from '@/lib/platform';
import {
  AutosizeTextarea,
  Avatar,
  Button,
  cn,
  ContextMenu,
  Divider,
  Icon,
  IconButton,
  PopoverPanel,
  Spinner,
  TextField,
  useFocusLoop,
} from '@/ui';
import { dayInput, fromInputs, laterChoices, timeInput } from '../lib/later';
import { ROW_MENU_CLASS, useRowMenu } from '../hooks/useRowMenu';
import { draftOf, setDraft, useDrafts, type DraftTarget } from '@/lib/drafts';
const SUGGESTIONS = 8;

/** A recorded (and cut) video as the file put on the message: „Aufnahme 2026-11-24 21.05.mp4“. */
function videoFile(blob: Blob): File {
  const type = blob.type.split(';')[0]?.trim() || 'video/webm';
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
  return new File([blob], `Aufnahme ${stamp}.${type === 'video/mp4' ? 'mp4' : 'webm'}`, { type });
}

/** The `@…` being typed just before the caret, if any. */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([\p{L}\p{N}.-]*)$/u.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[2]!.length - 1, query: match[2]! };
}

/** One to call with @ – an agent (`id` null: an area's own, made when tagged). */
export interface TagAgent {
  id: string | null;
  name: string;
  /** In the conversation („Agent hinzufügen“, an area's own): offered before the people. */
  here?: boolean;
}

/** One to name with @: a person, or an agent – or „Neuer Agent“, made for the conversation. */
type Named =
  | { kind: 'person'; person: AccountAuthor }
  | ({ kind: 'agent' } & TagAgent)
  | { kind: 'new' }
  | { kind: 'everyone' };
const NEW_AGENT = 'Neuer Agent';

/**
 * The field every conversation is written in – with people or with an agent (`AgentComposer`
 * only hands it the agent's files and draft), a mail's reply too: Enter sends, Shift+Enter breaks
 * the line (a mail's reply: ⌘↵ sends, Enter breaks the line, as a new mail's), @ offers the
 * people to name and the agents to call – those in the conversation first – ↑ in an empty field
 * changes one's last message. Files, a recorded video, the AI writing: wherever they are given.
 */
export function Composer({
  conversationId,
  target,
  keepDraft = true,
  prefill,
  label = 'Nachricht schreiben',
  placeholder,
  people,
  agents = [],
  onNewAgent,
  onSend,
  onSchedule,
  onTyping,
  onEditLast,
  onEscape,
  busy = false,
  working = false,
  onStop,
  focusOnOpen = true,
  maxHeight = 240,
  maxLength = MAX_SENDER_MESSAGE,
  sendKey = 'enter',
  assist,
  onFiles,
  attach,
  variant = 'float',
  typeInto = true,
  signature,
  everyone = false,
}: {
  /** Drafts are kept per conversation. */
  conversationId: string;
  /** Where the draft goes (a conversation, a mail's answer) – kept for the account with it. */
  target?: DraftTarget;
  /** `false`: what is written is not kept (an agent asked beside a mail). */
  keepDraft?: boolean;
  /** A text to start from, put into the field each time it is another one (a picked example). */
  prefill?: { text: string } | null;
  /** The form's name for screen readers (`Nachricht an den Agenten`). */
  label?: string;
  placeholder: string;
  /** Who can be named with @. */
  people: readonly AccountAuthor[];
  /** The agents one may call here with @. */
  agents?: readonly TagAgent[];
  /**
   * „Neuer Agent“ first in the @ list (as „Hinzufügen“ in a call): made and put in the
   * conversation – its name, once it has one, in the field. `null`: refused (said by the caller).
   */
  onNewAgent?: () => Promise<string | null>;
  /**
   * The words – and the files put on them, where `attach` is. A promise of `false`: refused – the
   * words and the files go back into the field.
   */
  onSend: (text: string, attachments: Attachment[]) => void | Promise<boolean>;
  /**
   * „Später senden“ (a right click on „Senden“, the menu key on it): the words and files go at
   * `at` instead – as `onSend`, a promise of `false` puts them back.
   */
  onSchedule?: (text: string, attachments: Attachment[], at: Date) => Promise<boolean>;
  onTyping?: () => void;
  onEditLast?: () => void;
  /** Esc in the field – where the page has one (back, on „Neu“); else the field keeps it. */
  onEscape?: () => void;
  /** Nothing is sent right now (an order being placed). */
  busy?: boolean;
  /** An agent works: „Stoppen“ beside „Senden“ (`onStop`) – and one writes on all the same. */
  working?: boolean;
  onStop?: () => void;
  /** The caret in the field when the conversation opens (not beside a list stepped with ↑/↓). */
  focusOnOpen?: boolean;
  /** How tall the field grows before it scrolls; a mail's reply grows with its words (`Infinity`). */
  maxHeight?: number;
  maxLength?: number;
  /** `mod-enter`: ⌘↵ sends, Enter breaks the line – a mail's reply, as a new mail. */
  sendKey?: 'enter' | 'mod-enter';
  /**
   * The AI writes it (a mail's reply): from the words in the field – a few notes – or from
   * nothing; `put` types it into the field (⌘Z gives the notes back).
   */
  assist?: (notes: string, put: (text: string) => void) => Promise<void>;
  /** Files put on it (a mail's reply): the clip picks them, pasted ones come too. */
  onFiles?: (files: File[]) => void;
  /**
   * Files put on a message (a conversation's): pasted into the field or picked with the clip,
   * shown under the words and sent along – a message may be files alone.
   */
  attach?: Attachments;
  /**
   * `float` over the conversation (default); `flat` in the page's flow (a mail's reply under it):
   * its edge, no shadow; `inline` in a column that scrolls (`MailAside`); `top` at a page's top
   * beside its buttons (`Agenten`, „Neu“): as high as they are, dressed as every field there.
   */
  variant?: 'float' | 'flat' | 'inline' | 'top';
  /**
   * Typing with the focus outside a field (a chat just picked in the side bar) writes here – off
   * where letters are the page's keys (a mail's R, A, F, j/k).
   */
  typeInto?: boolean;
  /** What goes under it on sending (a mail's reply, `withSignature`): shown once words stand. */
  signature?: string | null;
  /** „@alle“ offered first among the people (a conversation's field). */
  everyone?: boolean;
}) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  // What was written and not sent – back when one returns to the conversation (`Entwürfe`).
  const draftIn = (key: string) => (keepDraft ? draftOf(key) : '');
  const [body, setBody] = useState(() => draftIn(conversationId) || (prefill?.text ?? ''));
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [picked, setPicked] = useState(0);
  // Another conversation: its draft, and the caret in the field.
  const [shown, setShown] = useState(conversationId);
  // What the field shows that is kept: taken in, or taken by the server – typed on since, not yet.
  const [saved, setSaved] = useState(body);
  if (shown !== conversationId) {
    setShown(conversationId);
    setBody(draftIn(conversationId));
    setSaved(draftIn(conversationId));
    setMention(null);
  }
  // Written on another device or tab, or by an agent (the list came down): in the field – unless
  // one typed on and that is not on the server yet (it would be gone).
  const kept = useDrafts()[conversationId];
  const stored = keepDraft ? (kept?.text ?? '') : '';
  if (keepDraft && kept?.synced && kept.text === body && saved !== body) setSaved(body);
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    if (body === saved || !body.trim()) {
      setBody(stored);
      setSaved(stored);
    }
  }
  useEffect(() => {
    if (focusOnOpen) fieldRef.current?.focus({ preventScroll: true });
  }, [conversationId, focusOnOpen]);
  // A picked example lies in the field at once: taken while rendering, not an effect later.
  const [taken, setTaken] = useState(prefill);
  if (prefill !== taken) {
    setTaken(prefill);
    if (prefill) setBody(prefill.text);
  }
  useEffect(() => {
    if (prefill) fieldRef.current?.focus({ preventScroll: true });
  }, [prefill]);
  useTypeInto(fieldRef, typeInto);
  // Written past one line: the buttons go below the words.
  // A video being recorded to send: the recorder floats over the field on its own, as wide as
  // it is – the field stays as it was. Only its ✕/discard or the camera button close it (a press
  // beside it would lose a take).
  const [filming, setFilming] = useState(false);
  const [canFilm] = useState(canRecord);
  const filmRef = useRef<HTMLElement>(null);
  useFocusLoop(filmRef, filming);
  // Files on it too: they stand under the words, the buttons below them.
  const tall = useTallField(fieldRef, body) || (attach?.items.length ?? 0) > 0 || !!attach?.error;
  // Cloud files and folders dropped on the field: pointed to, not copied.
  const drop = useCloudDrop(attach);
  // Where the caret goes once a change of the text is on screen – before the next key.
  const caretAfter = useRef<number | null>(null);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    const at = caretAfter.current;
    if (!field || at === null) return;
    caretAfter.current = null;
    field.focus();
    field.setSelectionRange(at, at);
  }, [body]);

  const fold = searchFold(mention?.query ?? '');
  const fits = (name: string) =>
    searchFold(name)
      .split(/\s+/)
      .some((part) => part.startsWith(fold)) || searchFold(name).startsWith(fold);
  const agentsFitting = (here: boolean): Named[] =>
    agents
      .filter((agent) => !!agent.here === here && (fits(agent.name) || fits('Agent')))
      .map((agent) => ({ kind: 'agent' as const, ...agent }));
  // As „Hinzufügen“ in a call: „Neuer Agent“ and the agents (those in the conversation first),
  // a line, then the people.
  const agentRows: Named[] = mention
    ? [
        ...(onNewAgent && fits(NEW_AGENT) ? [{ kind: 'new' as const }] : []),
        ...agentsFitting(true),
        ...agentsFitting(false),
      ].slice(0, SUGGESTIONS)
    : [];
  const personRows: Named[] = mention
    ? [
        ...(everyone && fits(EVERYONE_TAG) ? [{ kind: 'everyone' as const }] : []),
        ...people
          .filter((person) => fits(person.name))
          .map((person) => ({ kind: 'person' as const, person })),
      ].slice(0, SUGGESTIONS)
    : [];
  const suggestions = [...agentRows, ...personRows];
  const nameOf = (named: Named) =>
    named.kind === 'person'
      ? named.person.name
      : named.kind === 'new'
        ? NEW_AGENT
        : named.kind === 'everyone'
          ? EVERYONE_TAG
          : named.name;

  const change = (text: string) => {
    setBody(text);
    if (keepDraft) setDraft(conversationId, text, target);
  };
  const look = () => {
    const field = fieldRef.current;
    if (!field) return;
    setMention(mentionAt(field.value, field.selectionStart));
    setPicked(0);
  };
  const pick = (named: Named) => {
    const field = fieldRef.current;
    if (!field || !mention) return;
    const caret = field.selectionStart;
    if (named.kind === 'new') {
      // Made first: its name (`Agent 2`) takes the place of the `@…` once it is there.
      const { start } = mention;
      setMention(null);
      void onNewAgent?.().then((name) => {
        const now = fieldRef.current?.value ?? body;
        if (!name || now.slice(start, caret) !== body.slice(start, caret)) return;
        change(`${now.slice(0, start)}@${name} ${now.slice(caret)}`);
        caretAfter.current = start + name.length + 2;
      });
      return;
    }
    const name = nameOf(named);
    const text = `${body.slice(0, mention.start)}@${name} ${body.slice(caret)}`;
    change(text);
    setMention(null);
    caretAfter.current = mention.start + name.length + 2;
  };
  const files = attach?.ready ?? [];
  // Words or files – and nothing still on its way up.
  const sendable = (!!body.trim() || files.length > 0) && !attach?.busy && !busy;
  const deliver = (go: (text: string, files: Attachment[]) => void | Promise<boolean>) => {
    const text = body.trim();
    if (!sendable) return;
    change('');
    setMention(null);
    attach?.clear();
    void go(text, files)?.then((sent) => {
      if (sent) return;
      setBody((now) => now || text);
      attach?.restore(files);
      if (keepDraft && !draftOf(conversationId)) setDraft(conversationId, text, target);
    });
  };
  const send = () => deliver(onSend);
  // „Später senden“: the menu on „Senden“, and the day and time typed in above the field.
  // Opened as a row's menu (`useRowMenu`): a right click, the menu key – and a long press, as
  // iOS fires no right click. With nothing to send nothing to plan: no menu, not the browser's.
  const laterMenu = useRowMenu();
  const [picking, setPicking] = useState<{ day: string; time: string } | null>(null);
  // „Now“ for the picked time, taken when the day or time is set – not read while drawing.
  const [pickedNow, setPickedNow] = useState(0);
  const pickTime = (next: { day: string; time: string }) => {
    setPicking(next);
    setPickedNow(Date.now());
  };
  const later = (at: Date) => {
    if (!onSchedule) return;
    setPicking(null);
    deliver((text, sent) => onSchedule(text, sent, at));
    fieldRef.current?.focus({ preventScroll: true });
  };
  const pickedAt = picking ? fromInputs(picking.day, picking.time) : null;
  const pickedLate = !!pickedAt && pickedAt.getTime() > pickedNow;
  const atSign = () => {
    const field = fieldRef.current;
    if (!field) return;
    const caret = field.selectionStart;
    const before = body.slice(0, caret);
    const insert = before && !/\s$/.test(before) ? ' @' : '@';
    const text = before + insert + body.slice(field.selectionEnd);
    change(text);
    const at = caret + insert.length;
    caretAfter.current = at;
    setMention({ start: at - 1, query: '' });
    setPicked(0);
  };

  // The AI writing: the field waits (what it writes takes its place), the spark turns.
  const [assisting, setAssisting] = useState(false);
  const write = async () => {
    if (!assist || assisting) return;
    setAssisting(true);
    try {
      await assist(body, (text) => {
        // Typed in as if by hand, so ⌘Z gives the notes back (no toast for it).
        const field = fieldRef.current;
        if (field && typeof document.execCommand === 'function') {
          field.readOnly = false;
          field.focus();
          field.select();
          if (document.execCommand('insertText', false, text)) return;
        }
        change(text);
        caretAfter.current = text.length;
      });
    } finally {
      setAssisting(false);
    }
  };

  const open = suggestions.length > 0;
  return (
    <>
      {picking && (
        <div
          role="group"
          aria-label="Später senden"
          className="flex flex-wrap items-center gap-2 px-1"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setPicking(null);
              fieldRef.current?.focus({ preventScroll: true });
            }
            // Enter on ✕ or „Planen“ is that button's own press, not a second plan.
            if (event.target instanceof HTMLButtonElement) return;
            if (event.key === 'Enter' && pickedAt && pickedLate && sendable) {
              event.preventDefault();
              later(pickedAt);
            }
          }}
        >
          <Icon name="schedule" size={16} className="shrink-0 text-fg-subtle" />
          <TextField
            aria-label="Tag"
            type="date"
            autoFocus
            required
            min={dayInput(new Date())}
            value={picking.day}
            onChange={(event) => pickTime({ ...picking, day: event.target.value })}
            className="w-36"
          />
          <TextField
            aria-label="Uhrzeit"
            type="time"
            required
            value={picking.time}
            onChange={(event) => pickTime({ ...picking, time: event.target.value })}
            className="w-24"
          />
          <Button
            size="sm"
            disabled={!pickedLate || !sendable}
            title={pickedAt && !pickedLate ? 'Dieser Zeitpunkt ist schon vorbei.' : undefined}
            onClick={() => pickedAt && later(pickedAt)}
          >
            Planen
          </Button>
          <IconButton
            icon="close"
            label="Nicht planen"
            size="xs"
            variant="subtle"
            onClick={() => {
              setPicking(null);
              fieldRef.current?.focus({ preventScroll: true });
            }}
          />
        </div>
      )}
      <form
        aria-label={label}
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
        {...drop.props}
        className={cn(
          'relative flex shrink-0 items-end gap-0.5 rounded-control pr-1 pl-3',
          variant === 'top'
            ? 'glass focus-field min-h-10 py-1.5 transition-shadow'
            : cn(variant === 'inline' ? 'glass-control' : 'glass-elevated', 'py-1'),
          // More than a line: the words take the whole width, the buttons a row of their own below.
          tall && 'flex-wrap justify-end',
          variant === 'flat' && 'shadow-[inset_0_0_0_1px_var(--color-hairline-strong)]!',
          drop.over && 'ring-2 ring-focus',
        )}
      >
        {open && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Personen und Agenten"
            data-popover-panel=""
            className="glass-elevated absolute right-0 bottom-full left-0 mb-2 flex max-h-[min(28rem,60vh)] max-w-80 flex-col gap-0.5 overflow-y-auto rounded-control p-1.5"
          >
            {suggestions.map((named, index) => (
              <li
                key={
                  named.kind === 'person'
                    ? named.person.id
                    : named.kind === 'new' || named.kind === 'everyone'
                      ? named.kind
                      : `agent:${named.id ?? ''}`
                }
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === picked}
                onPointerDown={(event) => {
                  event.preventDefault();
                  pick(named);
                }}
                onPointerEnter={() => setPicked(index)}
                className={cn(
                  'flex h-8 shrink-0 cursor-pointer items-center gap-2.5 rounded-chip px-2 text-sm',
                  index === picked ? 'bg-selected text-fg' : 'text-fg-muted',
                  // The line between the agents and the people.
                  index === agentRows.length && index > 0 && 'relative mt-2.5',
                )}
              >
                {index === agentRows.length && index > 0 && (
                  <Divider
                    aria-hidden
                    className="pointer-events-none absolute inset-x-2 -top-1.5"
                  />
                )}
                {named.kind === 'person' ? (
                  <Avatar author={named.person} size={20} nativeTitle={false} />
                ) : named.kind === 'new' ? (
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <Icon name="add" size={16} />
                  </span>
                ) : named.kind === 'everyone' ? (
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    <Icon name="groups" size={16} />
                  </span>
                ) : named.id ? (
                  <AgentAvatar id={named.id} size={20} className="rounded-mark" />
                ) : (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-mark bg-selected">
                    <Icon name="autoAwesome" size={14} />
                  </span>
                )}
                <span className="truncate">{nameOf(named)}</span>
                {named.kind === 'everyone' && (
                  <span className="ml-auto shrink-0 text-xs text-fg-subtle">Alle hier</span>
                )}
                {named.kind === 'agent' && named.name !== 'Agent' && (
                  <span className="ml-auto shrink-0 text-xs text-fg-subtle">Agent</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {filming && attach && (
          <PopoverPanel
            ref={filmRef}
            as="section"
            aria-label="Video aufnehmen"
            // Over the field – under it where the field stands at a page's top.
            side={variant === 'top' ? 'bottom' : 'top'}
            align="end"
            padding="lg"
            // As wide as a video in a message: the camera's picture does not fill the page.
            className="w-[min(36rem,calc(100vw-2rem))]"
          >
            <RecorderPanel
              kind="video"
              autoFocus
              onChange={() => undefined}
              onDiscard={() => setFilming(false)}
              editor={{
                doneLabel: 'Anhängen',
                onDone: (file) => {
                  attach.add([videoFile(file)]);
                  setFilming(false);
                  fieldRef.current?.focus({ preventScroll: true });
                },
                autoCut: attach.workspaceId
                  ? (speech, signal) => suggestVideoCuts(attach.workspaceId ?? '', speech, signal)
                  : undefined,
              }}
            />
          </PopoverPanel>
        )}
        <div className={cn('flex min-w-0 flex-1 flex-col py-[5px]', tall && 'basis-full pr-2')}>
          <AutosizeTextarea
            ref={fieldRef}
            aria-label="Nachricht"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open ? `${listId}-${picked}` : undefined}
            aria-autocomplete="list"
            placeholder={placeholder}
            maxLength={maxLength}
            maxHeight={maxHeight}
            readOnly={assisting}
            aria-busy={assisting || undefined}
            value={body}
            onChange={(event) => {
              change(event.target.value);
              if (event.target.value.trim()) onTyping?.();
              look();
            }}
            onSelect={look}
            onBlur={() => setMention(null)}
            onPaste={(event) => {
              if (attach) return attach.onPaste(event);
              const files = [...event.clipboardData.files];
              if (!onFiles || files.length === 0) return;
              event.preventDefault();
              onFiles(files);
            }}
            onKeyDown={(event) => {
              // The page's keys are not meant while one writes – ⌘F, ⇧⌘F (the searches) and ⌘K are.
              if (!(isModKey(event) && 'fk'.includes(event.key.toLowerCase())))
                event.stopPropagation();
              if (event.nativeEvent.isComposing) return;
              if (open) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  setPicked((now) => (now + step + suggestions.length) % suggestions.length);
                  return;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault();
                  const named = suggestions[picked];
                  if (named) pick(named);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setMention(null);
                  return;
                }
              }
              if (event.key === 'Escape' && onEscape) {
                event.preventDefault();
                onEscape();
                return;
              }
              if (event.key === 'ArrowUp' && !body && onEditLast) {
                event.preventDefault();
                onEditLast();
                return;
              }
              if (event.key !== 'Enter' || event.shiftKey) return;
              if (sendKey === 'mod-enter' && !isModEnter(event)) return;
              event.preventDefault();
              send();
            }}
            className={cn(
              variant === 'top' ? 'text-sm' : 'text-body',
              'leading-4.5 text-fg placeholder:text-fg-subtle',
            )}
          />
          {signature && body.trim() && (
            <p
              aria-label="Signatur"
              className="pt-3 pb-1 text-body leading-4.5 whitespace-pre-wrap text-fg-subtle select-none"
            >
              {signature}
            </p>
          )}
          {attach && <AttachmentChips files={attach} className="pt-2 pb-1" />}
        </div>
        {attach && <AttachButton files={attach} />}
        {attach?.enabled && canFilm && (
          <IconButton
            icon="videocam"
            label={filming ? 'Aufnahme schließen' : 'Video aufnehmen'}
            title={
              filming ? 'Aufnahme schließen' : 'Video aufnehmen – Bildschirm, Kamera oder beides'
            }
            aria-pressed={filming}
            size="compact"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => setFilming((now) => !now)}
          />
        )}
        {onFiles && (
          <>
            <input
              ref={pickerRef}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              onChange={(event) => {
                const files = [...(event.target.files ?? [])];
                event.target.value = '';
                if (files.length > 0) onFiles(files);
              }}
            />
            <IconButton
              icon="attachFile"
              label="Datei anhängen"
              size="compact"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pickerRef.current?.click()}
            />
          </>
        )}
        {assist &&
          (assisting ? (
            <span className="flex size-7 shrink-0 items-center justify-center">
              <Spinner size={16} label="Die KI schreibt" />
            </span>
          ) : (
            <IconButton
              icon="autoAwesome"
              label={body.trim() ? 'Aus den Stichworten schreiben' : 'Von der KI schreiben lassen'}
              size="compact"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => void write()}
            />
          ))}
        {/* Only where someone can be named (a mail's reply has no one). */}
        {(agents.length > 0 || people.length > 0) && (
          <IconButton
            icon="at"
            label="Jemanden erwähnen"
            size="compact"
            onPointerDown={(event) => event.preventDefault()}
            onClick={atSign}
          />
        )}
        {working && onStop && (
          <IconButton icon="stop" label="Stoppen" size="compact" onClick={onStop} />
        )}
        <span
          className={onSchedule ? cn('flex', ROW_MENU_CLASS) : 'flex'}
          {...(!onSchedule
            ? {}
            : sendable
              ? laterMenu.props
              : { onContextMenu: (event: MouseEvent) => event.preventDefault() })}
        >
          <IconButton
            type="submit"
            icon="arrowUpward"
            label="Senden"
            title={
              (sendKey === 'mod-enter'
                ? `Senden (${isApplePlatform() ? '⌘↵' : 'Strg+Enter'})`
                : 'Senden (Enter)') +
              (onSchedule ? '\nRechtsklick oder lange drücken: Später senden' : '')
            }
            size="compact"
            iconTone={sendable ? 'success' : undefined}
            disabled={!sendable}
          />
        </span>
        {laterMenu.at && (
          <ContextMenu
            label="Später senden"
            at={laterMenu.at}
            onClose={laterMenu.close}
            actions={[
              ...laterChoices().map(({ label, at }) => ({
                label,
                icon: 'schedule' as const,
                onSelect: () => later(at),
              })),
              {
                label: 'Zeit wählen …',
                icon: 'calendar' as const,
                divider: true,
                onSelect: () => {
                  const tomorrow = laterChoices()[1]!.at;
                  pickTime({ day: dayInput(tomorrow), time: timeInput(tomorrow) });
                },
              },
            ]}
          />
        )}
      </form>
    </>
  );
}
