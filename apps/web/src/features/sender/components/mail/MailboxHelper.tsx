import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { mailKeys, useCloudAgent, useOrderCloudAgent } from '@/lib/api';
import { AgentAvatar, AgentChat, AgentComposer, LoadFailed } from '@/features/cloud';
import { ButtonLink, Icon, IconButton } from '@/ui';
import { useSender } from '../../hooks/useSender';

/** The order the helping agent starts with – the person's words, in the chat as theirs. */
const helpOrder = (said: string) =>
  `Hilf mir, unter „Postfächer“ ein Postfach hinzuzufügen: ${said}`;

/**
 * The agent beside „Neues Postfach“ (as „Verbindungen“' helper under its field): a line to say
 * where the mailbox lies, then its chat right here – it looks up the servers and puts them into
 * the form (`prepare_mailbox`, read back as `useMailPrepared`); the password the person types
 * there (no tool takes one). Stays open on reload and back (`?agent=`).
 */
export function MailboxHelper() {
  const ui = useSender();
  const order = useOrderCloudAgent(ui.workspace.id);
  const [params, setParams] = useSearchParams();
  const agentId = params.get('agent');
  if (!agentId) {
    return (
      <section
        aria-label="Agent hilft beim Einrichten"
        className="flex flex-col gap-3 rounded-panel bg-surface-1 p-4"
      >
        <div className="flex items-start gap-3">
          <Icon name="autoAwesome" size={20} className="mt-0.5 shrink-0 text-fg-muted" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-sm font-medium text-fg">Mit einem Agenten einrichten</h2>
            <p className="text-xs text-fg-muted">
              Sag, wo dein Postfach liegt – er sucht die Server heraus und trägt sie ins Formular
              ein. Dein Passwort trägst du selbst ins Formular ein.
            </p>
          </div>
        </div>
        <AgentComposer
          top
          placeholder="Wo liegt dein Postfach? Etwa: bei Strato, info@firma.de"
          busy={order.isPending}
          onSend={(text) => {
            return order.mutateAsync(helpOrder(text)).then(
              (agent) => {
                setParams(
                  (now) => {
                    now.set('agent', agent.id);
                    return now;
                  },
                  { replace: true },
                );
                return true;
              },
              (error: Error) => {
                ui.notify(error.message, 'danger');
                return false;
              },
            );
          }}
        />
      </section>
    );
  }
  return (
    <Helper
      key={agentId}
      agentId={agentId}
      onClose={() =>
        setParams(
          (now) => {
            now.delete('agent');
            return now;
          },
          { replace: true },
        )
      }
    />
  );
}

function Helper({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const ui = useSender();
  const queryClient = useQueryClient();
  const found = useCloudAgent(ui.workspace.id, agentId);
  const agent = found.data;
  // What it got ready stands in the form as soon as it has answered.
  const updated = agent?.updatedAt;
  const running = agent?.running;
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: mailKeys.prepared(ui.workspace.id) });
  }, [queryClient, ui.workspace.id, updated, running]);
  return (
    <section
      aria-label="Agent hilft beim Einrichten"
      className="flex flex-col gap-3 rounded-panel bg-surface-1 p-4"
    >
      <div className="flex items-center gap-3">
        {agent ? (
          <AgentAvatar id={agent.id} size={28} className="rounded-mark" />
        ) : (
          <Icon name="autoAwesome" size={20} className="text-fg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">
            {agent?.title ?? 'Agent hilft beim Einrichten'}
          </p>
          <p className="truncate text-xs text-fg-muted">Passwort nur ins Formular</p>
        </div>
        <ButtonLink to={ui.agentPath(agentId)} variant="ghost" size="sm" className="max-sm:hidden">
          Als Agent öffnen
        </ButtonLink>
        <IconButton icon="close" label="Schließen" size="sm" onClick={onClose} />
      </div>
      <div className="flex h-[440px] min-h-0 flex-col">
        {found.isPending ? (
          <div aria-hidden className="skeleton min-h-0 flex-1 rounded-panel" />
        ) : !agent ? (
          <LoadFailed
            message={found.error?.message ?? 'Diesen Agenten gibt es nicht.'}
            onRetry={() => void found.refetch()}
          />
        ) : (
          <AgentChat agent={agent} chat={agent.chats[0] ?? null} onOpened={() => {}} />
        )}
      </div>
    </section>
  );
}
