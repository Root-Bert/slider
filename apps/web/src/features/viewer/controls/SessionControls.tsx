import { useState } from 'react';
import { useNavigate } from 'react-router';
import { routes } from '@/app/routes';
import { ShareDialog } from '@/features/sharing/ShareDialog';
import { GlassPanel, IconButton } from '@/ui';
import { useViewerData } from '../state/viewer-data';

/** Pill right of the slide counter: managers share the deck, close sits rightmost. */
export function SessionControls() {
  const { deck, canManage } = useViewerData();
  const navigate = useNavigate();
  const [sharing, setSharing] = useState(false);

  return (
    <>
      <GlassPanel className="flex items-center gap-1 p-1">
        {canManage && (
          <IconButton icon="iosShare" label="Teilen" size="sm" onClick={() => setSharing(true)} />
        )}
        <IconButton
          icon="close"
          label="Review schließen"
          size="sm"
          onClick={() => navigate(routes.workspace(deck.workspaceId))}
        />
      </GlassPanel>
      {canManage && sharing && <ShareDialog deck={deck} open onClose={() => setSharing(false)} />}
    </>
  );
}
