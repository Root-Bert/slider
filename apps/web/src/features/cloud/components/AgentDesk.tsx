import { createContext, use, useState } from 'react';
import { Link } from 'react-router';
import { API_PREFIX, cloudPaths, type CloudAgentDetail, type CloudAgentFile } from '@slider/shared';
import {
  useCloudAgentFile,
  useSetCloudAgentFileAside,
  useTakeCloudAgentDesk,
  useTakeCloudAgentFile,
} from '@/lib/api';
import { routes } from '@/lib/routes';
import { Badge, Button, cn, Dialog, Icon, IconButton, SegmentedControl, Toolbar } from '@/ui';
import { useStoredChoice } from '../hooks/useStoredChoice';
import { fileHref, namedBy, namedHref, type Named } from '../lib/named';
import { DeskIcon, DeskPicture } from './DeskPicture';
import { NamedIcon } from './Named';

/** Where the desk stands: Cloud's agent page or Sender's chat with the agent. */
type DeskNotify = (text: string, tone?: 'danger') => void;
const DeskHost = createContext<{ workspaceId: string; notify: DeskNotify }>({
  workspaceId: '',
  notify: () => {},
});

const SIDES = [
  { value: 'after', label: 'Neu' },
  { value: 'before', label: 'Original' },
] as const;

/**
 * What the agent did with a thing, in words – and where it lies. For one from before, that
 * still waits to be taken over: what is to be done.
 */
function deskLine(file: CloudAgentFile): string {
  const waits = file.status === 'open';
  switch (file.kind) {
    case 'new':
      return `${waits ? 'Neue Datei' : 'Neu'} | ${file.where}`;
    case 'change':
      return `${waits ? 'Änderung' : 'Geändert'} | ${file.where}`;
    case 'folder':
      return `Neuer Ordner | ${file.where}`;
    case 'move':
      return `${waits ? 'Verschieben' : 'Verschoben'} nach ${file.where}`;
    case 'rename':
      return `${waits ? 'Umbenennen' : 'Umbenannt'} | bisher „${file.from ?? ''}“`;
    case 'delete':
      return waits ? `Löschen | ${file.where}` : 'Gelöscht';
    case 'deck':
      return 'Neue Präsentation';
    case 'deck-change':
      return waits ? 'Geänderte Präsentation' : 'Geändert';
  }
}

/** A desk file's text over the page – for a change, the original beside it. */
function DeskFileDialog({
  agentId,
  file,
  onClose,
}: {
  agentId: string;
  file: CloudAgentFile;
  onClose: () => void;
}) {
  const host = use(DeskHost);
  const content = useCloudAgentFile(host.workspaceId, agentId, file.id);
  const [side, setSide] = useState<(typeof SIDES)[number]['value']>('after');
  const original = content.data?.original ?? null;
  return (
    <Dialog
      open
      onClose={onClose}
      title={file.name}
      description={deskLine(file)}
      className="w-[min(92vw,760px)]"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Schließen
        </Button>
      }
    >
      {original !== null && (
        <SegmentedControl
          label="Fassung"
          size="sm"
          track="soft"
          segments={SIDES}
          value={side}
          onChange={setSide}
          className="self-start"
        />
      )}
      {content.isPending ? (
        <div aria-hidden className="skeleton h-64 rounded-control" />
      ) : content.isError ? (
        <p className="text-body text-danger">{content.error.message}</p>
      ) : (
        <pre className="max-h-[60vh] overflow-auto rounded-control bg-surface-2 p-4 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-fg select-text">
          {side === 'before' && original !== null ? original : content.data.content}
        </pre>
      )}
    </Dialog>
  );
}

const DESK_VIEWS = ['tiles', 'list'] as const;

/** What lies on the desk opens in a tab of its own: the chat stays where it is. */
const BESIDE = { target: '_blank', rel: 'noopener' } as const;

/**
 * One thing on the desk, drawn as the files are – a tile with its picture, or a row: its name
 * opens the file, folder or presentation itself in a new tab, and its person takes back what the
 * agent did („Zurücknehmen“). One from before, still waiting, is taken over or put aside as then.
 */
