import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { cloudFileType, type CloudFocus, type CloudFocusItem } from '@slider/shared';
import { useConversationPlace } from '@/features/sender';
import { useCloudFocus, useOrderCloudAgent } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { useOverviewAgent } from '@/lib/overview-agents';
import { CLOUD_TODO_PARAM, routes } from '@/lib/routes';
import { Icon, type IconName, ListRow, LogoMark, RowList, Spinner, TextLink } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { AgentAvatar } from './AgentAvatar';
import { AsideAgent } from './AsidePart';
import { FileIcon } from './FileIcon';

/*
 * „Für dich“ on Cloud's start, page-wide under the field: what waits for the person across the
 * apps – named or written to in Sender, a mail asking something, an agent waiting for a yes,
 * something newly shared, a to-do due, today's appointments, open comments on their
 * presentations and documents. One sentence on top as Sender's „Aktuell“ has it, the rows below
 * open the thing where it is. The server finds them, the AI only says them: the rows stand at
 * once and go as soon as they are dealt with; the AI's lines join them when it is through.
 */

/** How many rows stand before „Alle zeigen“. */
const SHOWN = 5;

const ICON: Partial<Record<CloudFocusItem['app'], IconName>> = {
  sender: 'chatBubble',
  mail: 'mail',
  share: 'folderShared',
  todo: 'checklist',
  calendar: 'event',
};

function Mark({ item }: { item: CloudFocusItem }) {
  const { target } = item;
  return (
    <span className="flex size-5 shrink-0 items-center justify-center text-fg-muted">
      {item.app === 'agent' && target.kind === 'agent' ? (
        <AgentAvatar id={target.id} size={18} className="rounded-[5px]" />
      ) : item.app === 'slider' ? (
        <LogoMark width={16} />
      ) : item.app === 'writer' ? (
        <FileIcon kind="file" type={cloudFileType('x.odt')} size={20} />
      ) : (
        <Icon name={ICON[item.app] ?? 'info'} size={18} />
      )}
    </span>
  );
}

/** Where a row opens: the conversation, the mail, the agent, the day, the file … */
function useHref() {
  const ui = useCloud();
  const conversation = useConversationPlace();
  const workspaceId = ui.workspace.id;
  return (item: CloudFocusItem): string => {
    const { target } = item;
    switch (target.kind) {
      case 'channel':
        return conversation({
          kind: 'channel',
          id: target.id,
          areaId: target.areaId,
          channelKind: target.channelKind,
        });
      case 'mail':
        return conversation({ kind: 'mail', id: target.id, areaId: null, channelKind: null });
      case 'agent':
        return routes.cloudAgent(workspaceId, target.id);
      case 'event':
        return routes.cloudCalendar(workspaceId, target.day);
      case 'todo':
        return `${routes.cloudTodos(workspaceId)}?${CLOUD_TODO_PARAM}=${encodeURIComponent(target.id)}`;
      case 'node':
        // Something newly shared opens among „Geteilt“: there it counts as seen and goes.
        if (item.app === 'share') return routes.cloudShared(workspaceId);
        return target.nodeKind === 'folder'
          ? routes.cloudFolder(workspaceId, target.id)
          : routes.cloudFile(workspaceId, target.id);
      case 'deck':
        return routes.deck(target.id, target.slideId);
      case 'document':
        return routes.document(target.id, target.commentId);
    }
  };
}

/**
 * What stands: the AI's answer once it is for exactly these entries, else the entries as the
 * server finds them now with the AI's last lines where it said them – nothing dealt with stays.
 */
function shownFocus(plain: CloudFocus | undefined, told: CloudFocus | undefined, fresh: boolean) {
  if (told && fresh && told.ai === 'done') return told;
  if (!plain) return undefined;
  // All dealt with: nothing of the AI's last look stays.
  if (plain.items.length === 0) return plain;
  if (!told || told.ai !== 'done')
    return { ...plain, ai: told?.ai ?? plain.ai, reason: told?.reason ?? null };
  const lines = new Map(told.items.map((item, index) => [item.key, { line: item.line, index }]));
  const items = plain.items
    .map((item, index) => ({ item, index, said: lines.get(item.key) }))
    .sort(
      (a, b) =>
        (a.said?.index ?? Number.MAX_SAFE_INTEGER) - (b.said?.index ?? Number.MAX_SAFE_INTEGER) ||
        a.index - b.index,
    )
    .map(({ item, said }) => ({ ...item, line: said?.line ?? null }));
  // The AI's sentence names its first entries: gone one of them, the count says it instead.
  const named = told.items
    .slice(0, 2)
    .every((item) => lines.has(item.key) && plain.items.some((each) => each.key === item.key));
  return {
    ...plain,
    ai: told.ai,
    headline: (named ? told.headline : null) ?? plain.headline,
    items,
  };
}

