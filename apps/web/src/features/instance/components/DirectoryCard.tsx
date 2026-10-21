import { useState } from 'react';
import { Section, SegmentedControl, type ShowToast } from '@/ui';
import { UsersTable } from './UsersTable';
import { WorkspacesTable } from './WorkspacesTable';

type Tab = 'workspaces' | 'users';

const TABS = [
  {
    value: 'workspaces',
    label: 'Organisationen',
    description:
      'Größe und Plan, nie ihre Inhalte. Gesperrt öffnet sie niemand mehr, nur Austreten geht.',
  },
  {
    value: 'users',
    label: 'Personen',
    description:
      'Gesperrt meldet sich ein Konto nirgends mehr an. Seine Daten und Mitgliedschaften bleiben.',
  },
] as const satisfies readonly { value: Tab; label: string; description: string }[];

/** Organisations and accounts of the instance, one table at a time, to find and act on them. */
export function DirectoryCard({
  plans,
  userId,
  onNotify,
}: {
  plans: boolean;
  userId: string;
  onNotify: ShowToast;
}) {
  const [tab, setTab] = useState<Tab>('workspaces');
  return (
    <Section
      title="Verzeichnis"
      description={TABS.find((each) => each.value === tab)?.description}
      density="compact"
      asideOnPhones="below"
      aside={
        <SegmentedControl
          label="Verzeichnis"
          mode="tabs"
          size="sm"
          track="soft"
          segments={TABS}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {tab === 'workspaces' ? (
        <WorkspacesTable plans={plans} onNotify={onNotify} />
      ) : (
        <UsersTable userId={userId} onNotify={onNotify} />
      )}
    </Section>
  );
}
