import { useEffect, useState } from 'react';
import { AI_RUNNING_LIMIT_MS, type AiProposal } from '@slider/shared';
import { useCancelProposal, useCreateProposal, useMoveProposal } from '@/lib/api';
import { Avatar, cn, Icon, IconButton, Notice, Spinner } from '@/ui';
import { OFFLINE_HINT } from '@/lib/offline';
import { useEditing } from '../editing/editing-context';
import { ProposalPhotos } from '../editing/photos/ProposalPhotos';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';
import { workingLabel } from './lib/ai-ask';
import { ResolveToggle } from './ResolveButton';

/**
 * The AI's answer in a comment thread (BER-183): working, failed, stopped, or what it changed –
 * applied to the slide right away. One icon stops it at work, takes the change back and applies
 * it again, or – failed or stopped – asks the AI again from the same comment; only who manages
 * the deck may, everyone sees it.
 */
export function AiProposalCard({
  proposal,
  className,
  onResolve,
}: {
  proposal: AiProposal;
  className?: string;
  /**
   * Shown where no thread holds it (on a variant): done or open again for everyone, with the
   * thread's own toggle (`ResolveToggle`) – `done` what it is to become.
   */
  onResolve?: (done: boolean) => void;
}) {
  const { deck, canManage, aiAuthor } = useViewerData();
  const toast = useViewerToast();
  const move = useMoveProposal(deck.id);
  const retry = useCreateProposal(deck.id);
  const cancel = useCancelProposal(deck.id);
  const { offline } = useEditing();
  const offlineTitle = (title: string) => (offline ? `${title} – ${OFFLINE_HINT}` : title);
  const reverted = proposal.status === 'reverted';
  const cancelled = proposal.status === 'cancelled';
  /** One of the icons below shows (at the header's end). */
  const acting =
    canManage &&
    (proposal.status === 'running' ||
      proposal.status === 'applied' ||
      reverted ||
      ((proposal.status === 'failed' || cancelled) && !!proposal.commentId));
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
        {/* The AI's avatar, as on the comments it leaves. */}
        <Avatar author={aiAuthor} size={24} nativeTitle={false} />
        <span className="text-xs font-medium text-fg">{aiAuthor.name}</span>
        {reverted && <span className="text-caption text-fg-subtle">zurückgenommen</span>}
        {cancelled && <span className="text-caption text-fg-subtle">abgebrochen</span>}
        {canManage && proposal.status === 'running' && (
          <IconButton
            icon="stop"
            label="Auftrag abbrechen"
            title={offlineTitle('Auftrag abbrechen')}
            variant="subtle"
            size="xs"
            disabled={cancel.isPending || offline}
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
            title={offlineTitle('Änderung zurücknehmen')}
            variant="subtle"
            size="xs"
            disabled={move.isPending || offline}
            onClick={() => run('revert')}
            className="ml-auto"
          />
        )}
        {canManage && (proposal.status === 'failed' || cancelled) && proposal.commentId && (
          <IconButton
            icon="refresh"
            label="Nochmal versuchen"
            title={offlineTitle('Nochmal versuchen')}
            variant="subtle"
            size="xs"
            disabled={retry.isPending || offline}
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
            title={offlineTitle('Wieder anwenden')}
            variant="subtle"
            size="xs"
            disabled={move.isPending || offline}
            onClick={() => run('reapply')}
            className="ml-auto"
          />
        )}
        {onResolve && (
          <ResolveToggle
            done={proposal.resolvedAt !== null}
            onToggle={() => onResolve(proposal.resolvedAt === null)}
            // After the card's own icon, else at the end by itself – as on a thread's card.
            className={cn('-my-1 -mr-1.5', !acting && 'ml-auto')}
          />
        )}
      </header>
      {proposal.status === 'running' && (
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <Spinner size="sm" />
          {proposal.progress?.step ?? workingLabel(proposal.prompt)}
          <Elapsed since={proposal.createdAt} />
        </div>
      )}
      {/* The latest slide it drew, while it still works – applied once it is done. */}
      {proposal.status === 'running' && proposal.progress?.previewUrl && (
        <img
          src={proposal.progress.previewUrl}
          alt="Zwischenstand der KI"
          draggable={false}
          className="w-full rounded-thumb border border-hairline"
        />
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
