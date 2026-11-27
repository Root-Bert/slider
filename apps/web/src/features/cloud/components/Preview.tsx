import { useEffect, useEffectEvent, useState } from 'react';
import { useSearchParams } from 'react-router';
import { cloudAccessAtLeast, type CloudNodeDetail } from '@slider/shared';
import { useCloudNode } from '@/lib/api';
import { formatDateTime, formatFileSize, formatRelativeTime } from '@/lib/format';
import { isTextTarget } from '@/lib/dom';
import { CLOUD_FILE_PARAM } from '@/lib/routes';
import { Avatar, Button, Icon, IconButton, Menu, SegmentedControl, SidePanel } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { useOnThisComputer } from '../lib/computer';
import { FILE_KINDS } from '../lib/kinds';
import { ActivityFeed } from './ActivityFeed';
import { AreaDot } from './AreaDot';
import { FileIcon } from './FileIcon';
import { FileName } from './FileName';
import { VersionList } from './VersionList';
import { NodeNameInput } from './NodeNameInput';
import { hasPagePreview, PagePreview } from './PagePreview';

const TABS = [
  { value: 'details', label: 'Details' },
  { value: 'activity', label: 'Aktivität' },
  { value: 'versions', label: 'Fassungen' },
] as const;
type Tab = (typeof TABS)[number]['value'];

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-body text-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-right text-body text-fg">{children}</dd>
    </div>
  );
}

function Details({ detail }: { detail: CloudNodeDetail }) {
  const { node, area, path, audience, shares } = detail;
  const people = shares.filter((share) => share.kind === 'user');
  const link = shares.find((share) => share.kind === 'link');
  const here = useOnThisComputer(node.workspaceId).has(node.id);
  const { userId } = useCloud();
  const folder = node.kind === 'folder';
  // Reached only through a share: where it lies is its owner's business.
  const top =
    area?.name ?? (node.areaId === null && node.owner.id === userId ? 'Meine Dateien' : 'Geteilt');
  return (
    <div className="flex flex-col gap-4">
      {hasPagePreview(node) && <PagePreview key={`${node.id}-${node.versionId}`} node={node} />}
      <dl className="flex flex-col divide-y divide-hairline">
        <Fact label="Art">{folder ? 'Ordner' : FILE_KINDS[node.fileType ?? 'other'].label}</Fact>
        {!folder && <Fact label="Größe">{formatFileSize(node.sizeBytes)}</Fact>}
        <Fact label="Ort">
          <span className="inline-flex max-w-full items-center gap-2">
            {area && <AreaDot color={area.color} />}
            <span className="truncate">{[top, ...path.map((each) => each.name)].join(' › ')}</span>
          </span>
        </Fact>
        <Fact label="Geändert">
          <span title={formatDateTime(node.updatedAt)}>
            {formatRelativeTime(node.updatedAt)} | {node.updatedBy.name}
          </span>
        </Fact>
        <Fact label={folder ? 'Angelegt' : 'Hochgeladen'}>
          <span title={formatDateTime(node.createdAt)}>
            {formatRelativeTime(node.createdAt)} | {node.owner.name}
          </span>
        </Fact>
        {!folder && <Fact label="Fassungen">{node.versionCount}</Fact>}
        {here && <Fact label="Auf diesem Computer">Ja</Fact>}
      </dl>
      <section aria-label="Wer es sieht" className="flex flex-col gap-2.5">
        <h3 className="text-caption font-semibold tracking-wider text-fg-subtle uppercase">
          Wer es sieht
        </h3>
        <p className="flex items-center gap-2.5 text-body text-fg-muted">
          <Icon
            name={audience.kind === 'owner' ? 'lock' : 'groups'}
            size={16}
            className="text-fg-subtle"
          />
          {audience.kind === 'owner'
            ? `Nur ${node.owner.name}`
            : audience.kind === 'workspace'
              ? `Alle im Workspace | ${audience.count} ${audience.count === 1 ? 'Person' : 'Personen'}`
              : `Bereich ${area?.name ?? ''} | ${audience.count} ${audience.count === 1 ? 'Person' : 'Personen'}`}
        </p>
        {people.map(
          (share) =>
            share.user && (
              <p key={share.id} className="flex items-center gap-2.5 text-body text-fg-muted">
                <Avatar author={share.user} size={18} nativeTitle={false} />
                <span className="min-w-0 flex-1 truncate">{share.user.name}</span>
                <span className="text-fg-subtle">
                  {share.role === 'edit' ? 'Kann bearbeiten' : 'Kann ansehen'}
                </span>
              </p>
            ),
        )}
        {link && (
          <p className="flex items-center gap-2.5 text-body text-fg-muted">
            <Icon name="public" size={16} className="text-fg-subtle" />
            Jede Person mit dem Link
          </p>
        )}
      </section>
    </div>
  );
}

function Versions({ detail }: { detail: CloudNodeDetail }) {
  const ui = useCloud();
  const { node, versions } = detail;
  const editable = cloudAccessAtLeast(node.access, 'edit');
  // On this computer the file is changed where it lies: what is saved there goes up.
  const here = useOnThisComputer(node.workspaceId).has(node.id);
  return (
    <VersionList
      node={node}
      versions={versions}
      notify={ui.notify}
      onDownload={(version) => ui.download([{ ...node, versionId: version.id }])}
    >
      {editable && !here && (
        <Button
          variant="soft"
          size="sm"
          icon="upload"
          className="mb-2 self-start"
          onClick={() => ui.uploadVersion(node)}
        >
          Neue Fassung hochladen
        </Button>
      )}
    </VersionList>
  );
}

