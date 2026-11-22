import { CloudProvider } from '@/features/cloud';
import { ButtonLink, cn } from '@/ui';
import { NewMailbox } from './components/mail/MailAccounts';
import { MenuButton } from './components/MenuButton';
import { useSender } from './hooks/useSender';
import { PAGE_HEADER, PAGE_TITLE } from './lib/title';

/** Sender's „Neues Postfach“: the form alone, its agent beside it – back to „Postfächer“. */
export function Component() {
  const ui = useSender();
  return (
    <section aria-label="Neues Postfach" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className={PAGE_HEADER}>
        <MenuButton />
        <ButtonLink
          to={ui.mailAccountsPath}
          variant="ghost"
          size="sm"
          icon="arrowBack"
          title="Zurück zu den Postfächern"
          className="shrink-0"
        >
          <span className="sr-only">Zurück zu den Postfächern</span>
        </ButtonLink>
        <h1 className={cn(PAGE_TITLE, 'flex-1')}>Neues Postfach</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pt-2 pb-6">
        {/* The agent's chat beside the form is Cloud's – there it is around already. */}
        <CloudProvider workspace={ui.workspace}>
          <NewMailbox />
        </CloudProvider>
      </div>
    </section>
  );
}
