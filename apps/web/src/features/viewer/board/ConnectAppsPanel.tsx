import { useEffect, useId, useRef } from 'react';
import { useNavigate } from 'react-router';
import { CopyField, McpSteps } from '@/features/account';
import { useAppConnections } from '@/lib/api';
import { Button, ErrorText, IconButton, LoadingState, useFocusLoop } from '@/ui';
import { SidePanel, SidePanelHeader } from '../components/SidePanel';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { onMaterialPage } from './material-page';

/*
 * „Material“ on the material page: how Claude, ChatGPT, Claude Code … reach this material over
 * MCP – the address and the steps as on `/konto` („KI-Apps“), where the apps let in and the
 * tokens are.
 */

export const ConnectAppsPanel = ({ onClose }: { onClose: () => void }) =>
  onMaterialPage(<ConnectAppsView onClose={onClose} />);

function ConnectAppsView({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const connections = useAppConnections();
  const navigate = useNavigate();
  const data = connections.data;
  useRestoreFocus();
  useFocusLoop(panelRef);
  useEffect(() => panelRef.current?.focus({ preventScroll: true }), []);

  return (
    <SidePanel ref={panelRef} data-board-panel data-connect-apps aria-labelledby={titleId}>
      <SidePanelHeader>
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            Mit KI-Apps verbinden
          </h2>
          <IconButton icon="close" label="Schließen (Esc)" size="sm" onClick={onClose} />
        </div>
      </SidePanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
        <p className="text-body text-fg-muted">
          Claude, ChatGPT und andere KI-Apps lesen dieses Material, recherchieren und legen
          Ergebnisse als Notizen, Links oder Dateien aufs Board – mit deinen Rechten. Sie verbinden
          sich über MCP.
        </p>
        {connections.isPending ? (
          <LoadingState padding="sm" />
        ) : connections.isError ? (
          <ErrorText>{connections.error.message}</ErrorText>
        ) : (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs text-fg-subtle">Adresse für KI-Apps</h3>
            <CopyField label="MCP-Adresse" icon="link" value={data!.mcpUrl} />
            <McpSteps mcpUrl={data!.mcpUrl} oauth={data!.oauth} />
          </div>
        )}
        <div>
          <Button
            size="sm"
            variant="secondary"
            icon="settings"
            onClick={() => void navigate('/konto#ki-apps')}
          >
            Verbundene Apps und Tokens
          </Button>
        </div>
      </div>
    </SidePanel>
  );
}
