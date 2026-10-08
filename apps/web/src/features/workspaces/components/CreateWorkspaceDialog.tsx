import { useNavigate } from 'react-router';
import { routes } from '@/app/routes';
import { Button, Dialog } from '@/ui';
import { CreateWorkspaceForm } from './CreateWorkspaceForm';

/** "Neuer Workspace" from the switcher; opens the new workspace afterwards. */
export function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Neuer Workspace"
      description="Ein eigener Bereich mit eigenen Präsentationen und Mitgliedern."
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