export function ForYou({ stamp }: { stamp: string | null }) {
  const ui = useCloud();
  const href = useHref();
  const { plain, told } = useCloudFocus(ui.workspace.id, stamp);
  const [all, setAll] = useState(false);
  const focus = shownFocus(
    plain.data,
    told.data,
    !!told.data && !told.isPlaceholderData && !plain.isPlaceholderData,
  );
  if (!focus) {
    return plain.isError ? null : (
      <div aria-hidden className="flex shrink-0 items-center gap-2.5 pt-3">
        <div className="skeleton size-[18px] rounded-chip" />
        <div className="skeleton h-4 w-1/3 rounded-mark" />
      </div>
    );
  }
  const asking = told.isFetching && !told.data;
  const items = all ? focus.items : focus.items.slice(0, SHOWN);
  let headline: ReactNode = focus.headline ?? 'Gerade wartet nichts auf dich.';
  if (asking && focus.items.length > 0 && !focus.headline)
    headline = 'Die KI schaut, was ansteht …';

  return (
    <section aria-label="Für dich" className="flex shrink-0 flex-col gap-2 pt-3">
      <div className="flex items-start gap-2.5">
        <span className="flex h-6 shrink-0 items-center text-fg-muted">
          <Icon name="autoAwesome" size={18} />
        </span>
        <p className="min-w-0 flex-1 text-base leading-6 font-medium text-fg">{headline}</p>
        {told.isFetching && <Spinner size={16} label="Die KI schaut, was ansteht" />}
      </div>
      {focus.ai !== 'off' && told.data?.ai !== 'off' && (
        <div className="pl-7">
          <FocusAsk />
        </div>
      )}
      {!told.isFetching && focus.ai === 'failed' && (
        <p className="pl-7 text-body text-fg-muted">
          Die KI hat gerade nicht zusammengefasst.{' '}
          <TextLink variant="underline" onClick={() => void told.refetch()}>
            Erneut versuchen
          </TextLink>
        </p>
      )}
      {items.length > 0 && (
        <RowList variant="hover" aria-label="Für dich">
          {items.map((item) => {
            const title = item.line ?? item.text;
            const when = item.when ?? (item.at ? formatRelativeTime(item.at) : null);
            return (
              <ListRow
                key={item.key}
                variant="hover"
                padding="wide"
                className="relative"
                leading={<Mark item={item} />}
                title={
                  <Link
                    to={href(item)}
                    className="outline-none after:absolute after:inset-0 after:rounded-control focus-visible:after:ring-2 focus-visible:after:ring-focus"
                  >
                    {title}
                  </Link>
                }
                subtitle={item.line ? `${item.place} | ${item.text}` : item.place}
                subtitleTitle={item.line ? `${item.place} | ${item.text}` : item.place}
                trailing={
                  when ? <span className="shrink-0 text-xs text-fg-subtle">{when}</span> : undefined
                }
              />
            );
          })}
        </RowList>
      )}
      {focus.items.length > SHOWN && (
        <div className="pl-7">
          <TextLink size="body" onClick={() => setAll((before) => !before)}>
            {all ? 'Weniger zeigen' : `Alle ${focus.items.length} zeigen`}
          </TextLink>
        </div>
      )}
    </section>
  );
}

const OVERVIEW = { of: 'cloud' } as const;

/**
 * Under the headline, as under Sender's „Aktuell“: a reply, a question or an order to an agent of
 * one's own, its chat right there – the agent is told what „Für dich“ shows, by id.
 */
function FocusAsk() {
  const ui = useCloud();
  const [agentId, setAgentId] = useOverviewAgent(ui.workspace.id, OVERVIEW);
  const order = useOrderCloudAgent(ui.workspace.id);
  return (
    <AsideAgent
      bare
      workspaceId={ui.workspace.id}
      agentId={agentId}
      onAgent={setAgentId}
      order={order}
      overview={OVERVIEW}
      placeholder="Frag dazu oder gib einen Auftrag …"
      agentPath={(id) => routes.cloudAgent(ui.workspace.id, id)}
      notify={ui.notify}
    />
  );
}
