import { useEffect, useEffectEvent } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { useCallRecord } from '@/lib/api';
import { isTextTarget } from '@/lib/dom';
import {
  CLOUD_CALL_PARAM,
  CLOUD_EVENT_PARAM,
  CLOUD_FILE_PARAM,
  CLOUD_TODO_PARAM,
  routes,
} from '@/lib/routes';
import { EmptyState, Icon, IconButton, SidePanel } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { CallMeta, CallRecordStack } from './CallRecord';

/** `?anruf=` beside the page – one panel at a time: a file's, a to-do's or an event's makes way. */
function withCall(search: string, callId: string | null): string {
  const after = new URLSearchParams(search);
  if (callId) after.set(CLOUD_CALL_PARAM, callId);
  else after.delete(CLOUD_CALL_PARAM);
  after.delete(CLOUD_FILE_PARAM);
  after.delete(CLOUD_TODO_PARAM);
  after.delete(CLOUD_EVENT_PARAM);
  return after.size ? `?${after}` : '';
}

/**
 * The call over beside the page: `href` for a call's entry in a chat (the open one's closes it
 * again, as an event's), `close` for Esc and ✕.
 */
export function useShownCall() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const id = params.get(CLOUD_CALL_PARAM);
  return {
    id,
    href: (callId: string) =>
      `${location.pathname}${withCall(location.search, id === callId ? null : callId)}`,
    close: () =>
      setParams((current) => new URLSearchParams(withCall(`?${current}`, null)), {
        replace: true,
      }),
  };
}

/**
 * A call that is over, in the side panel beside the page – as an event or a to-do: when, how
 * long, who in its head; the notes the AI wrote, then what was said. The chat it stands in moves
 * aside for it and stays. Esc or ✕ closes it.
 */
export function CallPanel() {
  const ui = useCloud();
  const shown = useShownCall();
  const record = useCallRecord(shown.id ?? '', shown.id !== null);
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!shown.id || event.key !== 'Escape' || event.defaultPrevented) return;
    if (isTextTarget(event.target) || document.querySelector('dialog[open], [role="menu"]')) return;
    event.preventDefault();
    shown.close();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  if (!shown.id) return null;
  const call = record.data;
  return (
    <SidePanel aria-label="Anruf" data-cloud-panel>
      <header className="flex shrink-0 flex-col gap-1.5 border-b border-hairline py-2.5 pr-2.5 pl-5">
        <div className="flex items-center gap-2">
          <Icon name="call" size={18} className="shrink-0 text-fg-muted" />
          <h2 className="min-w-0 flex-1 truncate text-body font-semibold text-fg">Anruf</h2>
          <IconButton icon="close" label="Anruf schließen (Esc)" size="sm" onClick={shown.close} />
        </div>
        {call && <CallMeta record={call} />}
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-5">
        {record.isPending ? (
          <div aria-hidden className="skeleton h-40 rounded-panel" />
        ) : !call ? (
          <div className="m-auto">
            <EmptyState
              title="Anruf nicht gefunden"
              message={record.error?.message ?? 'Diesen Anruf gibt es nicht.'}
            />
          </div>
        ) : (
          <CallRecordStack
            record={call}
            workspaceId={ui.workspace.id}
            agentHref={(agentId) => routes.cloudAgent(ui.workspace.id, agentId)}
          />
        )}
      </div>
    </SidePanel>
  );
}
