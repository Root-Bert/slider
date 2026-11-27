import type { WriterAiProposal, WriterAnchor } from '@slider/shared';
import { createDocumentAiProposal, createDocumentComment, deleteDocumentComment } from '@/lib/api';
import { fetchDocument } from '@/lib/api/writer';

/* Asking a page's AI – from its agent bar, or from Notizen' for a note it makes. */

/** What a note made from Notizen' agent bar arrives with (router state): asked, or to be spoken to. */
export interface PageAgentArrival {
  asked?: string;
  speak?: boolean;
}
export const PAGE_AGENT_STATE = 'pageAgent';

/**
 * Asks a page's document AI: a comment (with its files) at `anchor`, then the AI on it. Refused
 * (no AI, too many at once): no comment is left behind. `commented`: the files are the comment's.
 * Nowhere in the text (no caret, a new note): at the file's first line – a comment stands somewhere.
 */
export async function askPageAi(
  documentId: string,
  ask: { body: string; attachments: string[]; anchor: WriterAnchor | null },
  commented?: () => void,
): Promise<WriterAiProposal> {
  const comment = await createDocumentComment(documentId, {
    id: crypto.randomUUID(),
    parentId: null,
    body: ask.body,
    attachments: ask.attachments,
    anchor: ask.anchor ?? (await firstLine(documentId)),
  });
  commented?.();
  try {
    return await createDocumentAiProposal(documentId, {
      id: crypto.randomUUID(),
      commentId: comment.id,
    });
  } catch (error) {
    void deleteDocumentComment(comment.id).catch(() => undefined);
    throw error;
  }
}

async function firstLine(documentId: string): Promise<WriterAnchor | null> {
  const block = (await fetchDocument(documentId)).content.blocks[0];
  return block ? { paragraphId: block.id, start: 0, end: 0, quote: '' } : null;
}
