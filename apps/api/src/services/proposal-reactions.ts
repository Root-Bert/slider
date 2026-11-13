import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AiProposal, CommentReaction, CommentReactionKind, Viewer } from '@slider/shared';
import { requireDeckAccess } from '../auth/access';
import { displayAuthor } from '../authors';
import type { Executor } from '../db/client';
import { aiProposalReactions, aiProposals } from '../db/schema';
import type { AppDeps } from '../deps';
import { notFound } from '../http/errors';

/** Reactions to the given AI answers, by proposal id, oldest first – as for comments. */
async function reactionsByProposal(
  db: Executor,
  proposalIds: readonly string[],
): Promise<Map<string, CommentReaction[]>> {
  const byProposal = new Map<string, CommentReaction[]>();
  if (proposalIds.length === 0) return byProposal;
  const rows = await db
    .select()
    .from(aiProposalReactions)
    .where(inArray(aiProposalReactions.proposalId, [...proposalIds]))
    .orderBy(asc(aiProposalReactions.createdAt), asc(aiProposalReactions.userId));
  for (const row of rows) {
    const list = byProposal.get(row.proposalId) ?? [];
    list.push({ kind: row.kind, author: displayAuthor(row.author) });
    byProposal.set(row.proposalId, list);
  }
  return byProposal;
}

/** The AI's answers with the reactions to them attached. */
export async function withProposalReactions(
  db: Executor,
  proposals: readonly AiProposal[],
): Promise<AiProposal[]> {
  const reactions = await reactionsByProposal(
    db,
    proposals.map((proposal) => proposal.id),
  );
  return proposals.map((proposal) => ({
    ...proposal,
    reactions: reactions.get(proposal.id) ?? [],
  }));
}

/**
 * Sets the viewer's reaction to an answer of the AI (👍 / 👎 / egal) or, with `null`, takes it
 * back – as `setReaction` does for a comment: anyone who may comment may react; the others hear
 * it on the live channel. Answers with the reactions it has now.
 */
export async function setProposalReaction(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  proposalId: string,
  kind: CommentReactionKind | null,
): Promise<CommentReaction[]> {
  await requireDeckAccess(deps, viewer, deckId, 'comment');
  const [proposal] = await deps.db
    .select({ id: aiProposals.id })
    .from(aiProposals)
    .where(and(eq(aiProposals.id, proposalId), eq(aiProposals.deckId, deckId)));
  if (!proposal) throw notFound('Diesen Vorschlag gibt es nicht.');
  const own = and(
    eq(aiProposalReactions.proposalId, proposalId),
    eq(aiProposalReactions.userId, viewer.author.id),
  );
  if (kind === null) {
    await deps.db.delete(aiProposalReactions).where(own);
  } else {
    const now = deps.clock.now();
    await deps.db
      .insert(aiProposalReactions)
      .values({ proposalId, userId: viewer.author.id, author: viewer.author, kind, createdAt: now })
      .onConflictDoUpdate({
        target: [aiProposalReactions.proposalId, aiProposalReactions.userId],
        set: { kind, author: viewer.author, createdAt: now },
      });
  }
  deps.live?.proposalsChanged(deckId);
  return (await reactionsByProposal(deps.db, [proposalId])).get(proposalId) ?? [];
}
