import { useNavigate } from 'react-router';
import { routes } from '@/app/routes';
import { Dialog } from '@/ui';
import { JoinByCodeForm } from './JoinByCodeForm';

/** "Organisation beitreten" from the switcher: paste a link or code → the `/join/:token` page. */
export function JoinWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Organisation beitreten"
      description="Beitreten geht nur mit Einladung. Füge den Link oder Code ein, den du bekommen hast."
    >
      {open && (
        <JoinByCodeForm
          onJoin={(token) => {
            onClose();
            void navigate(routes.join(token));
          }}
        />
      )}
    </Dialog>
  );
}
