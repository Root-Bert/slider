import { DraftList } from '@/features/sender';
import { CloudPage } from './components/CloudPage';
import { useCloud } from './hooks/useCloud';

/** Cloud's „Entwürfe“: what was written and not sent – in a conversation, to an agent, as a mail –, as in Sender. */
export function Component() {
  const ui = useCloud();
  return (
    <CloudPage
      docTitle="Entwürfe"
      title="Entwürfe"
      crumbs={[{ label: ui.workspace.name }, { label: 'Entwürfe' }]}
      nodes={[]}
    >
      {() => <DraftList />}
    </CloudPage>
  );
}
