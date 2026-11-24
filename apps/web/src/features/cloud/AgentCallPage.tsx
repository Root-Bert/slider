import { useParams } from 'react-router';
import { useCallRecord, useCloudAgent } from '@/lib/api';
import { routes } from '@/lib/routes';
import { Icon, useMediaQuery } from '@/ui';
import { CallMeta, CallRecordView } from './components/CallRecord';
import { callWhen } from './lib/calls';
import { CloudPage } from './components/CloudPage';
import { LoadFailed } from './components/Empty';
import { agentArea, agentHome } from './lib/areas';
import { useCloud } from './hooks/useCloud';
import { useOpenedFrom } from './hooks/useOpenedFrom';

/** A call with an agent, over: what was said like a chat, and the notes after it beside. */
export function Component() {
  const { agentId = '', callId = '' } = useParams();
  const ui = useCloud();
  const record = useCallRecord(callId);
  const agent = useCloudAgent(ui.workspace.id, agentId).data;
  const stacked = useMediaQuery('(max-width: 1023px)');
  const area = agentArea(ui.home?.areas ?? [], agent);
  // From „Agenten“ the path stays there; from its area (or a link) it goes through the area.
  const from = useOpenedFrom([routes.cloudAgents(ui.workspace.id)], (path) =>
    path.startsWith(routes.cloudAgent(ui.workspace.id, agentId)),
  );
  const where = agentHome(ui.workspace.id, ui.home?.areas ?? [], area, from);
  const call = record.data;
  return (
    <CloudPage
      docTitle={call ? `Anruf vom ${callWhen(call.startedAt)}` : 'Anruf'}
      title={record.isPending ? ' ' : 'Anruf'}
      lead={<Icon name="call" size={28} className="shrink-0 text-fg-muted" />}
      crumbs={[
        ...where.crumbs,
        { label: agent?.title ?? 'Agent', to: routes.cloudAgent(ui.workspace.id, agentId) },
        { label: 'Anruf' },
      ]}
      barRow={where.barRow}
      subtitle={call ? <CallMeta record={call} /> : null}
      nodes={[]}
      fill={!stacked}
    >
      {() =>
        record.isPending ? (
          <div aria-hidden className="skeleton min-h-0 flex-1 rounded-panel" />
        ) : !call ? (
          <LoadFailed
            message={record.error?.message ?? 'Diesen Anruf gibt es nicht.'}
            onRetry={() => void record.refetch()}
          />
        ) : (
          <CallRecordView
            record={call}
            workspaceId={ui.workspace.id}
            agentId={agentId}
            agentHref={(id) => routes.cloudAgent(ui.workspace.id, id)}
            fill={!stacked}
          />
        )
      }
    </CloudPage>
  );
}
