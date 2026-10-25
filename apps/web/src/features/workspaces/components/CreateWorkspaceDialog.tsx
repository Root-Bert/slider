import { useNavigate } from 'react-router';
import { routes } from '@/lib/routes';
import { Button, Dialog } from '@/ui';
import { CreateWorkspaceForm } from './CreateWorkspaceForm';

/** "Workspace erstellen" from the switcher; opens the new workspace afterwards. */
export function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Neuer Workspace"
      description="Ein eigener Bereich mit eigenen Reviews und Mitgliedern. Du bist sein Creator und Admin und kannst weitere Admins ernennen."
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
