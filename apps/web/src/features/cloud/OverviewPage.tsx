import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import type { CloudOverview } from '@slider/shared';
import { useCloudOverview, useRemoveCloudShare } from '@/lib/api';
import { formatDay, formatFileSize, formatRelativeTime, pluralize } from '@/lib/format';
import { routes } from '@/lib/routes';
import { ROLE_LABELS } from '@/features/workspaces';
import { Avatar, cn, IconButton, Legend } from '@/ui';
import { AreaDot, areaColor } from './components/AreaDot';
import { CloudPage } from './components/CloudPage';
import { LoadFailed } from './components/Empty';
import { FileIcon } from './components/FileIcon';
import { FileName } from './components/FileName';
import { StorageBar, storageParts } from './components/StorageMeter';
import { useCloud } from './hooks/useCloud';
import { FILE_KINDS } from './lib/kinds';

function Card({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('glass flex flex-col gap-4 rounded-panel p-5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {aside && <span className="text-xs text-fg-subtle">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** A name, its size, and a bar as long as its share of the largest. */
function Share({
  lead,
  label,
  value,
  part,
  fill,
}: {
  lead?: ReactNode;
  label: string;
  value: string;
  part: number;
  /** A class, or a CSS colour (`#…`, `var(…)`). */
  fill: string;
}) {
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-body">
        {lead}
        <span className="min-w-0 flex-1 truncate text-fg">{label}</span>
        <span className="text-fg-muted tabular-nums">{value}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-3">
        <div
          className={cn('h-full rounded-full', fill.startsWith('bg-') && fill)}
          style={{
            width: `${Math.max(part * 100, part > 0 ? 1 : 0)}%`,
            ...(!fill.startsWith('bg-') && { backgroundColor: fill }),
          }}
        />
      </div>
    </li>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="glass flex flex-col gap-1 rounded-panel px-4 py-3.5">
      <span className="text-2xl leading-8 font-semibold text-fg tabular-nums">{value}</span>
      <span className="text-xs text-fg-subtle">{label}</span>
    </div>
  );
}

/** Uploads per day, the last 30: a bar a day, as tall as its share of the busiest. */
function Days({ days }: { days: CloudOverview['days'] }) {
  const most = Math.max(1, ...days.map((day) => day.bytes));
  return (
    <div className="flex h-24 items-end gap-1" role="img" aria-label="Uploads der letzten 30 Tage">
      {days.map((day) => (
        <div
          key={day.day}
          title={`${formatDay(day.day)}: ${pluralize(day.uploads, 'Upload', 'Uploads')} | ${formatFileSize(day.bytes)}`}
          className={cn(
            'min-h-0.5 flex-1 rounded-mark',
            day.uploads > 0 ? 'bg-sage' : 'bg-surface-3',
          )}
          style={{ height: `${Math.max(2, (day.bytes / most) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * The admins' overview of the workspace's files: how full it is and with what, which area and
 * which kind of file takes the room, who is where, what is open to people outside. Sizes and
 * counts – of people's own files never more than how much.
 */
export function Component() {
  const ui = useCloud();
  const { workspace } = ui;
  const overview = useCloudOverview(workspace.id);
  const removeLink = useRemoveCloudShare(workspace.id);
  if (workspace.role !== 'admin') return <Navigate to={routes.cloud(workspace.id)} replace />;
  const data = overview.data;
  const showLinks = ui.home?.links === true || (data?.links.length ?? 0) > 0;
  const largestArea = Math.max(1, ...(data?.byArea ?? []).map((area) => area.bytes));
  const largestType = Math.max(1, ...(data?.byType ?? []).map((type) => type.bytes));
  const areaOf = new Map((ui.home?.areas ?? []).map((area) => [area.id, area]));

  return (
    <CloudPage
      docTitle="Übersicht"
      title="Übersicht"
      crumbs={[{ label: 'Übersicht' }]}
      subtitle={`${workspace.name} | ${pluralize(workspace.memberCount, 'Person', 'Personen')}`}
      nodes={[]}
    >
      {() =>
        overview.isPending ? (
          <div aria-hidden className="flex flex-col gap-4">
            <div className="skeleton h-32 rounded-panel" />
            <div className="skeleton h-64 rounded-panel" />
          </div>
        ) : overview.isError || !data ? (
          <LoadFailed
            message={overview.error?.message ?? ''}
            onRetry={() => void overview.refetch()}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <section className="glass flex flex-col gap-4 rounded-panel p-5">
              <p className="flex items-baseline gap-2">
                <span className="text-4xl leading-10 font-semibold tracking-tight text-fg tabular-nums">
                  {formatFileSize(data.storage.usedBytes)}
                </span>
                <span className="text-sm text-fg-muted">
                  {data.storage.maxBytes === null
                    ? 'belegt, ohne Limit'
                    : `von ${formatFileSize(data.storage.maxBytes)} belegt`}
                </span>
              </p>
              <StorageBar storage={data.storage} />
              <Legend
                label="Speicher nach Art"
                size="sm"
                items={storageParts(data.storage).map((part) => ({
                  key: part.key,
                  label: part.label,
                  value: formatFileSize(part.bytes),
                  color: part.fill,
                }))}
              />
            </section>

            {/* As many as there are share the row: none leaves a hole at its end. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-4">
              <Figure value={data.totals.files.toLocaleString('de-DE')} label="Dateien" />
              <Figure value={data.totals.folders.toLocaleString('de-DE')} label="Ordner" />
              <Figure value={formatFileSize(data.totals.versionBytes)} label="Ältere Fassungen" />
              <Figure
                value={formatFileSize(data.totals.trashBytes)}
                label={`Gelöscht (${data.totals.trashCount})`}
              />
              <Figure value={String(data.totals.shares)} label="Freigaben an Personen" />
              {showLinks && <Figure value={String(data.totals.links)} label="Offene Links" />}
            </div>

            {/* Two stacks, each card as tall as what is in it: a short one beside a long one
              leaves no hole, the next follows right under it. */}
            <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-4">
                <Card title="Je Bereich">
                  <ul className="flex flex-col gap-3.5">
                    {data.byArea.map((area) => (
                      <Share
                        key={area.areaId ?? 'own'}
                        lead={
                          area.color ? (
                            <AreaDot color={area.color} />
                          ) : (
                            <span className="size-2.5 rounded-mark bg-fg-subtle" />
                          )
                        }
                        label={area.name}
                        value={`${pluralize(area.files, 'Datei', 'Dateien')} | ${formatFileSize(area.bytes)}`}
                        part={area.bytes / largestArea}
                        fill={area.color ? areaColor(area.color) : 'bg-fg-subtle'}
                      />
                    ))}
                  </ul>
                </Card>
                <Card title="Uploads" aside="letzte 30 Tage">
                  <Days days={data.days} />
                </Card>
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <Card title="Nach Art">
                  {data.byType.length === 0 ? (
                    <p className="text-body text-fg-subtle">Noch keine Dateien.</p>
                  ) : (
                    <ul className="flex flex-col gap-3.5">
                      {data.byType.map((type) => (
                        <Share
                          key={type.type}
                          lead={<FileIcon kind="file" type={type.type} size={20} />}
                          label={FILE_KINDS[type.type].label}
                          value={`${pluralize(type.files, 'Datei', 'Dateien')} | ${formatFileSize(type.bytes)}`}
                          part={type.bytes / largestType}
                          fill="bg-fg-muted"
                        />
                      ))}
                    </ul>
                  )}
                </Card>
                <Card title="Größte Dateien" aside="in Bereichen">
                  {data.largest.length === 0 ? (
                    <p className="text-body text-fg-subtle">Noch keine Dateien in Bereichen.</p>
                  ) : (
                    <ul className="-mx-2 flex flex-col">
                      {data.largest.map((node) => (
                        <li key={node.id}>
                          <button
                            type="button"
                            onClick={() => ui.openFile(node.id)}
                            className="flex h-11 w-full items-center gap-3 rounded-control-sm px-2 text-left transition-colors hover:bg-hover"
                          >
                            <FileIcon kind="file" type={node.fileType} size={20} />
                            <FileName node={node} className="flex-1 text-body text-fg" />
                            <span className="truncate text-xs text-fg-subtle">
                              {node.location?.areaName}
                            </span>
                            <span className="w-16 text-right text-body text-fg-muted tabular-nums">
                              {formatFileSize(node.sizeBytes)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>

            <Card title="Personen" aside="Eigene Dateien: nur ihre Größe">
              <ul className="flex flex-col divide-y divide-hairline">
                {data.byPerson.map(({ person, areaIds, ownBytes, lastActiveAt }) => (
                  <li key={person.id} className="flex min-h-12 items-center gap-3 py-1.5">
                    <Avatar author={person} size={28} nativeTitle={false} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body font-medium text-fg">{person.name}</span>
                      <span className="truncate text-xs text-fg-subtle">{person.email}</span>
                    </span>
                    <span className="w-24 text-body text-fg-muted max-md:hidden">
                      {ROLE_LABELS[person.role]}
                    </span>
                    <span className="flex w-28 flex-wrap gap-1 max-md:hidden">
                      {areaIds.map((id) => {
                        const area = areaOf.get(id);
                        return area ? (
                          <span key={id} title={area.name}>
                            <AreaDot color={area.color} />
                          </span>
                        ) : null;
                      })}
                    </span>
                    <span className="w-20 text-right text-body text-fg-muted tabular-nums">
                      {formatFileSize(ownBytes)}
                    </span>
                    <span className="w-28 text-right text-xs text-fg-subtle max-lg:hidden">
                      {lastActiveAt ? formatRelativeTime(lastActiveAt) : 'Noch nie'}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            {/* Links for people outside: only where the instance offers them, or some are left. */}
            {showLinks && (
              <Card title="Offene Links" aside="Was Personen außerhalb sehen können">
                {data.links.length === 0 ? (
                  <p className="text-body text-fg-subtle">
                    Kein Link führt aus den Bereichen nach draußen.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-hairline">
                    {data.links.map(({ share, node }) => (
                      <li key={share.id} className="flex min-h-12 items-center gap-3 py-1.5">
                        <FileIcon kind={node.kind} type={node.fileType} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <FileName node={node} className="text-body font-medium text-fg" />
                          <span className="truncate text-xs text-fg-subtle">
                            {node.location?.areaName} | von {share.createdBy.name} |{' '}
                            {pluralize(share.opens, 'Aufruf', 'Aufrufe')}
                            {share.expiresAt
                              ? ` | läuft ${formatDay(share.expiresAt)} ab`
                              : ' | ohne Ablauf'}
                          </span>
                        </span>
                        <IconButton
                          icon="linkOff"
                          label={`Link zu „${node.name}“ entfernen`}
                          title="Link entfernen"
                          size="sm"
                          onClick={() =>
                            removeLink.mutate(share.id, {
                              onSuccess: () => ui.notify('Link entfernt'),
                              onError: (error) => ui.notify(error.message, 'danger'),
                            })
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )}
          </div>
        )
      }
    </CloudPage>
  );
}
