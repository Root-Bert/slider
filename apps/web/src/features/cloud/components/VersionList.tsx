import { useState, type ReactNode } from 'react';
import {
  API_PREFIX,
  cloudAccessAtLeast,
  cloudPaths,
  CLOUD_VERSION_DAYS,
  type CloudNode,
  type CloudVersion,
} from '@slider/shared';
import { useDeleteCloudVersion, useLabelCloudVersion, useRestoreCloudVersion } from '@/lib/api';
import { formatDateTime, formatFileSize, formatRelativeTime } from '@/lib/format';
import { Avatar, Badge, cn, ConfirmDialog, Icon, Menu, type MenuAction } from '@/ui';
import { NameDialog } from './NameDialog';

/**
 * A file's versions („Fassungen“): who saved each and when, named ones starred – downloaded,
 * named, restored, deleted from its menu. Cloud's details and Writer's tools show the same list.
 */
export function VersionList({
  node,
  versions,
  notify,
  onDownload,
  onRestored,
  children,
  note,
}: {
  node: Pick<CloudNode, 'id' | 'workspaceId' | 'access'>;
  versions: readonly CloudVersion[];
  notify: (message: string, tone?: 'danger') => void;
  /** A click on a version: Cloud downloads it its way; else as „Herunterladen“. */
  onDownload?: (version: CloudVersion) => void;
  onRestored?: (version: CloudVersion) => void;
  /** Above the list (Cloud: „Neue Fassung hochladen“). */
  children?: ReactNode;
  /** What makes a version, under the list – Cloud's: every upload. */
  note?: string;
}) {
  const restore = useRestoreCloudVersion(node.workspaceId);
  const label = useLabelCloudVersion(node.workspaceId);
  const remove = useDeleteCloudVersion(node.workspaceId);
  const [naming, setNaming] = useState<CloudVersion | null>(null);
  const [removing, setRemoving] = useState<CloudVersion | null>(null);
  const editable = cloudAccessAtLeast(node.access, 'edit');
  const failed = (error: Error) => notify(error.message, 'danger');
  const download = (version: CloudVersion) => {
    const link = document.createElement('a');
    link.href = `${API_PREFIX}${cloudPaths.content(node.id, version.id, true)}`;
    link.download = '';
    link.click();
  };

  return (
    <div className="flex flex-col gap-1">
      {children}
      <ol className="flex flex-col gap-1">
        {versions.map((version) => {
          const active = version.current;
          const actions: MenuAction[] = [
            {
              label: 'Herunterladen',
              icon: 'download',
              onSelect: () => download(version),
            },
            ...(editable
              ? [
                  {
                    label: version.label ? 'Namen ändern' : 'Fassung benennen',
                    icon: 'edit',
                    onSelect: () => setNaming(version),
                  } satisfies MenuAction,
                  ...(version.label
                    ? [
                        {
                          label: 'Namen löschen',
                          icon: 'close',
                          onSelect: () =>
                            label.mutate({ id: version.id, label: null }, { onError: failed }),
                        } satisfies MenuAction,
                      ]
                    : []),
                  ...(version.current
                    ? []
                    : [
                        {
                          label: 'Wiederherstellen',
                          icon: 'history',
                          onSelect: () =>
                            restore.mutate(version.id, {
                              onSuccess: () => {
                                notify(`Fassung ${version.number} wiederhergestellt`);
                                onRestored?.(version);
                              },
                              onError: failed,
                            }),
                        } satisfies MenuAction,
                        {
                          label: 'Löschen',
                          icon: 'delete',
                          tone: 'danger',
                          onSelect: () => setRemoving(version),
                        } satisfies MenuAction,
                      ]),
                ]
              : []),
          ];
          return (
            <li
              key={version.id}
              className={cn(
                'flex flex-col gap-2 rounded-control p-3 transition-colors',
                active ? 'bg-surface-2 ring-hairline-strong' : 'hover:bg-surface-1',
              )}
            >
              <div className="flex items-start gap-3">
                {version.label ? (
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-warning">
                    <Icon name="star" size={14} />
                  </span>
                ) : (
                  <Avatar author={version.createdBy} size={28} nativeTitle={false} />
                )}
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                  title="Diese Fassung herunterladen"
                  onClick={() => (onDownload ?? download)(version)}
                >
                  <span className="flex items-center gap-2 text-body font-medium text-fg">
                    <span className="truncate">
                      {version.label
                        ? `„${version.label}“`
                        : `${version.current ? 'Jetzt | ' : ''}Fassung ${version.number}`}
                    </span>
                    {version.label && version.current && <Badge>Jetzt</Badge>}
                  </span>
                  <span
                    className="truncate text-xs text-fg-subtle"
                    title={formatDateTime(version.createdAt)}
                  >
                    {version.label ? `Fassung ${version.number} | ` : ''}
                    {version.createdBy.name} | {formatRelativeTime(version.createdAt)} |{' '}
                    {formatFileSize(version.sizeBytes)}
                  </span>
                  {version.restoredFrom !== null && (
                    <span className="text-xs text-fg-muted">
                      Wiederhergestellt aus Fassung {version.restoredFrom}
                    </span>
                  )}
                </button>
                <Menu
                  label={`Aktionen für Fassung ${version.number}`}
                  actions={actions}
                  triggerSize="compact"
                />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="px-1 pt-3 text-xs leading-4.5 text-fg-subtle">
        {note ??
          `Jeder Upload über die Datei wird zur Fassung. Benannte Fassungen bleiben für immer, alle anderen ${CLOUD_VERSION_DAYS} Tage.`}
      </p>
      {removing && (
        <ConfirmDialog
          onClose={() => setRemoving(null)}
          title={`Fassung ${removing.number} löschen?`}
          description="Das lässt sich nicht rückgängig machen."
          confirmLabel="Löschen"
          confirmIcon="delete"
          pending={remove.isPending}
          error={remove.error?.message}
          onConfirm={() =>
            remove.mutate(removing.id, {
              onSuccess: () => {
                setRemoving(null);
                notify(`Fassung ${removing.number} gelöscht`);
              },
            })
          }
        />
      )}
      {naming && (
        <NameDialog
          title={`Fassung ${naming.number} benennen`}
          label="Name der Fassung"
          placeholder="z. B. An den Vorstand"
          initialName={naming.label ?? ''}
          submitLabel="Benennen"
          icon="star"
          pending={label.isPending}
          error={label.error?.message}
          onClose={() => setNaming(null)}
          onSubmit={(name) =>
            label.mutate({ id: naming.id, label: name }, { onSuccess: () => setNaming(null) })
          }
        />
      )}
    </div>
  );
}
