import { useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import { postSpellingWord, spellingKeys, useMe, useOwnWords, useWorkspaceWords } from '@/lib/api';
import { ViewerDataContext } from '../state/viewer-data';

/**
 * Words said to be right and not on the server yet – offline, signed out, or not sent yet. Kept in
 * this browser until they are; from before the server kept them, plain strings (account only).
 */
const STORAGE_KEY = 'slider.spelling.accepted';

interface Queued {
  word: string;
  /** Also into this workspace's dictionary; `null`: only the account's. */
  workspaceId: string | null;
}

function read(): readonly Queued[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.flatMap((item): Queued[] => {
      if (typeof item === 'string') return [{ word: item, workspaceId: null }];
      if (item && typeof item === 'object' && typeof item.word === 'string') {
        const { workspaceId } = item as { workspaceId?: unknown };
        return [
          { word: item.word, workspaceId: typeof workspaceId === 'string' ? workspaceId : null },
        ];
      }
      return [];
    });
  } catch {
    return [];
  }
}

let queued: readonly Queued[] | null = null;
const listeners = new Set<() => void>();

const current = () => (queued ??= read());

function write(next: readonly Queued[]) {
  queued = next;
  try {
    if (next.length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not stored (private window): right for as long as the page is open.
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Where the open deck's words go: the account, and its workspace when one may add to it. */
interface Scope {
  /** `null`: signed out – words stay in this browser. */
  userId: string | null;
  /** The deck's workspace when one is in it (its words are read). */
  workspaceId: string | null;
  /** Workspaces one may add words to (reviewers up, as comments). */
  writable: ReadonlySet<string>;
}

function useScope(): Scope {
  const { data: me } = useMe();
  // Outside a deck (no viewer data): the account only.
  const deckWorkspace = useContext(ViewerDataContext)?.deck.workspaceId ?? null;
  const userId = me?.user?.id ?? null;
  const workspaces = me?.workspaces;
  return useMemo(() => {
    const member = workspaces?.find((workspace) => workspace.id === deckWorkspace);
    return {
      userId,
      workspaceId: userId && member ? member.id : null,
      writable: new Set((workspaces ?? []).filter((w) => w.role !== 'viewer').map((w) => w.id)),
    };
  }, [userId, workspaces, deckWorkspace]);
}

let flushing = false;

/**
 * Sends the words waiting here, oldest first: to the account, and to their workspace when one may
 * still add to it. Offline (or the server away) they wait for the next time; a word the server
 * refuses (too long, too many) is dropped.
 */
async function flush(client: QueryClient, scope: Scope) {
  if (flushing || !scope.userId) return;
  flushing = true;
  try {
    for (const item of current()) {
      try {
        client.setQueryData(spellingKeys.own, await postSpellingWord(null, item.word));
        if (item.workspaceId && scope.writable.has(item.workspaceId)) {
          client.setQueryData(
            spellingKeys.workspace(item.workspaceId),
            await postSpellingWord(item.workspaceId, item.word),
          );
        }
      } catch (error) {
        const refused = error instanceof ApiError && error.status >= 400 && error.status < 500;
        if (!refused) break;
      }
      write(current().filter((other) => other !== item));
    }
  } finally {
    flushing = false;
  }
}

/**
 * The words one said are right: the account's, the deck's workspace's and those still waiting
 * here – the same object until one changes. Sends what waits once signed in.
 */
export function useAcceptedWords(): ReadonlySet<string> {
  const waiting = useSyncExternalStore(subscribe, current);
  const scope = useScope();
  const client = useQueryClient();
  const own = useOwnWords(scope.userId !== null).data;
  const team = useWorkspaceWords(scope.workspaceId).data;
  useEffect(() => {
    if (waiting.length > 0) void flush(client, scope);
  }, [waiting, client, scope]);
  return useMemo(
    () =>
      new Set([
        ...waiting.map((item) => item.word),
        ...(own ?? []).map((item) => item.word),
        ...(team ?? []).map((item) => item.word),
      ]),
    [waiting, own, team],
  );
}

/**
 * „Passt so“ on a misspelt word (right click on it): no longer marked, at once – into the
 * account's dictionary and the deck's workspace's („Wörter“ in its Bibliothek).
 */
export function useAcceptWord(): (word: string) => void {
  const scope = useScope();
  const client = useQueryClient();
  return useCallback(
    (word: string) => {
      const workspaceId =
        scope.workspaceId && scope.writable.has(scope.workspaceId) ? scope.workspaceId : null;
      const waiting = current();
      if (!waiting.some((item) => item.word === word && item.workspaceId === workspaceId)) {
        write([...waiting, { word, workspaceId }]);
      }
      void flush(client, scope);
    },
    [client, scope],
  );
}
