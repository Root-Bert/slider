import type { CommentReactionKind } from '@slider/shared';

export const REACTION_LABELS: Record<CommentReactionKind, string> = {
  up: 'Daumen hoch',
  down: 'Daumen runter',
  neutral: 'Egal',
};

/** Agreeing is green, disagreeing red; abstaining („egal“) takes no side, nor a colour. */
export const REACTION_COLORS: Record<CommentReactionKind, string> = {
  up: 'var(--color-success)',
  down: 'var(--color-danger)',
  neutral: 'var(--color-fg)',
};
