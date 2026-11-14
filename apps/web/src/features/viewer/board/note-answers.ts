import {
  MATERIAL_CITATION,
  MAX_MATERIAL_QUESTION,
  type Material,
  type MaterialQuestion,
  type MaterialQuestionKind,
} from '@slider/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api-client';
import {
  askMaterial,
  queryKeys,
  stopMaterialAnswer,
  useDeleteMaterialAnswer,
  useMaterialQuestions,
} from '@/lib/api';
import { isApplePlatform } from '@/lib/platform';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';

/*
 * Asking the material from a note: ⌘↵ while its text is typed (or on a picked note, or its right
 * click „KI fragen“) hands the note's text to the workspace's AI, which answers from the deck's
 * material only (`services/material-questions.ts`). Under the note it has a thread as a comment
 * has – for everyone who sees the board: the AI's answer to the note (asked again, written anew
 * in its place), then the replies people write, each handed to the AI too or not (its answer
 * then under it, with the thread so far in mind). Sources are chips that open the file at its
 * page. An answer streams to the asker as it is written; the others see it once it is there
 * (the board's live event). A thread is folded as a comment's is, open once one asks or replies.
 */

/** The keys that ask, as this computer names them. */
export const askKeys = () => (isApplePlatform() ? '⌘↵' : 'Strg+↵');
/** A note's empty text: what it is for, and how to ask. */
export const notePlaceholder = () => 'Notiz …';

/**
 * An entry of a note's thread, with what the AI is reading right now while it writes; `replaced`:
 * the entry it is written in place of (gone already, for this tab).
 */
export type NoteAnswerValue = MaterialQuestion & { reading?: string | null; replaced?: string };

/** The entries being written in this tab, by id: laid over the server's (a refetch on the
 * board's live event would else cut what streamed so far). */
const streams = new Map<string, NoteAnswerValue>();
/** Their streams, by entry – aborting one stops the answer on the server. */
const controllers = new Map<string, AbortController>();
/** The notes whose thread is open. */
const opened = new Set<string>();
const listeners = new Set<() => void>();
let shown: ReadonlyMap<string, NoteAnswerValue> = new Map();
let shownOpen: ReadonlySet<string> = new Set();
const emit = () => {
  shown = new Map(streams);
  shownOpen = new Set(opened);
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Whether a note's thread is open, and opening or folding it (kept while the board is open). */
export function useThreadOpen(noteId: string): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribe, () => shownOpen).has(noteId);
  return [
    open,
    (next) => {
      if (next) opened.add(noteId);
      else opened.delete(noteId);
      emit();
    },
  ];
}

/** The notes whose thread is open: over every other card on the board. */
export const useOpenThreads = (): ReadonlySet<string> =>
  useSyncExternalStore(subscribe, () => shownOpen);

/** A thread's order: the note's own answer first, then as written. */
const byTime = (a: NoteAnswerValue, b: NoteAnswerValue) =>
  Number(b.kind === 'note') - Number(a.kind === 'note') ||
  a.createdAt.localeCompare(b.createdAt) ||
  a.id.localeCompare(b.id);

/** How an entry is asked: from the note (`note`) or a reply (`reply`, the AI `ask`ed or not). */
export interface AskOptions {
  kind?: MaterialQuestionKind;
  ask?: boolean;
  /** „Nochmal fragen“: written again in this entry's place. */
  replaces?: NoteAnswerValue;
}

/**
 * The deck's threads by note and asking: `saved` waits for a note just put down to be on the
 * server (the outbox sends it) – its thread is kept with it there.
 */
