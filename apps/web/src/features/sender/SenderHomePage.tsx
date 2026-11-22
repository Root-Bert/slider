import { useSenderSummary } from '@/lib/api';
import { EmptyState, RowList, Spinner } from '@/ui';
import { MenuButton } from './components/MenuButton';
import { Failed, SummaryBody, UnreadRow, UnreadSkeleton } from './components/SenderStart';
import { useSender } from './hooks/useSender';
import { useUnreadNow } from './hooks/useUnreadNow';
import { PAGE_HEADER, PAGE_TITLE } from './lib/title';

/**
 * Sender's start („Aktuell“, `nachrichten` itself): what is unread, conversation by
 * conversation, and beside it what the workspace's AI makes of it – „since the last visit“ being
 * where one stopped reading in each. Both are asked anew when the side bar's counts change.
 */
export function Component() {
  const ui = useSender();
  // What the side bar knows changes when something comes in or is read: then both are asked anew.
  const { stamp, unread } = useUnreadNow();
  const summary = useSenderSummary(ui.workspace.id, stamp);

  return (
    <section aria-label="Aktuell" className="flex min-h-0 flex-1 flex-col gap-3">
      <header className={PAGE_HEADER}>
        <MenuButton />
        <h1 className={PAGE_TITLE}>Aktuell</h1>
      </header>
      {ui.homeFailed ? (
        <div className="m-auto">
          <EmptyState
            title="Nachrichten nicht geladen"
            message="Prüfe die Verbindung und lade die Seite neu."
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          {/* Side by side the summary stands right; stacked, it comes first. */}
          <div className="grid grid-cols-1 items-start gap-x-6 gap-y-8 pt-2 xl:grid-cols-[minmax(0,1fr)_368px]">
            <section aria-labelledby="sender-unread" className="flex min-w-0 flex-col gap-2">
              <h2 id="sender-unread" className="text-base font-semibold text-fg">
                Ungelesen
              </h2>
              {unread.isPending ? (
                <UnreadSkeleton />
              ) : unread.isError && !unread.data ? (
                <Failed message={unread.error.message} onRetry={() => void unread.refetch()} />
              ) : unread.data.items.length === 0 ? (
                <p className="py-2 text-body text-fg-muted">
                  Alles gelesen. Was neu dazukommt, steht hier.
                </p>
              ) : (
                <RowList variant="hover" aria-label="Ungelesen">
                  {unread.data.items.map((item) => (
                    <UnreadRow key={`${item.kind}:${item.id}`} item={item} />
                  ))}
                </RowList>
              )}
            </section>
            <aside
              aria-labelledby="sender-summary"
              className="glass flex flex-col gap-2 rounded-panel p-4 max-xl:order-first"
            >
              <div className="flex items-center gap-2 pb-1">
                <h2 id="sender-summary" className="min-w-0 flex-1 text-base font-semibold text-fg">
                  Seit deinem letzten Besuch
                </h2>
                {summary.isFetching && <Spinner size={16} label="Die KI fasst zusammen" />}
              </div>
              <SummaryBody
                summary={summary.data}
                pending={summary.isPending}
                error={summary.isError && !summary.data ? summary.error.message : null}
                onRetry={() => void summary.refetch()}
              />
            </aside>
          </div>
        </div>
      )}
    </section>
  );
}
