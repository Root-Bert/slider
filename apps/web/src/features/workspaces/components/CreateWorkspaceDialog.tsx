import { useNavigate } from 'react-router';
import { routes } from '@/lib/routes';
import { Button, Dialog } from '@/ui';
import { CreateWorkspaceForm } from './CreateWorkspaceForm';

/** "Organisation erstellen" from the switcher; opens the new organisation afterwards. */
export function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Neue Organisation"
      description="Ein eigener Bereich mit eigenen Reviews und Mitgliedern. Du bist ihr Creator und Admin und kannst weitere Admins ernennen."
    >
      {open && (
        <CreateWorkspaceForm
          autoFocus
          onCreated={(workspace) => {
            onClose();
            void navigate(routes.workspace(workspace.id));
          }}
          secondaryAction={
            <Button variant="ghost" size="lg" onClick={onClose}>
              Abbrechen
            </Button>
          }
        />
      )}
    </Dialog>
  );
}
