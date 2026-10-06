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

/** Bottom-right pill: owners close and share, guests leave the session. */
export function SessionControls({ onLeave }: SessionControlsProps) {
  const { deck, isOwner } = useViewerData();
  const navigate = useNavigate();
  const [sharing, setSharing] = useState(false);

  return (
    <>
      <GlassPanel className="flex items-center gap-2 px-3 py-2">
        {isOwner ? (
          <IconButton
            icon="close"
            label="Review schließen"
            onClick={() => navigate(routes.reviews())}
          />
        ) : (
          <IconButton icon="logout" label="Review verlassen" onClick={onLeave} />
        )}
        {isOwner && <IconButton icon="iosShare" label="Teilen" onClick={() => setSharing(true)} />}
      </GlassPanel>
      {isOwner && sharing && <ShareDialog deck={deck} open onClose={() => setSharing(false)} />}
    </>
  );
}