function DeskItem({
  agent,
  file,
  view,
  onShow,
}: {
  agent: CloudAgentDetail;
  file: CloudAgentFile;
  view: (typeof DESK_VIEWS)[number];
  onShow: () => void;
}) {
  const host = use(DeskHost);
  const take = useTakeCloudAgentFile(host.workspaceId, agent.id);
  const aside = useSetCloudAgentFileAside(host.workspaceId, agent.id);
  const refused = (error: Error) => host.notify(error.message, 'danger');
  const waits = file.status === 'open';
  const gone = file.status === 'discarded' || file.kind === 'delete';
  // Its name covers the whole tile or row, as a file's does: one click opens it.
  const cover = 'truncate text-left font-medium text-fg outline-none after:absolute after:inset-0';
  const nodeId = file.nodeId;
  const name =
    waits && (file.kind === 'new' || file.kind === 'change') ? (
      <button type="button" onClick={onShow} className={cn(cover, 'text-body')}>
        {file.name}
      </button>
    ) : file.deckId && !gone ? (
      <Link to={routes.deck(file.deckId)} {...BESIDE} className={cn(cover, 'text-body')}>
        {file.name}
      </Link>
    ) : nodeId && !gone && !waits ? (
      <Link
        to={
          file.kind === 'folder'
            ? routes.cloudFolder(host.workspaceId, nodeId)
            : fileHref(host.workspaceId, { id: nodeId, name: file.name })
        }
        {...BESIDE}
        className={cn(cover, 'text-body')}
      >
        {file.name}
      </Link>
    ) : (
      <span className="truncate text-body font-medium text-fg">{file.name}</span>
    );
  const state = file.status === 'discarded' ? <Badge>Zurückgenommen</Badge> : null;
  const actions = agent.mine && (waits || file.undoable) && (
    <span className="relative z-(--z-raised) flex shrink-0 items-center gap-0.5">
      {waits ? (
        <>
          <IconButton
            icon="check"
            label={`„${file.name}“ übernehmen`}
            title="Übernehmen"
            size="sm"
            iconSize={18}
            disabled={take.isPending}
            onClick={() =>
              take.mutate(file.id, {
                onSuccess: () =>
                  host.notify(
                    file.kind === 'delete' ? `${file.name} gelöscht` : `${file.name} übernommen`,
                  ),
                onError: refused,
              })
            }
          />
          <IconButton
            icon="close"
            label={`„${file.name}“ verwerfen`}
            title="Verwerfen"
            size="sm"
            iconSize={18}
            onClick={() => aside.mutate({ file, aside: true }, { onError: refused })}
          />
        </>
      ) : (
        <IconButton
          icon="undo"
          label={`„${file.name}“ zurücknehmen`}
          title="Zurücknehmen"
          size="sm"
          iconSize={18}
          disabled={aside.isPending}
          onClick={() =>
            aside.mutate(
              { file, aside: true },
              { onSuccess: () => host.notify(`${file.name} zurückgenommen`), onError: refused },
            )
          }
        />
      )}
    </span>
  );
  const meta = (
    <span className="truncate text-xs text-fg-muted" title={deskLine(file)}>
      {deskLine(file)}
    </span>
  );
  if (view === 'list')
    return (
      <li
        className={cn(
          'group relative flex h-13 shrink-0 items-center gap-3.5 rounded-control px-3 transition-colors hover:bg-surface-1 has-[a:focus-visible,button:focus-visible]:ring-2 has-[a:focus-visible,button:focus-visible]:ring-focus',
          file.status === 'discarded' && 'opacity-60',
        )}
      >
        <DeskIcon file={file} size={32} />
        <span className="flex min-w-0 flex-1 flex-col">
          {name}
          {meta}
        </span>
        {state}
        {actions}
      </li>
    );
  return (
    <li
      className={cn(
        'group relative flex min-w-0 flex-col gap-2.5',
        file.status === 'discarded' && 'opacity-60',
      )}
    >
      <div className="relative aspect-[5/3] overflow-hidden rounded-panel bg-surface-1 ring-hairline transition-colors group-hover:bg-surface-2 group-has-[a:focus-visible,button:focus-visible]:ring-2 group-has-[a:focus-visible,button:focus-visible]:ring-focus">
        <DeskPicture file={file} />
        {state && <span className="absolute bottom-1.5 left-1.5 flex">{state}</span>}
      </div>
      <div className="flex min-w-0 items-start gap-2.5 px-0.5">
        <DeskIcon file={file} size={20} />
        <span className="flex min-w-0 flex-1 flex-col">
          {name}
          {/* Under the name, not over the picture: nothing covers what is to be judged. */}
          <span className="flex min-h-7 min-w-0 items-center gap-1">
            <span className="flex min-w-0 flex-1">{meta}</span>
            {actions && <span className="-mr-1.5 flex shrink-0">{actions}</span>}
          </span>
        </span>
      </div>
    </li>
  );
}

