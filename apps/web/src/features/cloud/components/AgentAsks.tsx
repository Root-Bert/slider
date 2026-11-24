import { useState } from 'react';
import type { CloudAgentAsk } from '@slider/shared';
import { useDecideCloudAgentAsk } from '@/lib/api/cloud-agents';
import { Button, cn, Icon, type IconName } from '@/ui';

/** The button's icon for what it does. */
const VERB_ICONS: Record<string, IconName> = {
  Löschen: 'delete',
  Senden: 'send',
  Entfernen: 'close',
  Verlassen: 'logout',
  Abbestellen: 'unsubscribe',
  Freigeben: 'link',
  Hinzufügen: 'personAdd',
  Kopieren: 'contentCopy',
};

/**
 * What an agent wants done that cannot be undone or reaches out, under its answer: a question
 * with „Abbrechen“ and the button that does it – only for the person whose rights it runs with;
 * the others see it waiting for them. Decided, one line says what came of it. A refusal goes to
 * `onError` (a toast where the page has one), else it stands under the card (in a call's dock).
 */
export function AgentAsks({
  workspaceId,
  agentId,
  asks,
  onError,
  className,
}: {
  workspaceId: string;
  agentId: string;
  asks: CloudAgentAsk[];
  onError?: (message: string) => void;
  className?: string;
}) {
  const decide = useDecideCloudAgentAsk(workspaceId, agentId);
  const [refused, setRefused] = useState<{ id: string; message: string } | null>(null);
  const choose = (ask: CloudAgentAsk, confirm: boolean) => {
    setRefused(null);
    decide.mutate(
      { ask, confirm },
      {
        onError: (error) =>
          onError ? onError(error.message) : setRefused({ id: ask.id, message: error.message }),
      },
    );
  };
  return (
    <ul className={cn('mt-2 flex flex-col gap-2', className)}>
      {asks.map((ask) => (
        <li
          key={ask.id}
          role="group"
          aria-label={ask.text}
          className="flex flex-col gap-1 rounded-panel bg-surface-2 px-3 py-2"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span
              className={cn(
                'min-w-0 flex-1 text-body',
                ask.state === 'open' ? 'text-fg' : 'text-fg-muted',
              )}
            >
              {ask.text}
            </span>
            {ask.state !== 'open' ? (
              <span
                className={cn(
                  'flex items-center gap-1 text-caption',
                  ask.state === 'failed' ? 'text-danger' : 'text-fg-muted',
                )}
              >
                <Icon
                  name={ask.state === 'done' ? 'check' : ask.state === 'failed' ? 'error' : 'close'}
                  size={16}
                />
                {ask.state === 'done'
                  ? ask.doneWord
                  : ask.state === 'failed'
                    ? 'Ging nicht'
                    : 'Abgebrochen'}
              </span>
            ) : ask.mine ? (
              <span className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => choose(ask, false)}>
                  Abbrechen
                </Button>
                <Button
                  variant={ask.verb === 'Löschen' ? 'danger' : 'primary'}
                  size="sm"
                  icon={VERB_ICONS[ask.verb] ?? 'check'}
                  onClick={() => choose(ask, true)}
                >
                  {ask.verb}
                </Button>
              </span>
            ) : (
              <span className="text-caption text-fg-muted">Wartet auf {ask.by.name}</span>
            )}
          </div>
          {ask.state === 'failed' && ask.result && (
            <p className="text-caption text-danger">{ask.result}</p>
          )}
          {refused?.id === ask.id && (
            <p className="text-caption text-danger">{refused.message}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
