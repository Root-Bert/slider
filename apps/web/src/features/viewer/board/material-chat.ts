import {
  MAX_MATERIAL_CHAT_MESSAGES,
  MAX_MATERIAL_CHAT_TEXT,
  type MaterialChatMessage,
} from '@slider/shared';
import { useSyncExternalStore } from 'react';
import { chatMaterial } from '@/lib/api';
import { ApiError } from '@/lib/api-client';

/*
 * The AI on the material page (✨, `MaterialChat`): one person's chat with the workspace's AI –
 * kept in this tab per deck (closing the panel keeps it, „Neuer Chat“ begins anew). Each
 * message sends the chat so far; the answer streams in (`services/material-chat.ts`).
 */

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** The AI's: `answering` while it is written. */
  state?: 'answering' | 'done' | 'failed' | 'stopped';
  /** What it does right now („Sucht im Web …“). */
  reading?: string | null;
  error?: string | null;
}

const NO_ENTRIES: readonly ChatEntry[] = [];
const chats = new Map<string, readonly ChatEntry[]>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const set = (deckId: string, entries: readonly ChatEntry[]) => {
  chats.set(deckId, entries);
  for (const listener of listeners) listener();
};
const patch = (deckId: string, id: string, change: (entry: ChatEntry) => ChatEntry) =>
  set(
    deckId,
    (chats.get(deckId) ?? NO_ENTRIES).map((entry) => (entry.id === id ? change(entry) : entry)),
  );

/** The deck's chat, sending, stopping and beginning anew; refusals go to `refused`. */
export function useMaterialChat(deckId: string, refused: (message: string) => void) {
  const entries = useSyncExternalStore(subscribe, () => chats.get(deckId) ?? NO_ENTRIES);
  const busy = entries.some((entry) => entry.state === 'answering');

  /** Sends `text`; `false` when it was refused at once (the text then stays in the field). */
  const send = async (text: string): Promise<boolean> => {
    const message = text.trim();
    if (!message || busy) return false;
    const before = chats.get(deckId) ?? NO_ENTRIES;
    const history: MaterialChatMessage[] = [
      ...before.flatMap((entry) =>
        entry.text.trim()
          ? [{ role: entry.role, text: entry.text.slice(0, MAX_MATERIAL_CHAT_TEXT) }]
          : [],
      ),
      { role: 'user' as const, text: message },
    ].slice(-MAX_MATERIAL_CHAT_MESSAGES);
    const asked: ChatEntry = { id: crypto.randomUUID(), role: 'user', text: message };
    const answer: ChatEntry = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      state: 'answering',
      reading: null,
    };
    set(deckId, [...before, asked, answer]);
    const controller = new AbortController();
    controllers.set(deckId, controller);
    let heard = false;
    try {
      await chatMaterial(
        deckId,
        { messages: history },
        (event) => {
          heard = true;
          if (event.type === 'text')
            patch(deckId, answer.id, (each) => ({
              ...each,
              text: each.text + event.text,
              reading: null,
            }));
          else if (event.type === 'reading')
            patch(deckId, answer.id, (each) => ({ ...each, reading: event.label }));
          else if (event.type === 'error')
            patch(deckId, answer.id, (each) => ({ ...each, error: event.message }));
          else patch(deckId, answer.id, (each) => ({ ...each, state: event.state, reading: null }));
        },
        controller.signal,
      );
    } catch (error) {
      if (!heard && error instanceof ApiError && error.status >= 400) {
        // Refused before it began (no AI, a Betrachter, too many at once): said, nothing hangs.
        set(
          deckId,
          (chats.get(deckId) ?? NO_ENTRIES).filter(
            (each) => each.id !== asked.id && each.id !== answer.id,
          ),
        );
        refused(error.message);
        return false;
      }
      patch(deckId, answer.id, (each) => ({
        ...each,
        state: 'failed',
        error: error instanceof ApiError ? error.message : 'Keine Verbindung zum Server.',
      }));
    } finally {
      if (controllers.get(deckId) === controller) controllers.delete(deckId);
      patch(deckId, answer.id, (each) =>
        each.state === 'answering'
          ? {
              ...each,
              state: controller.signal.aborted ? 'stopped' : 'failed',
              error: controller.signal.aborted ? null : 'Die Antwort ist abgebrochen.',
              reading: null,
            }
          : each,
      );
    }
    return true;
  };

  return {
    entries,
    busy,
    send,
    stop: () => controllers.get(deckId)?.abort(),
    /** „Neuer Chat“: the one running stops, the chat is gone. */
    clear: () => {
      controllers.get(deckId)?.abort();
      set(deckId, NO_ENTRIES);
    },
  };
}
