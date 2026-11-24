import type { Attachment, Material, MaterialChatDto } from '@slider/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { boardKeys, chatMaterial, getMaterialChat, type BoardRef } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import type { ChatEntry } from './ChatPanel';

/*
 * The AI on the material page (✨, `MaterialChat`): one person's chats with the workspace's AI,
 * kept on the server per deck or document (`services/material-chat.ts`). The one open is held here
 * per owner,
 * so closing the panel keeps it; „Neuer Chat“ begins anew, an earlier one opens from the list.
 * Each message sends only itself – the server knows the chat so far; the answer streams in.
 */

interface OpenChat {
  /** `null`: a new chat, not sent yet. */
  chatId: string | null;
  entries: readonly ChatEntry[];
}

const NEW_CHAT: OpenChat = { chatId: null, entries: [] };
const open = new Map<string, OpenChat>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
const set = (deckId: string, chat: OpenChat) => {
  open.set(deckId, chat);
  for (const listener of listeners) listener();
};
const current = (deckId: string) => open.get(deckId) ?? NEW_CHAT;
const patch = (deckId: string, id: string, change: (entry: ChatEntry) => ChatEntry) => {
  const now = current(deckId);
  if (!now.entries.some((entry) => entry.id === id)) return;
  set(deckId, {
    ...now,
    entries: now.entries.map((entry) => (entry.id === id ? change(entry) : entry)),
  });
};

/** A kept chat as the panel shows it. */
const entriesOf = (chat: MaterialChatDto): ChatEntry[] =>
  chat.messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    ...(message.attachments?.length ? { attachments: message.attachments } : {}),
    ...(message.state ? { state: message.state } : {}),
    error: message.error,
  }));

/** The board's open chat (by its owner), sending, stopping, beginning anew, opening a kept one; refusals go to `refused`. */
export function useMaterialChat(owner: BoardRef, refused: (message: string) => void) {
  const deckId = owner.id;
  const queryClient = useQueryClient();
  const chat = useSyncExternalStore(subscribe, () => current(deckId));
  const busy = chat.entries.some((entry) => entry.state === 'answering');
  const listChanged = () =>
    void queryClient.invalidateQueries({ queryKey: boardKeys.chats(owner) });

  /** Sends `text`; `false` when it was refused at once (the text then stays in the field). */
  const send = async (text: string, attachments: Attachment[] = []): Promise<boolean> => {
    const message = text.trim();
    if ((!message && attachments.length === 0) || busy) return false;
    const before = current(deckId);
    const asked: ChatEntry = {
      id: crypto.randomUUID(),
      role: 'user',
      text: message,
      ...(attachments.length ? { attachments } : {}),
    };
    const answer: ChatEntry = {
      id: crypto.randomUUID(),
      role: 'assistant',
      text: '',
      state: 'answering',
      reading: null,
    };
    set(deckId, { ...before, entries: [...before.entries, asked, answer] });
    const controller = new AbortController();
    controllers.set(deckId, controller);
    let heard = false;
    try {
      await chatMaterial(
        owner,
        { chatId: before.chatId, text: message, attachments: attachments.map((one) => one.id) },
        (event) => {
          heard = true;
          if (event.type === 'chat') {
            const now = current(deckId);
            if (now.entries.some((entry) => entry.id === answer.id))
              set(deckId, { ...now, chatId: event.id });
            if (!before.chatId) listChanged();
          } else if (event.type === 'text')
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
        // The chat deleted meanwhile (another tab): an empty one opens, the text back in the field.
        const now = current(deckId);
        if (error.status === 404 && before.chatId) set(deckId, NEW_CHAT);
        else
          set(deckId, {
            ...now,
            entries: now.entries.filter((each) => each.id !== asked.id && each.id !== answer.id),
          });
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
      // The list sorts by the latest message.
      listChanged();
    }
    return true;
  };

  /** „Neuer Chat“: the one running stops (kept as far as it got), an empty chat opens. */
  const clear = () => {
    controllers.get(deckId)?.abort();
    set(deckId, NEW_CHAT);
  };

  /** An earlier chat from the list, with its messages. */
  const openChat = async (chatId: string) => {
    if (busy) return;
    try {
      const kept = await getMaterialChat(owner, chatId);
      // Sent something meanwhile (or opened another): that one stays.
      if (current(deckId).entries.length === 0)
        set(deckId, { chatId: kept.id, entries: entriesOf(kept) });
    } catch (error) {
      refused(error instanceof ApiError ? error.message : 'Keine Verbindung zum Server.');
      listChanged();
    }
  };

  return {
    chatId: chat.chatId,
    entries: chat.entries,
    busy,
    send,
    stop: () => controllers.get(deckId)?.abort(),
    clear,
    openChat,
  };
}

/** An answer's source opened: the file in a tab of its own, a PDF at its page. */
export function openSource(material: Material, page: number | null) {
  if (!material.url) return;
  const at = page && material.kind === 'pdf' ? `#page=${page}` : '';
  window.open(`${material.url}${at}`, '_blank', 'noopener');
}
