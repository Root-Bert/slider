import { useParams } from 'react-router';
import { useCallRecord } from '@/lib/api';
import { routes } from '@/lib/routes';
import { CallMeta, CallRecordView } from '@/features/cloud';
import { ButtonLink, cn, EmptyState, useMediaQuery } from '@/ui';
import { MenuButton } from './components/MenuButton';
import { useSender } from './hooks/useSender';
import { PAGE_HEADER, PAGE_TITLE } from './lib/title';

/**
 * A call that is over – one's own with an agent (`agentId`) or a conversation's (`channelId`), as
 * in Cloud: what was said like a chat, the notes beside; back to where it stands as an entry.
 */
export function Component() {
  const { agentId, channelId, callId = '' } = useParams();
  const ui = useSender();
  const workspaceId = ui.workspace.id;
  const record = useCallRecord(callId);
  const wide = useMediaQuery('(min-width: 1024px)');
  const call = record.data;
  const back = agentId
    ? routes.messagesAgent(workspaceId, agentId)
    : routes.messagesChannel(workspaceId, channelId ?? '');
  const backLabel = agentId ? 'Zurück zum Chat' : 'Zurück zur Unterhaltung';
  return (
    <section aria-label="Anruf" className="flex min-h-0 flex-1 flex-col gap-4">
      <header className={PAGE_HEADER}>
        <MenuButton />
        <ButtonLink
          to={back}
          variant="ghost"
          size="sm"
          icon="arrowBack"
          title={backLabel}
          className="shrink-0"
        >
          <span className="sr-only">{backLabel}</span>
        </ButtonLink>
        <h1 className={cn(PAGE_TITLE, 'flex-1')}>Anruf</h1>
      </header>
      {call && <CallMeta record={call} />}
      {record.isPending ? (
        <div aria-hidden className="skeleton min-h-0 flex-1 rounded-panel" />
      ) : !call ? (
        <div className="m-auto">
          <EmptyState
            title="Anruf nicht gefunden"
            message={record.error?.message ?? 'Diesen Anruf gibt es nicht.'}
          />
        </div>
      ) : (
        <div className={cn('flex flex-1 flex-col', wide ? 'min-h-0' : 'overflow-y-auto')}>
          <CallRecordView
            record={call}
            workspaceId={workspaceId}
            agentId={agentId ?? null}
            agentHref={(id) => routes.messagesAgent(workspaceId, id)}
            fill={wide}
          />
        </div>
      )}
    </section>
  );
}
