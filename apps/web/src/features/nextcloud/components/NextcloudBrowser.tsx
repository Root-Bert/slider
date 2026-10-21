import { useEffect, useState } from 'react';
import type { Deck, NextcloudConnection, NextcloudEntry } from '@slider/shared';
import { ApiError } from '@/lib/api-client';
import {
  nextcloudPreviewUrl,
  useImportNextcloudItem,
  useNextcloudConnections,
  useNextcloudListing,
  type NextcloudView,
} from '@/lib/api';
import { formatFileSize, formatRelativeTime } from '@/lib/format';
import {
  cn,
  Icon,
  IconTile,
  PowerPointMark,
  SegmentedControl,
  Select,
  Spinner,
  TextField,
} from '@/ui';
import { nextcloudHost } from '../lib/host';
import { NextcloudConnectForm } from './NextcloudConnectForm';

/** Waits this long after the last key before searching Nextcloud. */
const SEARCH_DEBOUNCE_MS = 300;

type Tab = 'files' | 'shared';
type Sort = 'name' | 'name-desc' | 'modified';

const SORTS: { value: Sort; label: string }[] = [
  { value: 'name', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  { value: 'modified', label: 'Zuletzt geändert' },
];

/** Like Nextcloud's own list: `2_…` before `10_…`, case does not matter. */
const byName = new Intl.Collator('de', { numeric: true, sensitivity: 'base' }).compare;

/** Folders stay on top whichever way the list is sorted. */
function sortEntries(entries: NextcloudEntry[], sort: Sort): NextcloudEntry[] {
  return [...entries].sort(
    (a, b) =>
      Number(b.folder) - Number(a.folder) ||
      (sort === 'modified' ? (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? '') : 0) ||
      (sort === 'name-desc' ? byName(b.name, a.name) : byName(a.name, b.name)),
  );
}

const connectionLabel = (connection: NextcloudConnection) =>
  `${connection.account} | ${nextcloudHost(connection.server)}`;

/**
 * Picks a presentation from a connected Nextcloud (BER-135) – the body of the panel the
 * "Aus Nextcloud wählen" button opens into. Nextcloud has no picker to embed, so this lists its
 * folders, "Mit mir geteilt" and search results through the API; only folders and `.pptx` files
 * show. Without an account it connects one first.
 */
export function NextcloudBrowser({
  workspaceId,
  onImported,
  className,
}: {
  workspaceId: string;
  onImported: (deck: Deck) => void;
  className?: string;
}) {
  const connections = useNextcloudConnections();
  const usable = (connections.data ?? []).filter((c) => !c.needsReconnect);
  const [chosen, setChosen] = useState<string | null>(null);
  const connection = usable.find((c) => c.id === chosen) ?? usable[0] ?? null;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-3 px-5 pt-4', className)}>
      {connections.isPending ? (
        <Spinner size={20} className="text-fg-subtle" />
      ) : !connection ? (
        <NextcloudConnectForm
          initialServer={connections.data?.[0]?.server ?? ''}
          onConnected={(added) => setChosen(added.id)}
          className="w-full max-w-[420px]"
        />
      ) : (
        <>
          {usable.length > 1 && (
            <Select
              aria-label="Nextcloud-Konto"
              value={connection.id}
              onChange={setChosen}
              options={usable.map((c) => ({ value: c.id, label: connectionLabel(c) }))}
              className="max-w-[420px]"
            />
          )}
          <FileList
            key={connection.id}
            connection={connection}
            workspaceId={workspaceId}
            onImported={onImported}
          />
        </>
      )}
    </div>
  );
}

