import { useEffect, useState } from 'react';
import { AI_RUNNING_LIMIT_MS, type AiProposal } from '@slider/shared';
import { useCancelProposal, useCreateProposal, useMoveProposal } from '@/lib/api';
import { cn, Icon, IconButton, Notice, Spinner } from '@/ui';
import { ProposalPhotos } from '../editing/photos/ProposalPhotos';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';
import { workingLabel } from './lib/ai-ask';

/**
 * The AI's answer in a comment thread (BER-183): working, failed, stopped, or what it changed –
 * applied to the slide right away. One icon stops it at work, takes the change back and applies
 * it again, or – failed or stopped – asks the AI again from the same comment; only who manages
 * the deck may, everyone sees it.
 */
export function AiProposalCard({
  proposal,
  className,
}: {
  proposal: AiProposal;
  className?: string;
}) {
  const { deck, canManage } = useViewerData();
  const toast = useViewerToast();
  const move = useMoveProposal(deck.id);
  const retry = useCreateProposal(deck.id);
  const cancel = useCancelProposal(deck.id);
  const reverted = proposal.status === 'reverted';
  const cancelled = proposal.status === 'cancelled';
  const run = (action: 'revert' | 'reapply') =>
    move.mutate(
      { proposalId: proposal.id, action },
      { onError: (error) => toast(error.message, 'danger') },
    );

  if (proposal.status === 'discarded') {
    return (
      <p className={cn('flex items-center gap-1.5 text-caption text-fg-subtle', className)}>
        <Icon name="autoAwesome" size={14} />
        KI-Vorschlag verworfen
      </p>
    );
  }

  return (
    <article
      data-ai-proposal={proposal.status}
      aria-busy={
        proposal.status === 'running' ||
        move.isPending ||
        retry.isPending ||
        cancel.isPending ||
        undefined
      }
      className={cn('glass flex flex-col gap-2 rounded-panel px-3.5 py-3', className)}
    >
      <header className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-surface-3 text-fg">
          <Icon name="autoAwesome" size={14} />
        </span>
        <span className="text-xs font-medium text-fg">KI</span>
        {reverted && <span className="text-caption text-fg-subtle">zurückgenommen</span>}
        {cancelled && <span className="text-caption text-fg-subtle">abgebrochen</span>}
        {canManage && proposal.status === 'running' && (
          <IconButton
            icon="stop"
            label="Auftrag abbrechen"
            title="Auftrag abbrechen"
            variant="subtle"
            size="xs"
            disabled={cancel.isPending}
            onClick={() =>
              cancel.mutate(proposal.id, {
                onError: (error) => toast(error.message, 'danger'),
              })
            }
            className="ml-auto"
          />
        )}
        {canManage && proposal.status === 'applied' && (
          <IconButton
            icon="undo"
            label="Änderung zurücknehmen"
            title="Änderung zurücknehmen"
            variant="subtle"
            size="xs"
            disabled={move.isPending}
            onClick={() => run('revert')}
            className="ml-auto"
          />
        )}
        {canManage && (proposal.status === 'failed' || cancelled) && proposal.commentId && (
          <IconButton
            icon="refresh"
            label="Nochmal versuchen"
            title="Nochmal versuchen"
            variant="subtle"
            size="xs"
            disabled={retry.isPending}
            onClick={() =>
              retry.mutate(
                { commentId: proposal.commentId! },
                { onError: (error) => toast(error.message, 'danger') },
              )
            }
            className="ml-auto"
          />
        )}
        {canManage && reverted && (
          <IconButton
            icon="redo"
            label="Wieder anwenden"
            title="Wieder anwenden"
            variant="subtle"
            size="xs"
            disabled={move.isPending}
            onClick={() => run('reapply')}
            className="ml-auto"
          />
        )}
      </header>
      {proposal.status === 'running' && (
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner size="sm" />
          {workingLabel(proposal.prompt)}
          <Elapsed since={proposal.createdAt} />
        </div>
      )}
      {proposal.status === 'failed' && (
        <Notice tone="danger" variant="plain" size="sm">
          {proposal.error ?? 'Das ging schief.'}
        </Notice>
      )}
      {proposal.summary && proposal.status !== 'failed' && (
        <p className={cn('text-body leading-5', reverted ? 'text-fg-subtle' : 'text-fg')}>
          {proposal.summary}
        </p>
      )}
      {proposal.photos && proposal.status === 'applied' && (
        <ProposalPhotos proposal={proposal} photos={proposal.photos} />
      )}
    </article>
  );
}

const clock = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** How long the AI has been at it, of the time it has – then it stops. */
function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  // The server's clock started it: never below 0, never past the limit.
  const elapsed = Math.min(Math.max(0, now - Date.parse(since)), AI_RUNNING_LIMIT_MS);
  return (
    <span
      className="ml-auto text-caption tabular-nums text-fg-subtle"
      title="Nach 10 Minuten wird der Auftrag gestoppt und seine Änderung zurückgenommen."
    >
      {clock(elapsed)} / {clock(AI_RUNNING_LIMIT_MS)}
    </span>
  );
}
