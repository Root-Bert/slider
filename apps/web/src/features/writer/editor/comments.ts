import {
  aiAuthor,
  movedAnchor,
  type Attachment,
  type Author,
  type WriterAiProposal,
  type WriterAnchor,
  type WriterComment,
  type CommentReactionKind,
} from '@slider/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createDocumentAiProposal,
  createDocumentComment,
  deleteDocumentComment,
  fetchDocumentAiProposals,
  fetchDocumentComments,
  moveDocumentAiProposal,
  stopDocumentAiProposal,
  updateDocumentComment,
  setDocumentCommentReaction,
  writerKeys,
} from '@/lib/api';
import type { ShowToast } from '@/ui';
import { entries, lengthOf, type Blocks } from '../lib/model';
import type { TextChange } from './engine';

/** A comment at its words, with what was answered. */
export interface Thread {
  root: WriterComment;
  replies: WriterComment[];
}

export function threadsOf(comments: readonly WriterComment[]): Thread[] {
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

const NONE: WriterComment[] = [];
const NO_PROPOSALS: WriterAiProposal[] = [];

/** The document's comments: read once, changed at once, the server told after. */
export function useDocumentComments(documentId: string, me: Author, notify: ShowToast) {
  const queryClient = useQueryClient();
  const key = writerKeys.comments(documentId);
  const query = useQuery({ queryKey: key, queryFn: () => fetchDocumentComments(documentId) });

  const change = (update: (list: WriterComment[]) => WriterComment[]) =>
    queryClient.setQueryData<WriterComment[]>(key, (list) => update(list ?? []));
  // What the AI did under them: told with the comments' own event, read with them.
  const aiKey = writerKeys.aiProposals(documentId);
  const ai = useQuery({ queryKey: aiKey, queryFn: () => fetchDocumentAiProposals(documentId) });
  const changeAi = (update: (list: WriterAiProposal[]) => WriterAiProposal[]) =>
    queryClient.setQueryData<WriterAiProposal[]>(aiKey, (list) => update(list ?? []));
  const kept = (saved: WriterAiProposal) =>
    changeAi((list) => list.map((each) => (each.id === saved.id ? saved : each)));
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: aiKey });
  };
  /** Hands a comment to the AI: its card stands under it at once, working. */
  const askAi = (commentId: string) => {
    const now = new Date().toISOString();
    const known = (queryClient.getQueryData<WriterAiProposal[]>(aiKey) ?? [])[0]?.author;
    const proposal: WriterAiProposal = {
      id: crypto.randomUUID(),
      documentId,
      commentId,
      author: known ?? aiAuthor(null),
      status: 'running',
      summary: '',
      error: null,
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
    createDocumentAiProposal(documentId, { id: proposal.id, commentId }).then(
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
      stopDocumentAiProposal(id).then(kept, failed('Nicht abgebrochen'));
    },
    /** „Änderung zurücknehmen“ and „Wieder anwenden“: the text follows as a step from the server. */
    moveAi(id: string, action: 'revert' | 'reapply') {
      changeAi((list) =>
        list.map((each) =>
          each.id === id ? { ...each, status: action === 'revert' ? 'reverted' : 'applied' } : each,
        ),
      );
      moveDocumentAiProposal(id, action).then(
        kept,
        failed(action === 'revert' ? 'Nicht zurückgenommen' : 'Nicht angewendet'),
      );
    },
    add(
      body: string,
      anchor: WriterAnchor | null,
      parentId: string | null,
      /** Sent and handed to the AI in one (⌘↵). */
      toAi = false,
      /** Files put on it, up already. */
      attachments: Attachment[] = [],
    ) {
      const now = new Date().toISOString();
      const comment: WriterComment = {
        id: crypto.randomUUID(),
        documentId,
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
      createDocumentComment(documentId, {
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
    /** One's own reaction (👍 / 👎 / egal), or `null` taking it back – at once, as on a slide. */
    react(id: string, kind: CommentReactionKind | null) {
      change((list) =>
        list.map((each) => {
          if (each.id !== id) return each;
          const others = (each.reactions ?? []).filter((one) => one.author.id !== me.id);
          return { ...each, reactions: kind ? [...others, { kind, author: me }] : others };
        }),
      );
      setDocumentCommentReaction(id, kind).then(
        (saved) => change((list) => list.map((each) => (each.id === saved.id ? saved : each))),
        failed('Reaktion nicht gespeichert'),
      );
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
      updateDocumentComment(id, { status }).catch(failed('Nicht gespeichert'));
    },
    edit(id: string, body: string) {
      change((list) => list.map((each) => (each.id === id ? { ...each, body } : each)));
      updateDocumentComment(id, { body }).catch(failed('Nicht gespeichert'));
    },
    remove(id: string) {
      change((list) => list.filter((each) => each.id !== id && each.parentId !== id));
      changeAi((list) => list.filter((each) => each.commentId !== id));
      deleteDocumentComment(id).catch(failed('Nicht gelöscht'));
    },
    /** Words changed under comments: they stay at theirs. */
    move(changes: readonly TextChange[]) {
      const byId = new Map(changes.map((each) => [each.id, each]));
      change((list) => {
        let touched = false;
        const next = list.map((each) => {
          if (!each.anchor) return each;
          const anchor = movedAnchor(each.anchor, (id) => byId.get(id));
          if (anchor === each.anchor) return each;
          touched = true;
          return { ...each, anchor };
        });
        return touched ? next : list;
      });
    },
  };
}

export type DocumentComments = ReturnType<typeof useDocumentComments>;

/** The stretches a comment covers, one per paragraph it runs through, in reading order. */
export function partsOf(
  blocks: Blocks,
  anchor: WriterAnchor,
): { id: string; start: number; end: number }[] {
  const list = entries(blocks);
  const first = list.findIndex((entry) => entry.block.id === anchor.paragraphId);
  const from = list[first];
  if (!from) return [];
  const length = lengthOf(from.block);
  const start = Math.min(anchor.start, length);
  const to = anchor.to;
  const last = to
    ? list.findIndex((entry, index) => index > first && entry.block.id === to.paragraphId)
    : -1;
  // One paragraph – or the one it ran on into is gone: what is left of it here.
  if (!to || last < 0) {
    return [{ id: from.block.id, start, end: Math.min(Math.max(anchor.end, start), length) }];
  }
  const parts = [{ id: from.block.id, start, end: length }];
  for (let index = first + 1; index < last; index += 1) {
    const block = list[index]?.block;
    if (block) parts.push({ id: block.id, start: 0, end: lengthOf(block) });
  }
  const end = list[last]?.block;
  if (end) parts.push({ id: end.id, start: 0, end: Math.min(to.offset, lengthOf(end)) });
  return parts;
}
