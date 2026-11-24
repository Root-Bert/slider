import { useNavigate } from 'react-router';
import { appHome, usePageApp } from '@/lib/apps';
import { Button, Dialog } from '@/ui';
import { CreateWorkspaceForm } from './CreateWorkspaceForm';

/**
 * "Workspace erstellen" from the switcher; opens the new workspace afterwards – in the app one is
 * in, as the switcher does (from a page between the apps in Cloud).
 */
export function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const app = usePageApp() ?? 'cloud';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Neuer Workspace"
      description="Ein eigener Bereich mit eigenen Präsentationen und Mitgliedern. Du bist sein Creator und Admin und kannst weitere Admins ernennen."
    >
      {open && (
        <CreateWorkspaceForm
          autoFocus
          onCreated={(workspace) => {
            onClose();
            void navigate(appHome(app, workspace.id).to);
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
