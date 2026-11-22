import { MailAccounts, NewMailboxButton } from '@/features/sender';
import { routes } from '@/lib/routes';
import { CloudPage } from './components/CloudPage';
import { useCloud } from './hooks/useCloud';

/** Cloud's „Postfächer“: one's mailboxes in this workspace, as in Sender. */
export function Component() {
  const ui = useCloud();
  return (
    <CloudPage
      docTitle="Postfächer"
      title="Postfächer"
      crumbs={[
        { label: ui.workspace.name },
        { label: 'Post', to: routes.cloudMail(ui.workspace.id) },
        { label: 'Postfächer' },
      ]}
      subtitle="Jeder Mail-Server geht: Gmail, Outlook, iCloud oder ein eigener per IMAP und SMTP."
      actions={<NewMailboxButton />}
      nodes={[]}
    >
      {() => <MailAccounts />}
    </CloudPage>
  );
}
