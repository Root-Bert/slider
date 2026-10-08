import { useState } from 'react';
import { useNavigate } from 'react-router';
import { routes } from '@/app/routes';
import { ShareDialog } from '@/features/sharing/ShareDialog';
import { GlassPanel, IconButton } from '@/ui';
import { useViewerData } from '../state/viewer-data';

interface SessionControlsProps {
  /** Guests only: end the review session. */
  onLeave: () => void;
}

/** Pill right of the slide counter: members close (managers also share), guests leave the session. */
export function SessionControls({ onLeave }: SessionControlsProps) {
  const { deck, isGuest, canManage } = useViewerData();
  const navigate = useNavigate();
  const [sharing, setSharing] = useState(false);

  return (
    <>
      <GlassPanel className="flex items-center gap-1 p-1">
        {isGuest ? (
          <IconButton icon="logout" label="Review verlassen" size="sm" onClick={onLeave} />
        ) : (
          <IconButton
            icon="close"
            label="Review schließen"
            size="sm"
            onClick={() => navigate(routes.workspace(deck.workspaceId))}
          />
        )}
        {canManage && (
          <IconButton icon="iosShare" label="Teilen" size="sm" onClick={() => setSharing(true)} />
        )}
      </GlassPanel>
      {canManage && sharing && <ShareDialog deck={deck} open onClose={() => setSharing(false)} />}
    </>
  );
}
