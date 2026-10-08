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

/** Bottom-left pill: owners close and share, guests leave the session. */
export function SessionControls({ onLeave }: SessionControlsProps) {
  const { deck, isOwner } = useViewerData();
  const navigate = useNavigate();
  const [sharing, setSharing] = useState(false);

  return (
    <>
      <GlassPanel className="flex items-center gap-1 p-1">
        {isOwner ? (
          <IconButton
            icon="close"
            label="Review schließen"
            className="size-12"
            onClick={() => navigate(routes.reviews())}
          />
        ) : (
          <IconButton
            icon="logout"
            label="Review verlassen"
            className="size-12"
            onClick={onLeave}
          />
        )}
        {isOwner && (
          <IconButton
            icon="iosShare"
            label="Teilen"
            className="size-12"
            onClick={() => setSharing(true)}
          />
        )}
      </GlassPanel>
      {isOwner && sharing && <ShareDialog deck={deck} open onClose={() => setSharing(false)} />}
    </>
  );
}
