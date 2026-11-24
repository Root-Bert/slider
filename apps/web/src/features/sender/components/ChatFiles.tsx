import { useState } from 'react';
import { Link } from 'react-router';
import {
  CLOUD_FOLDER_TYPE,
  isCloudReference,
  isPictureAttachment,
  searchFold,
  type CloudAgentDetail,
  type SenderFile,
} from '@slider/shared';
import { attachmentUrl, useChatFiles, usePlaceChatFile } from '@/lib/api';
import { formatDateTime, formatFileSize, formatRelativeTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import { referenceRoute } from '@/features/attachments';
import { DestinationDialog, type Destination } from '@/features/cloud';
import { Button, EmptyState, Icon, Menu, type MenuAction, type ShowToast } from '@/ui';

/** A file in the list: a conversation's, or one put on an agent's chat (no time, not in Cloud). */
export type ChatFile = Omit<SenderFile, 'createdAt'> & { createdAt: string | null };

/** An agent's „Dateien“: what was put on the messages of all its chats, newest first. */
export function agentFiles(agent: CloudAgentDetail): ChatFile[] {
  return agent.chats
    .flatMap((chat) => chat.messages)
    .flatMap((message) =>
      (message.attachments ?? []).map((attachment) => ({
        attachment,
        author: message.author,
        messageId: message.id,
        createdAt: null,
        node: null,
        filing: null,
      })),
    )
    .reverse();
}

/**
 * A chat's „Dateien“: every file sent in it, newest first – who sent it, when, where it lies in
 * Cloud. A conversation's (`channelId`): where the AI would put one away stands beside it with one
 * click – in Cloud already (an area's chat puts its files into „Chat-Dateien“) it moves there,
 * else a copy is filed there („Ablegen“); „…“ picks another place. An agent's chat (`files`, from
 * its messages): the files to open and load.
 */
export function ChatFiles({
  channelId,
  files: given,
  workspaceId,
  search,
  notify,
}: {
  channelId?: string;
  files?: ChatFile[];
  workspaceId: string;
  /** The page's search: the files by their names. */
  search: string;
  notify: ShowToast;
}) {
  const query = useChatFiles(channelId ?? '', !!channelId);
  const place = usePlaceChatFile(workspaceId);
  const [picking, setPicking] = useState<ChatFile | null>(null);
  const wanted = searchFold(search.trim());
  const all: ChatFile[] = given ?? query.data ?? [];
  const files = all.filter((one) => !wanted || searchFold(one.attachment.name).includes(wanted));

  const put = (one: ChatFile, to?: Destination) => {
    const moving = !!one.node;
    place.mutate(
      {
        attachmentId: one.attachment.id,
        ...(to && { place: { areaId: to.areaId ?? null, parentId: to.parentId ?? null } }),
      },
      {
        onSuccess: (done) => {
          setPicking(null);
          notify(
            moving
              ? `„${one.attachment.name}“ nach „${done.place}“ verschoben`
              : `„${one.attachment.name}“ abgelegt`,
          );
        },
        onError: (error) => notify(error.message, 'danger'),
      },
    );
  };

  // Read in a moment: nothing turns meanwhile.
  if (!given && query.isPending) return <div className="flex-1" />;
  if (!given && query.isError) {
    return <p className="m-auto text-body text-fg-muted">{query.error.message}</p>;
  }
  if (files.length === 0) {
    return (
      <div className="m-auto">
        <EmptyState
          title={wanted ? 'Nichts gefunden' : 'Noch keine Dateien'}
          message={
            wanted
              ? `Keine Datei heißt wie „${search.trim()}“.`
              : 'Was hier geschickt wird – eingefügt oder mit der Büroklammer –, steht hier.'
          }
        />
      </div>
    );
  }
  return (
    <>
      <ul aria-label="Dateien" className="-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
        {files.map((one) => {
          // A Cloud file or folder a message points to: opens there, nothing of its own to load.
          const pointed = isCloudReference(one.attachment);
          const open = pointed
            ? referenceRoute(workspaceId, one.attachment)
            : attachmentUrl(one.attachment.id);
          const picture = !pointed && isPictureAttachment(one.attachment.type);
          const actions: MenuAction[] = pointed
            ? [
                {
                  label: 'In Cloud öffnen',
                  icon: 'openInNew',
                  onSelect: () => window.open(open),
                },
              ]
            : [
                ...(one.node
                  ? [
                      {
                        label: 'In Cloud öffnen',
                        icon: 'openInNew',
                        onSelect: () => window.open(routes.cloudFile(workspaceId, one.node!.id)),
                      } satisfies MenuAction,
                    ]
                  : []),
                ...(channelId
                  ? [
                      {
                        label: one.node ? 'Verschieben …' : 'In Cloud ablegen …',
                        icon: 'driveFileMove',
                        onSelect: () => setPicking(one),
                      } satisfies MenuAction,
                    ]
                  : []),
                {
                  label: 'Laden',
                  icon: 'download',
                  onSelect: () => window.open(attachmentUrl(one.attachment.id, true)),
                },
              ];
          return (
            <li
              key={one.attachment.id}
              className="group flex items-center gap-3 rounded-control px-2 py-2 hover:bg-surface-1 max-sm:flex-wrap"
            >
              <a
                href={open}
                target={pointed ? undefined : '_blank'}
                rel="noreferrer"
                tabIndex={-1}
                aria-hidden
                className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-badge bg-surface-2"
              >
                {picture ? (
                  <img
                    src={attachmentUrl(one.attachment.id)}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : (
                  <Icon
                    name={
                      !pointed
                        ? 'attachFile'
                        : one.attachment.type === CLOUD_FOLDER_TYPE
                          ? 'folder'
                          : 'description'
                    }
                    size={20}
                    className="text-fg-muted"
                  />
                )}
              </a>
              <span className="flex min-w-0 flex-1 flex-col">
                <a
                  href={open}
                  target={pointed ? undefined : '_blank'}
                  rel="noreferrer"
                  className="truncate text-body font-medium text-fg hover:underline focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                >
                  {one.attachment.name}
                </a>
                <span className="flex min-w-0 items-center gap-1 text-xs text-fg-muted">
                  {one.createdAt && (
                    <>
                      <time title={formatDateTime(one.createdAt)} className="shrink-0">
                        {formatRelativeTime(one.createdAt)}
                      </time>
                      <span aria-hidden>|</span>
                    </>
                  )}
                  {one.author && (
                    <>
                      <span className="shrink-0">{one.author.name}</span>
                      <span aria-hidden>|</span>
                    </>
                  )}
                  <span className="shrink-0">
                    {one.attachment.type === CLOUD_FOLDER_TYPE
                      ? 'Ordner'
                      : formatFileSize(one.attachment.size)}
                  </span>
                  {one.node && (
                    <>
                      <span aria-hidden>|</span>
                      <Link
                        to={routes.cloudFile(workspaceId, one.node.id)}
                        title={`In Cloud: ${one.node.place}`}
                        className="truncate hover:text-fg hover:underline"
                      >
                        {one.node.place}
                      </Link>
                    </>
                  )}
                </span>
              </span>
              {one.filing && (
                // On a phone in a line of its own under the file, after its picture.
                <span className="flex min-w-0 shrink items-center gap-2 max-sm:order-last max-sm:basis-full max-sm:pl-13">
                  <span
                    className="truncate text-xs text-fg-muted"
                    title={[`nach ${one.filing.place}`, one.filing.why].filter(Boolean).join(' | ')}
                  >
                    nach {one.filing.place}
                  </span>
                  <Button
                    variant="soft"
                    size="xs"
                    disabled={place.isPending}
                    onClick={() => put(one)}
                  >
                    {one.node ? 'Verschieben' : 'Ablegen'}
                  </Button>
                </span>
              )}
              <Menu
                label={`Aktionen für ${one.attachment.name}`}
                triggerSize="compact"
                actions={actions}
              />
            </li>
          );
        })}
      </ul>
      {picking && (
        <DestinationDialog
          workspaceId={workspaceId}
          nodes={[]}
          heading={picking.attachment.name}
          verb={picking.node ? 'verschieben' : 'kopieren'}
          pending={place.isPending}
          error={place.error?.message ?? null}
          onPick={(to) => put(picking, to)}
          onClose={() => setPicking(null)}
        />
      )}
    </>
  );
}
