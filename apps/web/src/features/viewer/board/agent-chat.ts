import {
  MAX_MATERIAL_CHAT_MESSAGES,
  MAX_MATERIAL_CHAT_TEXT,
  type CloudChatEvent,
} from '@slider/shared';
import { useSyncExternalStore } from 'react';
import { ApiError } from '@/lib/api-client';
import type { Chat, ChatEntry } from './ChatPanel';

/*
 * One person's chat with the workspace's AI that works with tools – beside the files in Cloud,
 * beside the presentations on Slider's start. The chat is held here per place (`key`), so
 * closing the panel or going elsewhere keeps it; „Neuer Chat“ begins anew. It is not kept on
 * the server: each message brings the talk so far.
 */

const open = new Map<string, readonly ChatEntry[]>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
const NONE: readonly ChatEntry[] = [];
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const current = (key: string) => open.get(key) ?? NONE;
const set = (key: string, entries: readonly ChatEntry[]) => {
  open.set(key, entries);
  for (const listener of listeners) listener();
};
const patch = (key: string, id: string, change: (entry: ChatEntry) => ChatEntry) =>
  set(
    key,
    current(key).map((entry) => (entry.id === id ? change(entry) : entry)),
  );

/** The talk so far as the server takes it: the latest messages, within its limits. */
function historyOf(entries: readonly ChatEntry[]) {
  const said = entries
    .filter((entry) => entry.text.trim())
    .map((entry) => ({ role: entry.role, text: entry.text.slice(0, MAX_MATERIAL_CHAT_TEXT) }));
  return said.slice(-MAX_MATERIAL_CHAT_MESSAGES);
}

/** The events every such chat tells; the others are the place's own. */
const SHARED = new Set<string>(['text', 'reading', 'changed', 'error', 'done']);

/** The talk so far, as sent with a message. */
export type AgentChatHistory = ReturnType<typeof historyOf>;

/**
 * The open chat of a place: sending, stopping, beginning anew. `ask` sends a message with the
 * talk so far and tells each event; `changed`: the AI touched something (the lists are read
 * again); `other`: an event of the place's own; refusals go to `refused`.
 */
export function useAgentChat<Event extends { type: string }>(
  key: string,
  ask: (
    text: string,
    history: AgentChatHistory,
    onEvent: (event: CloudChatEvent | Event) => void,
    signal: AbortSignal,
  ) => Promise<void>,
  on: {
    changed: () => void;
    refused: (message: string) => void;
    other?: (event: Event) => void;
  },
): Chat {
  const entries = useSyncExternalStore(subscribe, () => current(key));
  const busy = entries.some((entry) => entry.state === 'answering');
  const filesChanged = on.changed;

  const send = async (text: string): Promise<boolean> => {
    const message = text.trim();
    if (!message || busy) return false;
    const before = current(key);
    const asked: ChatEntry = { id: crypto.randomUUID(), role: 'user', text: message };
    const answer: ChatEntry = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      state: 'answering',
      reading: null,
    };
    set(key, [...before, asked, answer]);
    const controller = new AbortController();
    controllers.set(key, controller);
    let heard = false;
    let touched = false;
    try {
      await ask(
        message,
        historyOf(before),
        (told) => {
          heard = true;
          if (!SHARED.has(told.type)) {
            on.other?.(told as Event);
            return;
          }
          const event = told as CloudChatEvent;
          if (event.type === 'text')
            patch(key, answer.id, (each) => ({
              ...each,
              text: each.text + event.text,
              reading: null,
              readingIn: null,
            }));
          else if (event.type === 'reading')
            patch(key, answer.id, (each) => ({
              ...each,
              reading: event.label,
              readingIn: event.app ?? null,
            }));
          else if (event.type === 'changed') {
            // Shown as it happens: the folder fills, the names change while it works.
            touched = true;
            filesChanged();
          } else if (event.type === 'error')
            patch(key, answer.id, (each) => ({ ...each, error: event.message }));
          else
            patch(key, answer.id, (each) => ({
              ...each,
              state: event.state,
              reading: null,
            }));
        },
        controller.signal,
      );
    } catch (error) {
      if (!heard && error instanceof ApiError && error.status >= 400) {
        // Refused before it began (no AI, too many at once): said, nothing hangs.
        set(
          key,
          current(key).filter((each) => each.id !== asked.id && each.id !== answer.id),
        );
        on.refused(error.message);
        return false;
      }
      patch(key, answer.id, (each) => ({
        ...each,
        state: 'failed',
        error: error instanceof ApiError ? error.message : 'Keine Verbindung zum Server.',
      }));
    } finally {
      if (controllers.get(key) === controller) controllers.delete(key);
      patch(key, answer.id, (each) =>
        each.state === 'answering'
          ? {
              ...each,
              state: controller.signal.aborted ? 'stopped' : 'failed',
              error: controller.signal.aborted ? null : 'Die Antwort ist abgebrochen.',
              reading: null,
            }
          : each,
      );
      if (touched) filesChanged();
    }
    return true;
  };

  return {
    entries,
    busy,
    send,
    stop: () => controllers.get(key)?.abort(),
    /** „Neuer Chat“: the one running stops, an empty chat opens. */
    clear: () => {
      controllers.get(key)?.abort();
      set(key, NONE);
    },
  };
}
