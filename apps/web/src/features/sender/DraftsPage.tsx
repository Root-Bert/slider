import { DraftList } from './components/DraftList';
import { MenuButton } from './components/MenuButton';
import { PAGE_HEADER, PAGE_TITLE } from './lib/title';

/** Sender's „Entwürfe“: what was written and not sent – in a conversation, to an agent, as a mail. */
export function Component() {
  return (
    <section aria-label="Entwürfe" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className={PAGE_HEADER}>
        <MenuButton />
        <h1 className={PAGE_TITLE}>Entwürfe</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto pt-2 pb-6">
        <DraftList />
      </div>
    </section>
  );
}
