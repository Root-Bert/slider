import { MAX_MATERIAL_QUESTION, type MaterialQuestion } from '@slider/shared';
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
 * material only (`services/material-questions.ts`). The answer hangs under the note as a reply
 * to a comment – for everyone who sees the board, one per note (asked again, it is written anew)
 * – its sources chips that open the file at its page. It streams to the asker as it is written;
 * the others see it once it is there (the board's live event).
 */

/** The keys that ask, as this computer names them. */
export const askKeys = () => (isApplePlatform() ? '⌘↵' : 'Strg+↵');
/** A note's empty text: what it is for, and how to ask. */
export const notePlaceholder = () => `Notiz … ${askKeys()} fragt die KI`;

/** An answer, with what the AI is reading right now while it writes. */
export type NoteAnswerValue = MaterialQuestion & { reading?: string | null };

/** The answers being written in this tab, by note: laid over the server's (a refetch on the
 * board's live event would else cut what streamed so far). */
const streams = new Map<string, NoteAnswerValue>();
/** Their streams, by note – aborting one stops the answer on the server. */
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let shown: ReadonlyMap<string, NoteAnswerValue> = new Map();
const emit = () => {
  shown = new Map(streams);
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/**
 * The deck's answers by note and asking: `saved` waits for a note just put down to be on the
 * server (the outbox sends it) – the answer is kept with it there.
 */
export function useNoteAnswers(saved: (noteId: string) => Promise<void>) {
  const { deck } = useViewerData();
  const deckId = deck.id;
  const queryClient = useQueryClient();
  const toast = useViewerToast();
  const query = useMaterialQuestions(deckId);
  const deleting = useDeleteMaterialAnswer(deckId);
  const local = useSyncExternalStore(subscribe, () => shown);
  const key = queryKeys.materialQuestions(deckId);

  const byNote = useMemo(() => {
    const map = new Map<string, NoteAnswerValue>();
    for (const answer of query.data ?? []) map.set(answer.noteId, answer);
    for (const [noteId, answer] of local) if (answer.deckId === deckId) map.set(noteId, answer);
    return map;
  }, [query.data, local, deckId]);

  const ask = async (noteId: string, text: string) => {
    const question = text.trim().slice(0, MAX_MATERIAL_QUESTION);
    if (!question) return;
    const id = crypto.randomUUID();
    const controller = new AbortController();
    // Asked again while the earlier answer is written: that one stops (the server drops it).
    controllers.get(noteId)?.abort();
    controllers.set(noteId, controller);
    streams.set(noteId, {
      id,
      deckId,
      noteId,
      question,
      answer: '',
      state: 'answering',
      error: null,
      createdAt: new Date().toISOString(),
      reading: null,
    });
    emit();
    const patch = (change: (answer: NoteAnswerValue) => NoteAnswerValue) => {
      const current = streams.get(noteId);
      if (current?.id !== id) return;
      streams.set(noteId, change(current));
      emit();
    };
    const drop = () => {
      if (streams.get(noteId)?.id !== id) return;
      streams.delete(noteId);
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
        { id, noteId, question },
        (event) => {
          heard = true;
          if (event.type === 'text')
            patch((each) => ({ ...each, answer: each.answer + event.text, reading: null }));
          else if (event.type === 'reading') patch((each) => ({ ...each, reading: event.label }));
          else if (event.type === 'error') patch((each) => ({ ...each, error: event.message }));
          else patch(() => ({ ...event.question, reading: null }));
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
      if (controllers.get(noteId) === controller) controllers.delete(noteId);
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
      const done = streams.get(noteId);
      if (done?.id === id) {
        queryClient.setQueryData<MaterialQuestion[]>(key, (all = []) => [
          ...all.filter((each) => each.noteId !== noteId),
          done,
        ]);
        streams.delete(noteId);
        emit();
      }
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };

  return {
    byNote,
    ask: (noteId: string, text: string) => void ask(noteId, text),
    /** Written in this tab (only the asker may stop it). */
    streaming: (noteId: string) => controllers.has(noteId),
    stop: (answer: NoteAnswerValue) => {
      void stopMaterialAnswer(answer.id).catch(() => controllers.get(answer.noteId)?.abort());
    },
    remove: (answer: NoteAnswerValue) => {
      controllers.get(answer.noteId)?.abort();
      if (streams.get(answer.noteId)?.id === answer.id) {
        streams.delete(answer.noteId);
        emit();
      }
      deleting.mutate(answer.id, {
        onSuccess: () => toast('Antwort gelöscht'),
        onError: () => toast('Antwort nicht gelöscht', 'danger'),
      });
    },
  };
}