/** What the agent found and named, on its desk beside what it made: a click opens it in a new tab. */
function FoundItem({ named, view }: { named: Named; view: (typeof DESK_VIEWS)[number] }) {
  const host = use(DeskHost);
  const cover =
    'truncate text-left text-body font-medium text-fg outline-none after:absolute after:inset-0';
  const name = (
    <Link to={namedHref(host.workspaceId, named)} {...BESIDE} className={cover}>
      {named.name}
    </Link>
  );
  const meta = <span className="truncate text-xs text-fg-muted">Gefunden</span>;
  const ring = 'has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus';
  if (view === 'list')
    return (
      <li
        className={cn(
          'group relative flex h-13 shrink-0 items-center gap-3.5 rounded-control px-3 transition-colors hover:bg-surface-1',
          ring,
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center">
          <NamedIcon named={named} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          {name}
          {meta}
        </span>
      </li>
    );
  return (
    <li className="group relative flex min-w-0 flex-col gap-2.5">
      <div
        className={cn(
          'relative aspect-[5/3] overflow-hidden rounded-panel bg-surface-1 ring-hairline transition-colors group-hover:bg-surface-2',
          'group-has-[a:focus-visible]:ring-2 group-has-[a:focus-visible]:ring-focus',
        )}
      >
        {named.kind === 'file' ? (
          // A file's small picture where there is one, as on its tile in the files.
          <DeskPicture
            file={{
              name: named.name,
              kind: 'change',
              nodeId: named.id,
              // Named in an answer only: nothing says whether it has a picture – asked for.
              thumbnailUrl: `${API_PREFIX}${cloudPaths.thumbnail(named.id)}`,
            }}
          />
        ) : (
          <span className="flex size-full items-center justify-center">
            <NamedIcon named={named} size={32} />
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-start gap-2.5 px-0.5">
        <NamedIcon named={named} />
        <span className="flex min-w-0 flex-1 flex-col">
          {name}
          <span className="flex min-h-7 min-w-0 items-center">{meta}</span>
        </span>
      </div>
    </li>
  );
}

/**
 * The agent's desk („Schreibtisch“): the quick way to all it made, changed and found – each
 * opens the thing itself, and what it did its person takes back from here.
 */
function Desk({ agent }: { agent: CloudAgentDetail }) {
  const host = use(DeskHost);
  const take = useTakeCloudAgentDesk(host.workspaceId, agent.id);
  const [shown, setShown] = useState<CloudAgentFile | null>(null);
  const open = agent.files.filter((file) => file.status === 'open');
  // The latest first. What it found stands after what it did – and only what is not there already.
  const files = [...agent.files].reverse();
  const there = new Set(files.flatMap((file) => [file.nodeId, file.deckId]));
  const found = namedBy(agent).filter((named) => !there.has(named.id));
  const empty = files.length === 0 && found.length === 0;
  const [view, setView] = useStoredChoice('slider.cloud.desk-view', DESK_VIEWS, 'tiles');
  const takeAll = () =>
    take.mutate(undefined, {
      onSuccess: ({ taken, failed }) => {
        // One message: the toast holds one, a second would wipe the first.
        const [first] = failed;
        if (!first) {
          if (taken > 0) host.notify(`${taken} übernommen`);
          return;
        }
        const why = `${first.name}: ${first.message}`;
        host.notify(
          taken > 0
            ? `${taken} übernommen, ${failed.length} nicht | ${why}`
            : failed.length > 1
              ? `${failed.length} nicht übernommen | ${why}`
              : why,
          'danger',
        );
      },
      onError: (error) => host.notify(error.message, 'danger'),
    });
  return (
    <section
      aria-label="Schreibtisch"
      className="glass flex min-h-0 flex-1 flex-col gap-3 rounded-panel p-4"
    >
      <div className="flex h-7 shrink-0 items-center gap-2">
        <Icon name="desk" size={18} className="text-fg-muted" />
        <h2 className="flex-1 text-base font-semibold text-fg">Schreibtisch</h2>
        {agent.mine && open.length > 1 && (
          <Button variant="soft" size="xs" onClick={takeAll} disabled={take.isPending}>
            Alle übernehmen
          </Button>
        )}
        {!empty && (
          <Toolbar role="group" label="Ansicht">
            <IconButton
              icon="gridView"
              label="Kachelansicht"
              size="sm"
              iconSize={18}
              active={view === 'tiles'}
              onClick={() => setView('tiles')}
            />
            <IconButton
              icon="viewList"
              label="Listenansicht"
              size="sm"
              iconSize={18}
              active={view === 'list'}
              onClick={() => setView('list')}
            />
          </Toolbar>
        )}
      </div>
      {empty ? (
        <p className="text-body text-fg-muted">
          Was der Agent anlegt, ändert und findet, steht hier: Ein Klick öffnet es, und was er
          gemacht hat, nimmst du von hier zurück.
        </p>
      ) : (
        <ul
          className={cn(
            '-mr-2 min-h-0 overflow-y-auto overscroll-contain pr-2',
            view === 'tiles'
              ? // Room for the focus ring and the hairline, which the scroll box would cut.
                'grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] content-start gap-x-3 gap-y-5 p-px pb-1'
              : '-mx-1 flex flex-col',
          )}
        >
          {files.map((file) => (
            <DeskItem
              key={file.id}
              agent={agent}
              file={file}
              view={view}
              onShow={() => setShown(file)}
            />
          ))}
          {found.map((named) => (
            <FoundItem key={named.id} named={named} view={view} />
          ))}
        </ul>
      )}
      {shown && <DeskFileDialog agentId={agent.id} file={shown} onClose={() => setShown(null)} />}
    </section>
  );
}

/**
 * The agent's desk wherever it is shown – beside its chats in Cloud and in Sender. What lies on
 * it opens where Cloud opens it: a presentation in Slider, a PDF in Reader, a document in Writer,
 * a folder and anything else in Cloud.
 */
export function AgentDesk({
  agent,
  workspaceId,
  notify,
}: {
  agent: CloudAgentDetail;
  workspaceId: string;
  notify: DeskNotify;
}) {
  return (
    <DeskHost value={{ workspaceId, notify }}>
      <Desk agent={agent} />
    </DeskHost>
  );
}
