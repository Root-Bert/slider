import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CloudNode } from '@slider/shared';
import { cloudKeys } from '@/lib/api';
import { sendFile, type PickedFile, type UploadTarget } from '../lib/upload';

/** How many files go up at once; the rest wait their turn. */
const PARALLEL = 3;

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  sent: number;
  status: 'waiting' | 'sending' | 'done' | 'failed';
  error?: string;
  /** The stored file, once it is there. */
  node?: CloudNode;
  /** `false`: it became the next version of a file that was there. */
  created?: boolean;
}

interface Job {
  picked: PickedFile;
  target: UploadTarget;
  controller: AbortController;
}

type Action =
  | { type: 'add'; items: UploadItem[] }
  | { type: 'patch'; id: string; patch: Partial<UploadItem> }
  | { type: 'remove'; ids: string[] };

function reduce(items: UploadItem[], action: Action): UploadItem[] {
  if (action.type === 'add') return [...items, ...action.items];
  if (action.type === 'remove') return items.filter((item) => !action.ids.includes(item.id));
  return items.map((item) => (item.id === action.id ? { ...item, ...action.patch } : item));
}

/**
 * The uploads of this page: a queue that sends a few files at a time, each with its progress,
 * its error and a way to stop or retry it. What is through shows in the lists at once.
 */
export function useUploads(workspaceId: string) {
  const queryClient = useQueryClient();
  const [items, dispatch] = useReducer(reduce, []);
  const jobs = useRef(new Map<string, Job>());
  const waiting = useRef<string[]>([]);
  const running = useRef(0);
  const refresh = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Each upload that ends starts the next – through a ref, the function names itself.
  const next = useRef<() => void>(() => {});
  const pump = useCallback(() => {
    while (running.current < PARALLEL && waiting.current.length > 0) {
      const id = waiting.current.shift();
      const job = id ? jobs.current.get(id) : undefined;
      if (!id || !job) continue;
      running.current += 1;
      dispatch({ type: 'patch', id, patch: { status: 'sending', error: undefined } });
      void sendFile(
        { workspaceId, file: job.picked.file, path: job.picked.path || undefined, ...job.target },
        (sent) => dispatch({ type: 'patch', id, patch: { sent } }),
        job.controller.signal,
      )
        .then((result) => {
          dispatch({
            type: 'patch',
            id,
            patch: {
              status: 'done',
              sent: job.picked.file.size,
              node: result.node,
              created: result.created,
            },
          });
          jobs.current.delete(id);
          // Many files finishing in a row ask for the lists once.
          clearTimeout(refresh.current);
          refresh.current = setTimeout(
            () => void queryClient.invalidateQueries({ queryKey: cloudKeys.all(workspaceId) }),
            250,
          );
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            jobs.current.delete(id);
            dispatch({ type: 'remove', ids: [id] });
            return;
          }
          dispatch({
            type: 'patch',
            id,
            patch: {
              status: 'failed',
              error: error instanceof Error ? error.message : 'Upload fehlgeschlagen.',
            },
          });
        })
        .finally(() => {
          running.current -= 1;
          next.current();
        });
    }
  }, [queryClient, workspaceId]);
  useEffect(() => {
    next.current = pump;
  }, [pump]);

  const add = useCallback(
    (picked: readonly PickedFile[], target: UploadTarget) => {
      const added = picked.map((each) => {
        const id = crypto.randomUUID();
        jobs.current.set(id, { picked: each, target, controller: new AbortController() });
        waiting.current.push(id);
        return {
          id,
          name: each.file.name,
          size: each.file.size,
          sent: 0,
          status: 'waiting',
        } satisfies UploadItem;
      });
      dispatch({ type: 'add', items: added });
      pump();
    },
    [pump],
  );

  const cancel = useCallback((id: string) => {
    const job = jobs.current.get(id);
    waiting.current = waiting.current.filter((each) => each !== id);
    if (job) job.controller.abort();
    // Not started yet (or failed): nothing answers the abort, so it goes here.
    jobs.current.delete(id);
    dispatch({ type: 'remove', ids: [id] });
  }, []);

  const retry = useCallback(
    (id: string) => {
      const job = jobs.current.get(id);
      if (!job) return;
      jobs.current.set(id, { ...job, controller: new AbortController() });
      waiting.current.push(id);
      dispatch({ type: 'patch', id, patch: { status: 'waiting', sent: 0, error: undefined } });
      pump();
    },
    [pump],
  );

  const clear = useCallback(() => {
    for (const [id, job] of jobs.current) {
      job.controller.abort();
      jobs.current.delete(id);
    }
    waiting.current = [];
    dispatch({ type: 'remove', ids: items.map((item) => item.id) });
  }, [items]);

  const busy = items.some((item) => item.status === 'waiting' || item.status === 'sending');
  // Leaving the page mid-upload loses what has not gone up: the browser asks first.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  return { items, add, cancel, retry, clear, busy };
}

export type Uploads = ReturnType<typeof useUploads>;
