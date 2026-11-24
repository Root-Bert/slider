import {
  aiAuthor,
  type Attachment,
  type Author,
  type ReaderAiProposal,
  type ReaderAnchor,
  type ReaderComment,
  type ReaderField,
} from '@slider/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createPdfAiProposal,
  createPdfComment,
  deletePdfComment,
  fetchPdfAiProposals,
  fetchPdfComments,
  movePdfAiProposal,
  stopPdfAiProposal,
  updatePdfComment,
} from '@/lib/api';
import type { ShowToast } from '@/ui';

/** A comment at its place, with what was answered. */
export interface Thread {
  root: ReaderComment;
  replies: ReaderComment[];
}

export function threadsOf(comments: readonly ReaderComment[]): Thread[] {
  const byRoot = new Map<string, Thread>();
  for (const comment of comments) {
    if (comment.parentId === null) byRoot.set(comment.id, { root: comment, replies: [] });
  }
  for (const comment of comments) {
    if (comment.parentId !== null) byRoot.get(comment.parentId)?.replies.push(comment);
  }
  for (const thread of byRoot.values()) {
    thread.replies.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return [...byRoot.values()];
}

const NONE: ReaderComment[] = [];
const NO_PROPOSALS: ReaderAiProposal[] = [];

/** The PDF's comments: read once, changed at once, the server told after. */
export function usePdfComments(
  pdfId: string,
  me: Author,
  notify: ShowToast,
  /** The file's form fields, read by the viewer: handed to the AI to fill. */
  fieldsRef: { current: () => ReaderField[] },
) {
  const queryClient = useQueryClient();
  const key = ['reader-comments', pdfId] as const;
  const query = useQuery({ queryKey: key, queryFn: () => fetchPdfComments(pdfId) });

  const change = (update: (list: ReaderComment[]) => ReaderComment[]) =>
    queryClient.setQueryData<ReaderComment[]>(key, (list) => update(list ?? []));
  // What the AI did under them: told with the comments' own event, read with them.
  const aiKey = ['reader-ai', pdfId] as const;
  const ai = useQuery({ queryKey: aiKey, queryFn: () => fetchPdfAiProposals(pdfId) });
  const changeAi = (update: (list: ReaderAiProposal[]) => ReaderAiProposal[]) =>
    queryClient.setQueryData<ReaderAiProposal[]>(aiKey, (list) => update(list ?? []));
  const kept = (saved: ReaderAiProposal) =>
    changeAi((list) => list.map((each) => (each.id === saved.id ? saved : each)));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: aiKey });
  };
  /** Hands a comment to the AI: its card stands under it at once, working. */
  const askAi = (commentId: string) => {
    const fields = fieldsRef.current();
    const now = new Date().toISOString();
    const known = (queryClient.getQueryData<ReaderAiProposal[]>(aiKey) ?? [])[0]?.author;
    const proposal: ReaderAiProposal = {
      id: crypto.randomUUID(),
      pdfId,
      commentId,
      author: known ?? aiAuthor(null),
      status: 'running',
      summary: '',
      error: null,
      filled: 0,
      createdAt: now,
      updatedAt: now,
    };
    changeAi((list) => [
      ...list.filter(
        (each) =>
          each.commentId !== commentId || (each.status !== 'failed' && each.status !== 'stopped'),
      ),
      proposal,
    ]);
    createPdfAiProposal(pdfId, { id: proposal.id, commentId, fields }).then(
      // Done already when the answer comes: what was read meanwhile stays.
      (saved) =>
        changeAi((list) =>
          list.map((each) => (each.id === saved.id && each.status === 'running' ? saved : each)),
        ),
      (error: unknown) => {
        changeAi((list) => list.filter((each) => each.id !== proposal.id));
        notify(error instanceof Error ? error.message : 'Die KI ist nicht erreichbar.', 'danger');
      },
    );
  };
  const failed = (lead: string) => (error: unknown) => {
    notify(`${lead}: ${error instanceof Error ? error.message : 'nicht erreichbar'}`, 'danger');
    refresh();
  };

  return {
    comments: query.data ?? NONE,
    proposals: ai.data ?? NO_PROPOSALS,
    refresh,
    askAi,
    stopAi(id: string) {
      changeAi((list) =>
        list.map((each) => (each.id === id ? { ...each, status: 'stopped' } : each)),
      );
      stopPdfAiProposal(id).then(kept, failed('Nicht abgebrochen'));
    },
    /** „Zurücknehmen“ and „Wieder ausfüllen“: the fields follow as marks from the server. */
    moveAi(id: string, action: 'revert' | 'reapply') {
      changeAi((list) =>
        list.map((each) =>
          each.id === id ? { ...each, status: action === 'revert' ? 'reverted' : 'applied' } : each,
        ),
      );
      movePdfAiProposal(id, action).then(
        kept,
        failed(action === 'revert' ? 'Nicht zurückgenommen' : 'Nicht angewendet'),
      );
    },
    add(
      body: string,
      anchor: ReaderAnchor | null,
      parentId: string | null,
      /** Sent and handed to the AI in one (⌘↵). */
      toAi = false,
      /** Files put on it, up already. */
      attachments: Attachment[] = [],
    ) {
      const now = new Date().toISOString();
      const comment: ReaderComment = {
        id: crypto.randomUUID(),
        pdfId,
        parentId,
        author: me,
        body,
        attachments,
        anchor,
        status: 'open',
        resolvedBy: null,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      change((list) => [...list, comment]);
      createPdfComment(pdfId, {
        id: comment.id,
        parentId,
        body,
        attachments: attachments.map((one) => one.id),
        anchor,
      }).then((saved) => {
        change((list) => list.map((each) => (each.id === saved.id ? saved : each)));
        if (toAi) askAi(saved.id);
      }, failed('Kommentar nicht gesendet'));
      return comment.id;
    },
    setStatus(id: string, status: 'open' | 'done') {
      change((list) =>
        list.map((each) =>
          each.id === id
            ? {
                ...each,
                status,
                resolvedBy: status === 'done' ? me : null,
                resolvedAt: status === 'done' ? new Date().toISOString() : null,
              }
            : each,
        ),
      );
      updatePdfComment(id, { status }).catch(failed('Nicht gespeichert'));
    },
    edit(id: string, body: string) {
      change((list) => list.map((each) => (each.id === id ? { ...each, body } : each)));
      updatePdfComment(id, { body }).catch(failed('Nicht gespeichert'));
    },
    remove(id: string) {
      change((list) => list.filter((each) => each.id !== id && each.parentId !== id));
      changeAi((list) => list.filter((each) => each.commentId !== id));
      deletePdfComment(id).catch(failed('Nicht gelöscht'));
    },
  };
}

export type PdfComments = ReturnType<typeof usePdfComments>;