// ── The whole view ──────────────────────────────────────────────────────────

/**
 * „Details“: what there is to know about a file or folder, in a panel beside the list – its pages
 * to leaf through, facts and who sees it, what happened to it, its versions. The file itself
 * opens in its app (`ui.open`).
 */
export function Preview() {
  const ui = useCloud();
  const [params, setParams] = useSearchParams();
  const asked = params.get(CLOUD_FILE_PARAM);
  // Deleted here (⌫ right after the click came before the details did): nothing to ask for.
  const gone = asked !== null && ui.gone.has(asked);
  const nodeId = gone ? null : asked;
  const detail = useCloudNode(ui.workspace.id, nodeId);
  const [tab, setTab] = useState<Tab>('details');

  const close = (replace?: boolean) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(CLOUD_FILE_PARAM);
        return next;
      },
      { replace },
    );
  useEffect(() => {
    if (gone) close(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once it is gone
  }, [gone]);
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!nodeId || event.key !== 'Escape' || event.defaultPrevented) return;
    if (isTextTarget(event.target) || document.querySelector('dialog[open], [role="menu"]')) return;
    event.preventDefault();
    close();
  });
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!nodeId) return null;
  const data = detail.data;
  const node = data?.node;
  const editable = node ? cloudAccessAtLeast(node.access, 'edit') : false;
  const why = node ? ui.cannotOpen(node) : null;
  const way = node && !node.deleted ? ui.toComputer([node]) : null;
  const shownTab = tab === 'versions' && node?.kind !== 'file' ? 'details' : tab;

  return (
    // Slider's side panel: the header's right end steps aside for it (`data-cloud-panel`,
    // `AppHeader`).
    <SidePanel aria-label={node ? `Details zu „${node.name}“` : 'Details'} data-cloud-panel>
      <header className="flex shrink-0 flex-col gap-3 border-b border-hairline p-3">
        <div className="flex items-center gap-3">
          {node ? <FileIcon kind={node.kind} type={node.fileType} /> : <span className="size-10" />}
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="flex min-w-0 text-body font-semibold text-fg">
              {node && ui.renaming?.where === 'preview' && ui.renaming.id === node.id ? (
                <NodeNameInput node={node} />
              ) : (
                <span className="flex min-w-0" title={node?.name}>
                  {node ? <FileName node={node} /> : ' '}
                </span>
              )}
            </h2>
            {node && (
              <p className="truncate text-xs text-fg-subtle">
                {node.kind === 'folder' ? 'Ordner' : formatFileSize(node.sizeBytes)}
              </p>
            )}
          </div>
          {node && (
            <Menu
              label={`Aktionen für „${node.name}“`}
              actions={ui
                .actionsFor([node])
                .filter((action) => action.label !== 'Details')
                .map((action) =>
                  action.label === 'Löschen'
                    ? {
                        ...action,
                        onSelect: () => {
                          action.onSelect();
                          close();
                        },
                      }
                    : action,
                )}
            />
          )}
          <IconButton
            icon="close"
            label="Details schließen (Esc)"
            size="sm"
            onClick={() => close()}
          />
        </div>
        {node && (
          <div className="flex items-center gap-2">
            {/* „Öffnen“ always first; beside it the way to the computer – the download in the
                browser, the Finder in Cloud's app. Where nothing here opens it, that one leads. */}
            <Button
              variant={why ? 'secondary' : 'primary'}
              size="sm"
              icon={node.kind === 'folder' ? 'folderOpen' : 'openInNew'}
              loading={ui.fetching.get(node.id) === 'loading'}
              disabled={!!why}
              title={why ?? undefined}
              onClick={() => ui.open(node)}
            >
              Öffnen
            </Button>
            {way && (
              <Button
                variant={why ? 'primary' : 'secondary'}
                size="sm"
                icon={way.icon}
                onClick={way.onSelect}
              >
                {way.label}
              </Button>
            )}
            {editable && ui.home?.sharing && (
              <Button variant="secondary" size="sm" icon="personAdd" onClick={() => ui.share(node)}>
                Teilen
              </Button>
            )}
          </div>
        )}
        {node && (
          <SegmentedControl
            label="Zur Datei"
            mode="tabs"
            size="sm"
            track="soft"
            segments={TABS.filter((each) => each.value !== 'versions' || node.kind === 'file')}
            value={shownTab}
            onChange={setTab}
          />
        )}
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {detail.isPending ? (
          <div className="skeleton h-40 rounded-card" />
        ) : detail.isError || !data || !node ? (
          <p className="text-body text-fg-subtle">
            {detail.error?.message ?? 'Diese Datei gibt es nicht (mehr).'}
          </p>
        ) : shownTab === 'details' ? (
          <Details detail={data} />
        ) : shownTab === 'activity' ? (
          <ActivityFeed
            events={data.events}
            compact
            empty="Mit dieser Datei ist noch nichts passiert."
          />
        ) : (
          <Versions detail={data} />
        )}
      </div>
    </SidePanel>
  );
}
