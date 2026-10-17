import { useCallback, useSyncExternalStore } from 'react';

/**
 * Unsent text replies per thread id. They live outside the reply fields, which come and go: a
 * card's column is windowed out by scrolling or turns compact, the thread panel shows another
 * thread. The text is there again when the field is, and every field of a thread (card, inline,
 * panel) shows the same draft. Only that thread's fields re-render on a keystroke.
 */
const drafts = new Map<string, string>();
const listeners = new Set<() => void>();

export const replyDrafts = {
  get: (threadId: string): string => drafts.get(threadId) ?? '',
  set(threadId: string, next: string | ((current: string) => string)) {
    const body = typeof next === 'function' ? next(replyDrafts.get(threadId)) : next;
    if (body === replyDrafts.get(threadId)) return;
    if (body) drafts.set(threadId, body);
    else drafts.delete(threadId);
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Tests only. */
  clear() {
    drafts.clear();
  },
};

/** The unsent reply of a thread and its setter, like `useState` but kept per thread. */
export function useReplyDraftBody(
  threadId: string,
): [string, (next: string | ((current: string) => string)) => void] {
  const body = useSyncExternalStore(
    replyDrafts.subscribe,
    () => replyDrafts.get(threadId),
    () => replyDrafts.get(threadId),
  );
  const setBody = useCallback(
    (next: string | ((current: string) => string)) => replyDrafts.set(threadId, next),
    [threadId],
  );
  return [body, setBody];
}