export function useNoteAnswers(saved: (noteId: string) => Promise<void>) {
  const { deck, viewer } = useViewerData();
  const deckId = deck.id;
  const queryClient = useQueryClient();
  const toast = useViewerToast();
  const query = useMaterialQuestions(deckId);
  const deleting = useDeleteMaterialAnswer(deckId);
  const local = useSyncExternalStore(subscribe, () => shown);
  const key = queryKeys.materialQuestions(deckId);

  const byNote = useMemo(() => {
    const all = new Map<string, NoteAnswerValue>();
    for (const entry of query.data ?? []) all.set(entry.id, entry);
    for (const [id, entry] of local) if (entry.deckId === deckId) all.set(id, entry);
    for (const entry of local.values()) if (entry.replaced) all.delete(entry.replaced);
    const map = new Map<string, NoteAnswerValue[]>();
    for (const entry of all.values()) {
      const thread = map.get(entry.noteId);
      if (thread) thread.push(entry);
      else map.set(entry.noteId, [entry]);
    }
    for (const thread of map.values()) thread.sort(byTime);
    return map;
  }, [query.data, local, deckId]);

  const ask = async (noteId: string, text: string, options: AskOptions = {}) => {
    const question = text.trim().slice(0, MAX_MATERIAL_QUESTION);
    if (!question) return;
    const { replaces } = options;
    const thread = byNote.get(noteId) ?? [];
    const kind = replaces?.kind ?? options.kind ?? 'note';
    // Asked from the note again: its earlier answer goes, the new one in its place.
    const earlier =
      replaces ?? (kind === 'note' ? thread.find((each) => each.kind === 'note') : undefined);
    const asking = (options.ask ?? true) || kind === 'note';
    const id = crypto.randomUUID();
    const controller = new AbortController();
    // Asked again while the earlier answer is written: that one stops (the server drops it).
    if (earlier) controllers.get(earlier.id)?.abort();
    if (asking) controllers.set(id, controller);
    const first = thread[0]?.createdAt;
    streams.set(id, {
      id,
      deckId,
      noteId,
      kind,
      author: kind === 'reply' ? (replaces?.author ?? viewer.author) : null,
      question,
      answer: '',
      state: asking ? 'answering' : null,
      error: null,
      createdAt:
        earlier?.createdAt ??
        (kind === 'note' && first
          ? new Date(Date.parse(first) - 1).toISOString()
          : new Date().toISOString()),
      reading: null,
      replaced: earlier?.id,
    });
    opened.add(noteId);
    emit();
    const patch = (change: (answer: NoteAnswerValue) => NoteAnswerValue) => {
      const current = streams.get(id);
      if (!current) return;
      streams.set(id, change(current));
      emit();
    };
    const drop = () => {
      if (!streams.delete(id)) return;
      emit();
    };
    try {
      await saved(noteId);
    } catch {
      // The note did not go (refused – said by the board – or deleted meanwhile).
      drop();
      return;
    }
    if (controller.signal.aborted) return;
    let heard = false;
    try {
      await askMaterial(
        deckId,
        { id, noteId, question, kind, ask: asking, replaces: replaces?.id },
        (event) => {
          heard = true;
          if (event.type === 'text')
            patch((each) => ({ ...each, answer: each.answer + event.text, reading: null }));
          else if (event.type === 'reading') patch((each) => ({ ...each, reading: event.label }));
          else if (event.type === 'error') patch((each) => ({ ...each, error: event.message }));
          else patch((each) => ({ ...event.question, reading: null, replaced: each.replaced }));
        },
        controller.signal,
      );
    } catch (error) {
      if (!heard && error instanceof ApiError && error.status >= 400) {
        // Refused before it began (no AI, a Betrachter, too many at once): said, nothing hangs.
        drop();
        toast(error.message, 'danger');
        return;
      }
      patch((each) => ({
        ...each,
        state: 'failed',
        error: error instanceof ApiError ? error.message : 'Keine Verbindung zum Server.',
      }));
    } finally {
      if (controllers.get(id) === controller) controllers.delete(id);
      patch((each) =>
        each.state === 'answering'
          ? {
              ...each,
              state: controller.signal.aborted ? 'stopped' : 'failed',
              error: controller.signal.aborted ? null : 'Die Antwort ist abgebrochen.',
              reading: null,
            }
          : each,
      );
      // Written: from now on the server's, as for everyone.
      const done = streams.get(id);
      if (done) {
        const { reading: _reading, replaced, ...kept } = done;
        queryClient.setQueryData<MaterialQuestion[]>(key, (all = []) => [
          ...all.filter((each) => each.id !== id && each.id !== replaced),
          kept,
        ]);
        streams.delete(id);
        emit();
      }
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const forget = (entry: NoteAnswerValue) => {
    controllers.get(entry.id)?.abort();
    if (streams.delete(entry.id)) emit();
  };

  return {
    byNote,
    ask: (noteId: string, text: string, options?: AskOptions) => void ask(noteId, text, options),
    /** Written in this tab (only the asker may stop it). */
    streaming: (entryId: string) => controllers.has(entryId),
    stop: (answer: NoteAnswerValue) => {
      void stopMaterialAnswer(answer.id).catch(() => controllers.get(answer.id)?.abort());
    },
    /** „Antwort löschen“: the AI's answer goes – a reply stays, not asked any more. */
    remove: (answer: NoteAnswerValue) => {
      forget(answer);
      deleting.mutate(
        { entry: answer, part: 'answer' },
        {
          onSuccess: () => toast('Antwort gelöscht'),
          onError: () => toast('Antwort nicht gelöscht', 'danger'),
        },
      );
    },
    /** A reply deleted by its writer, its answer with it. */
    removeReply: (reply: NoteAnswerValue) => {
      forget(reply);
      deleting.mutate(
        { entry: reply, part: 'all' },
        {
          onSuccess: () => toast('Antwort gelöscht'),
          onError: () => toast('Antwort nicht gelöscht', 'danger'),
        },
      );
    },
  };
}

/** The answer for the clipboard: its sources as the file's name (and page) in words. */
export function withoutSources(answer: string, byId: ReadonlyMap<string, Material>): string {
  return answer
    .replace(new RegExp(`\\s*${MATERIAL_CITATION.source}`, 'g'), (_, id: string, page?: string) => {
      const material = byId.get(id);
      if (!material) return '';
      const where =
        page && material.pages
          ? `, ${material.kind === 'presentation' ? 'Folie' : 'S.'} ${page}`
          : '';
      return ` (${material.name}${where})`;
    })
    .trim();
}
