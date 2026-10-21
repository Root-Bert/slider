import type { Workspace } from '@slider/shared';
import { routes } from '@/lib/routes';
import { SettingsLayout } from '@/shell/layouts/SettingsLayout';
import { Notice } from '@/ui';
import { LeaveSection } from './WorkspaceSections';
import { WorkspaceMark } from './WorkspaceMark';

/**
 * Every page of an organisation the instance admin blocked (BER-167): why nothing opens, and the
 * one thing left – leaving it. Its reviews stay where they are; nothing was deleted.
 */
export function BlockedWorkspace({ workspace, userId }: { workspace: Workspace; userId: string }) {
  return (
    <SettingsLayout
      docTitle={`${workspace.name} | Slider`}
      title={workspace.name}
      leading={<WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={40} />}
      back={{ to: routes.reviews(), label: 'Zur Übersicht' }}
    >
      <Notice tone="warning" variant="tinted" icon="lock" title="Diese Organisation ist gesperrt">
        Die Person, die Slider hier betreibt, hat sie gesperrt. Ihre Reviews lassen sich gerade
        nicht öffnen, gelöscht wurde nichts. Wende dich an sie, wenn du glaubst, dass das ein Irrtum
        ist.
      </Notice>
      <LeaveSection workspace={workspace} userId={userId} />
    </SettingsLayout>
  );
}
