import { NewMailbox } from '@/features/sender';
import { routes } from '@/lib/routes';
import { CloudPage } from './components/CloudPage';
import { useCloud } from './hooks/useCloud';

/** Cloud's „Neues Postfach“: the form alone, its agent beside it, as in Sender. */
export function Component() {
  const ui = useCloud();
  return (
    <CloudPage
      docTitle="Neues Postfach"
      title="Neues Postfach"
      crumbs={[
        { label: ui.workspace.name },
        { label: 'Post', to: routes.cloudMail(ui.workspace.id) },
        { label: 'Postfächer', to: routes.cloudMailAccounts(ui.workspace.id) },
        { label: 'Neues Postfach' },
      ]}
      nodes={[]}
    >
      {() => <NewMailbox />}
    </CloudPage>
  );
}
