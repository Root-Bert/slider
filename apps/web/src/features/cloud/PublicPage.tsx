import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { API_PREFIX, cloudPaths, cloudPreviewKind, type CloudPublic } from '@slider/shared';
import { useCloudPublic } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { formatDay, formatFileSize, formatRelativeTime } from '@/lib/format';
import { Button, cn, Icon, TextLink } from '@/ui';
import { CloudLogo } from './components/AppSwitcher';
import { FileIcon } from './components/FileIcon';

type PublicNode = CloudPublic['node'];
const FOLDER_PARAM = 'ordner';

const save = (path: string) => {
  const link = document.createElement('a');
  link.href = `${API_PREFIX}${path}`;
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
};

/** A shared file by itself: what it looks like where the browser can show it, and a way to load it. */
function SharedFile({ token, node }: { token: string; node: PublicNode }) {
  const kind = cloudPreviewKind(node.name, node.sizeBytes);
  const url = `${API_PREFIX}${cloudPaths.publicContent(token, node.id)}`;
  return (
    <div className="flex flex-col items-center gap-6">
      {kind === 'image' ? (
        <img
          src={url}
          alt={node.name}
          className="checkerboard max-h-[60vh] max-w-full rounded-thumb object-contain shadow-float"
        />
      ) : kind === 'video' ? (
        <video src={url} controls playsInline className="max-h-[60vh] max-w-full rounded-panel" />
      ) : kind === 'audio' ? (
        <audio src={url} controls className="w-full max-w-md" />
      ) : (
        <FileIcon kind="file" type={node.fileType} size={56} />
      )}
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-2xl leading-8 font-semibold text-fg">{node.name}</h1>
        <p className="text-sm text-fg-subtle">
          {formatFileSize(node.sizeBytes)} | geändert {formatRelativeTime(node.updatedAt)}
        </p>
      </div>
      <Button
        variant="primary"
        size="lg"
        icon="download"
        onClick={() => save(cloudPaths.publicContent(token, node.id, true))}
      >
        Herunterladen
      </Button>
    </div>
  );
}

function Row({
  token,
  node,
  onOpen,
}: {
  token: string;
  node: PublicNode;
  onOpen: (node: PublicNode) => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <li className="group relative flex h-13 items-center gap-3.5 rounded-control px-3 transition-colors hover:bg-surface-1 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-focus">
      {node.thumbnail && node.fileType === 'image' && !failed ? (
        <img
          src={`${API_PREFIX}${cloudPaths.publicThumbnail(token, node.id)}`}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-8 shrink-0 rounded-chip object-cover"
        />
      ) : (
        <FileIcon kind={node.kind} type={node.fileType} />
      )}
      <button
        type="button"
        onClick={() => onOpen(node)}
        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-fg outline-none after:absolute after:inset-0"
      >
        {node.name}
      </button>
      <span className="text-body text-fg-subtle max-sm:hidden">
        {formatRelativeTime(node.updatedAt)}
      </span>
      <span className="w-20 text-right text-body text-fg-subtle tabular-nums">
        {formatFileSize(node.sizeBytes)}
      </span>
      <Icon
        name={node.kind === 'folder' ? 'chevronRight' : 'download'}
        size={18}
        className="text-fg-faint transition-colors group-hover:text-fg"
      />
    </li>
  );
}

/**
 * `/s/:token` – what a link shows to someone without an account: the shared file, or the shared
 * folder to walk through, each file to load and the folder as one ZIP. Nothing else of the
 * workspace, and nothing once the link expired or was taken back.
 */
export function Component() {
  const { token = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const folderId = params.get(FOLDER_PARAM);
  const shared = useCloudPublic(token, folderId);
  const data = shared.data;
  const openFolder = (id: string | null) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (id) next.set(FOLDER_PARAM, id);
      else next.delete(FOLDER_PARAM);
      return next;
    });

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>{data ? `${data.root.name} | Cloud` : 'Cloud'}</title>
      <header className="flex h-[88px] shrink-0 items-center justify-between px-6 md:px-8">
        <CloudLogo />
        {data && (
          <p className="text-body text-fg-subtle max-sm:hidden">
            Geteilt von {data.sharedBy} | {data.workspaceName}
            {data.expiresAt && ` | gültig bis ${formatDay(data.expiresAt)}`}
          </p>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-[880px] flex-1 flex-col px-4 pt-6 pb-16">
        {shared.isPending ? (
          <div aria-hidden className="skeleton h-64 rounded-panel" />
        ) : shared.isError || !data ? (
          <div className="m-auto flex max-w-sm flex-col items-center gap-3 text-center">
            <Icon name="linkOff" size={32} className="text-fg-subtle" />
            <h1 className="text-2xl leading-8 font-semibold text-fg">
              Dieser Link führt nirgends hin
            </h1>
            {/* The title says it is gone, the text what to do; another refusal says itself. */}
            <p className="text-sm text-fg-subtle">
              {shared.error instanceof ApiError && shared.error.code !== 'link_revoked'
                ? shared.error.message
                : 'Er ist abgelaufen oder wurde entfernt. Frag die Person, die ihn geteilt hat, nach einem neuen.'}
            </p>
          </div>
        ) : data.node.kind === 'file' ? (
          <div className="glass m-auto w-full rounded-panel p-8 md:p-12">
            <SharedFile token={token} node={data.node} />
          </div>
        ) : (
          <div className={cn('flex flex-col gap-5', shared.isPlaceholderData && 'opacity-60')}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                {data.path.length > 0 && (
                  <nav aria-label="Pfad" className="flex items-center gap-1 text-body">
                    {data.path.map((each) => (
                      <span key={each.id} className="flex items-center gap-1">
                        <TextLink
                          size="body"
                          onClick={() => openFolder(each.id === data.root.id ? null : each.id)}
                        >
                          {each.name}
                        </TextLink>
                        <Icon name="chevronRight" size={14} className="text-fg-faint" />
                      </span>
                    ))}
                  </nav>
                )}
                <h1 className="flex min-w-0 items-center gap-3 text-display leading-tight font-semibold tracking-tight text-fg">
                  <FileIcon kind="folder" type={null} />
                  <span className="truncate">{data.node.name}</span>
                </h1>
              </div>
              {data.children.length > 0 && (
                <Button
                  variant="secondary"
                  icon="download"
                  onClick={() => save(cloudPaths.publicArchive(token, data.node.id))}
                >
                  Alles herunterladen
                </Button>
              )}
            </div>
            {data.children.length === 0 ? (
              <p className="py-12 text-center text-body text-fg-subtle">Hier liegt noch nichts.</p>
            ) : (
              <ul className="flex flex-col">
                {data.children.map((child) => (
                  <Row
                    key={child.id}
                    token={token}
                    node={child}
                    onOpen={(node) =>
                      node.kind === 'folder'
                        ? openFolder(node.id)
                        : save(cloudPaths.publicContent(token, node.id, true))
                    }
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