function FileList({
  connection,
  workspaceId,
  onImported,
}: {
  connection: NextcloudConnection;
  workspaceId: string;
  onImported: (deck: Deck) => void;
}) {
  const [tab, setTab] = useState<Tab>('files');
  const [path, setPath] = useState('/');
  const [sort, setSort] = useState<Sort>('name');
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);

  const view: NextcloudView =
    query.length >= 2
      ? { kind: 'search', query }
      : tab === 'shared'
        ? { kind: 'shared' }
        : { kind: 'files', path };
  const listing = useNextcloudListing(connection.id, view);
  const importItem = useImportNextcloudItem(workspaceId);
  const [picked, setPicked] = useState<string | null>(null);

  const open = (entry: NextcloudEntry) => {
    if (entry.folder) {
      setTyped('');
      setQuery('');
      setTab('files');
      setPath(entry.path);
      return;
    }
    setPicked(entry.fileId);
    importItem.mutate(
      { connectionId: connection.id, fileId: entry.fileId },
      { onSuccess: onImported, onSettled: () => setPicked(null) },
    );
  };

  const loginLost =
    listing.error instanceof ApiError && listing.error.code === 'nextcloud_login_required';
  if (loginLost) {
    return (
      <div className="flex max-w-[420px] flex-col gap-3">
        <p className="text-body text-fg-muted">
          Nextcloud hat die Verbindung zu {nextcloudHost(connection.server)} beendet. Verbinde das
          Konto erneut.
        </p>
        <NextcloudConnectForm
          initialServer={connection.server}
          label="Erneut verbinden"
          onConnected={() => void listing.refetch()}
        />
      </div>
    );
  }

  const entries = sortEntries(listing.data?.entries ?? [], sort);
  const searching = view.kind === 'search';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Ansicht"
          size="sm"
          segments={[
            { value: 'files', label: 'Dateien', icon: 'folder' },
            { value: 'shared', label: 'Mit mir geteilt', icon: 'personAdd' },
          ]}
          value={tab}
          onChange={(next) => {
            setTyped('');
            setQuery('');
            setTab(next);
          }}
        />
        <TextField
          aria-label="Präsentationen suchen"
          placeholder="Suchen"
          icon="search"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className="min-w-[160px] flex-1"
        />
        <Select
          aria-label="Sortieren"
          value={sort}
          onChange={setSort}
          options={SORTS}
          className="w-[164px]"
        />
      </div>

      {view.kind === 'files' && <Breadcrumbs path={path} onOpen={setPath} />}

      {/* The list scrolls inside the panel; the controls above stay put. */}
      <div className="-mx-5 min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {listing.isPending && listing.fetchStatus !== 'idle' ? (
          <Spinner size={20} className="text-fg-subtle" />
        ) : listing.isError ? (
          <p className="text-sm text-danger">{listing.error.message}</p>
        ) : entries.length === 0 ? (
          <p className="text-body text-fg-subtle">
            {searching
              ? 'Keine Präsentation gefunden.'
              : view.kind === 'shared'
                ? 'Niemand hat Präsentationen oder Ordner mit dir geteilt.'
                : 'Keine Präsentationen in diesem Ordner.'}
          </p>
        ) : (
          <ul className={cn('-mx-2 flex flex-col', listing.isPlaceholderData && 'opacity-60')}>
            {entries.map((entry) => (
              <li key={entry.fileId}>
                <EntryButton
                  entry={entry}
                  connectionId={connection.id}
                  showPath={view.kind !== 'files'}
                  pending={picked === entry.fileId}
                  disabled={importItem.isPending}
                  onClick={() => open(entry)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      {importItem.error && <p className="pb-4 text-sm text-danger">{importItem.error.message}</p>}
    </div>
  );
}

function Breadcrumbs({ path, onOpen }: { path: string; onOpen: (path: string) => void }) {
  const segments = path.split('/').filter(Boolean);
  const crumb = (label: string, target: string, current: boolean) => (
    <button
      type="button"
      onClick={() => onOpen(target)}
      disabled={current}
      aria-current={current ? 'location' : undefined}
      className={cn(
        'truncate rounded-control-sm px-1 py-0.5',
        current ? 'font-medium text-fg' : 'text-fg-muted hover:bg-surface-1 hover:text-fg',
      )}
    >
      {label}
    </button>
  );
  return (
    <nav aria-label="Ordner" className="flex min-w-0 flex-wrap items-center gap-0.5 text-body">
      {crumb('Dateien', '/', segments.length === 0)}
      {segments.map((segment, index) => (
        <span key={index} className="flex min-w-0 items-center gap-0.5">
          <Icon name="chevronRight" size={16} className="text-fg-subtle" />
          {crumb(
            segment,
            `/${segments.slice(0, index + 1).join('/')}`,
            index === segments.length - 1,
          )}
        </span>
      ))}
    </nav>
  );
}

function EntryButton({
  entry,
  connectionId,
  showPath,
  pending,
  disabled,
  onClick,
}: {
  entry: NextcloudEntry;
  connectionId: string;
  showPath: boolean;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const details = [
    showPath ? entry.path.split('/').slice(0, -1).join('/') || '/' : null,
    entry.modifiedAt ? formatRelativeTime(entry.modifiedAt) : null,
    !entry.folder && entry.sizeBytes !== null ? formatFileSize(entry.sizeBytes) : null,
  ].filter(Boolean);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded-control-sm p-2 text-left hover:bg-surface-1 disabled:opacity-60"
    >
      {entry.folder ? (
        <IconTile>
          <Icon name="folder" size={20} />
        </IconTile>
      ) : entry.preview && !previewFailed ? (
        <img
          src={nextcloudPreviewUrl(connectionId, entry.fileId)}
          alt=""
          loading="lazy"
          onError={() => setPreviewFailed(true)}
          className="size-9 shrink-0 rounded-control-sm bg-surface-1 object-cover"
        />
      ) : (
        <IconTile tone="inherit">
          <PowerPointMark size={20} />
        </IconTile>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{entry.name}</span>
        {details.length > 0 && (
          <span className="truncate text-xs text-fg-subtle">{details.join(' | ')}</span>
        )}
      </span>
      {pending ? (
        <Spinner size={16} className="text-fg-subtle" />
      ) : (
        entry.folder && <Icon name="chevronRight" size={18} className="text-fg-subtle" />
      )}
    </button>
  );
}
