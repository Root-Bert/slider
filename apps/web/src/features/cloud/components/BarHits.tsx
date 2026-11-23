import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useCloudSearch } from '@/lib/api';
import { routes } from '@/lib/routes';
import {
  ConversationHitRows,
  HIT,
  hitClass,
  MailHitRows,
  searchConversations,
  stepHits,
  useMailHits,
  useSenderOrNull,
} from '@/features/sender';
import { Icon, useDebounced } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { AreaMark } from './AreaMark';
import { FileIcon } from './FileIcon';

const Line = () => <div role="separator" className="mx-2 my-2 shrink-0 border-t border-hairline" />;

/**
 * What the bar's field finds, in place of the bar's list: what is called so – files and folders,
 * the areas, then the chats and people (Sender's – a person without a chat starts one), then the
 * mails (subject, names, addresses – one opens in Post). What the
 * files say is the page's (`SearchResults`). ↑↓ step, ↵ opens; a click is as a click in the list.
 */
export function BarHits({ query, onPicked }: { query: string; onPicked: () => void }) {
  const ui = useCloud();
  const sender = useSenderOrNull();
  const navigate = useNavigate();
  const settled = useDebounced(query, 150);
  const search = useCloudSearch(ui.workspace.id, settled.trim());
  const mails = useMailHits(ui.workspace.id, sender ? settled.trim() : '');
  const words = query.trim().toLocaleLowerCase('de');
  const nodes = search.data?.nodes ?? [];
  const areas = (ui.home?.areas ?? []).filter((area) =>
    area.name.toLocaleLowerCase('de').includes(words),
  );
  // An area's own chat is the area's: found as the area, it stands there once.
  const shown = new Set(areas.map((area) => area.id));
  const chats = (sender ? searchConversations(sender.home, sender.me.id, query) : []).filter(
    (chat) => !('kind' in chat && chat.kind === 'area' && shown.has(chat.areaId ?? '')),
  );
  const go = (run: () => void) => () => {
    onPicked();
    run();
  };
  const settling = settled !== query || search.isFetching || mails.settling;
  const groups: ReactNode[] = [
    nodes.length > 0 &&
      nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          role="listitem"
          {...{ [HIT]: '' }}
          title={node.name}
          className={hitClass}
          // As a click in the list: a file shows its details, a folder opens.
          onClick={go(() => (node.kind === 'file' ? ui.openFile(node.id) : ui.open(node)))}
        >
          <FileIcon kind={node.kind} type={node.fileType} size={20} className="-mx-px" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </button>
      )),
    areas.length > 0 &&
      areas.map((area) => (
        <button
          key={area.id}
          type="button"
          role="listitem"
          {...{ [HIT]: '' }}
          className={hitClass}
          onClick={go(() => void navigate(routes.cloudArea(ui.workspace.id, area.id)))}
        >
          <span className="flex size-[18px] shrink-0 items-center justify-center">
            <AreaMark area={area} />
          </span>
          <span className="min-w-0 flex-1 truncate">{area.name}</span>
        </button>
      )),
    chats.length > 0 && (
      <ConversationHitRows key="chats" query={query} onPicked={onPicked} hideAreaChats={shown} />
    ),
    mails.threads.length > 0 && (
      <MailHitRows key="mails" threads={mails.threads} onPicked={onPicked} />
    ),
  ].filter(Boolean);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-6">
      <div role="list" aria-label="Treffer" className="flex flex-col gap-0.5" onKeyDown={stepHits}>
        {groups.map((group, index) => (
          <div key={index} className="contents">
            {index > 0 && <Line />}
            {group}
          </div>
        ))}
      </div>
      {groups.length === 0 && !settling && (
        <p className="px-2.5 py-1 text-xs leading-4.5 text-fg-subtle">
          Nichts heißt so – keine Datei, kein Chat, keine Mail, niemand.
        </p>
      )}
      {search.data?.more && (
        <p className="flex items-center gap-1.5 px-2.5 py-2 text-xs text-fg-subtle">
          <Icon name="search" size={14} />
          Mehr Treffer – tippe weiter.
        </p>
      )}
    </div>
  );
}
