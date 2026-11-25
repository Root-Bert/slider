import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CLOUD_PDF_BATCH,
  cloudBaseName,
  type CloudBatchResult,
  type CloudNode,
} from '@slider/shared';
import { cloudKeys } from '@/lib/api';
import { api } from '@/lib/api-client';
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
  /** Made by the server („Als PDF ablegen“), not sent from here: no bytes to count or stop. */
  made?: boolean;
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

  /**
   * „Als PDF ablegen“: each PDF a line here while the server makes it – it lies beside its file,
   * maybe not where one is, and its name opens it. A few per request, one request after another.
   */
  const makePdfs = useCallback(
    async (nodes: readonly CloudNode[]) => {
      const lines = nodes.map((node) => ({ node, id: crypto.randomUUID() }));
      dispatch({
        type: 'add',
        items: lines.map(({ node, id }) => ({
          id,
          name: `${cloudBaseName(node.name)}.pdf`,
          size: 0,
          sent: 0,
          status: 'sending',
          made: true,
        })),
      });
      for (let at = 0; at < lines.length; at += CLOUD_PDF_BATCH) {
        const chunk = lines.slice(at, at + CLOUD_PDF_BATCH);
        try {
          const result = await api.post<CloudBatchResult>('/cloud/nodes/pdf', {
            ids: chunk.map(({ node }) => node.id),
          });
          // The PDFs come in the order asked, without those skipped.
          const skipped = new Map(result.skipped.map((each) => [each.id, each.reason]));
          let next = 0;
          for (const { node, id } of chunk) {
            const reason = skipped.get(node.id);
            const pdf = reason === undefined ? result.nodes[next++] : undefined;
            dispatch({
              type: 'patch',
              id,
              patch: pdf
                ? { status: 'done', node: pdf, size: pdf.sizeBytes, sent: pdf.sizeBytes }
                : { status: 'failed', error: reason ?? 'Kein PDF entstanden.' },
            });
          }
        } catch (error) {
          for (const { id } of chunk) {
            dispatch({
              type: 'patch',
              id,
              patch: {
                status: 'failed',
                error: error instanceof Error ? error.message : 'Kein PDF entstanden.',
              },
            });
          }
        }
        void queryClient.invalidateQueries({ queryKey: cloudKeys.all(workspaceId) });
      }
    },
    [queryClient, workspaceId],
  );

  const busy = items.some((item) => item.status === 'waiting' || item.status === 'sending');
  // Leaving the page mid-upload loses what has not gone up: the browser asks first. (A PDF the
  // server makes is made anyway.)
  const sending = items.some(
    (item) => !item.made && (item.status === 'waiting' || item.status === 'sending'),
  );
  useEffect(() => {
    if (!sending) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [sending]);

  return { items, add, cancel, retry, clear, busy, makePdfs };
}

export type Uploads = ReturnType<typeof useUploads>;
