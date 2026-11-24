import { useState } from 'react';
import { Link } from 'react-router';
import { AgentAvatar, AGENT_GRID } from '@/features/cloud';
import { dropDraft } from '@/lib/drafts';
import { formatRelativeTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import { ConfirmDialog, EmptyState, Icon, ListRow, Menu, RowList } from '@/ui';
import { useSender } from '../hooks/useSender';
import { useWorkspaceDrafts, type DraftPlace } from '../hooks/useWorkspaceDrafts';
import { DRAFT_KINDS, draftsOf, summary, type DraftKind, type DraftView } from '../lib/draft-kinds';
import { NEW_MAIL } from '../lib/mail';
import { ConversationMark } from './ConversationSearch';

/** A draft's mark: the conversation's, the agent's picture, a mail's or a new agent's sign. */
function PlaceMark({ place }: { place: DraftPlace }) {
  if (place.kind === 'conversation') return <ConversationMark conversation={place.channel} />;
  if (place.kind === 'agent')
    return <AgentAvatar id={place.agentId} size={18} className="rounded-mark" />;
  if (place.kind === 'mail' || place.kind === 'mail-new') return <Icon name="mail" size={18} />;
  return <Icon name="autoAwesome" size={18} />;
}

/**
 * „Entwürfe“: what was written and not sent – in a conversation (areas, groups, people), to an
 * agent, as a mail's answer or a new mail, as a new agent's order (an area's too) – in one list,
 * the same on every device. A click goes on writing there; „Löschen“ throws a draft away.
 */
export function DraftList({
  query = '',
  kind = 'all',
  view = 'list',
}: {
  /** The page's search: only drafts with every word in their name or text. */
  query?: string;
  kind?: DraftKind;
  view?: DraftView;
}) {
  const ui = useSender();
  const all = useWorkspaceDrafts();
  const entries = draftsOf(all, kind, query);
  const [deleting, setDeleting] = useState<string | null>(null);
  if (!ui.home) return null;
  if (all.length === 0) {
    return (
      <div className="m-auto py-16">
        <EmptyState
          title="Keine Entwürfe"
          message="Was du in einem Chat, an einen Agenten oder als Mail schreibst und nicht abschickst, steht hier."
        />
      </div>
    );
  }
  if (entries.length === 0) {
    const label = DRAFT_KINDS.find((each) => each.value === kind)?.label ?? '';
    return (
      <div className="m-auto py-16">
        <EmptyState
          title={
            query.trim() ? `Keine Treffer für „${query.trim()}“` : `Keine Entwürfe unter „${label}“`
          }
          message={
            query.trim()
              ? 'Gesucht wird im Namen und im Text.'
              : 'Was du dort schreibst und nicht abschickst, steht hier.'
          }
        />
      </div>
    );
  }
  const name = (key: string) => all.find((each) => each.key === key)?.name ?? '';
  const pathOf = (place: DraftPlace) => {
    if (place.kind === 'conversation') return ui.pathOf(place.channel);
    if (place.kind === 'mail') return ui.mailThreadPath(place.threadId);
    if (place.kind === 'agent-new')
      return place.areaId
        ? routes.cloudAreaAgents(ui.workspace.id, place.areaId)
        : ui.newPath('agent');
    if (place.kind === 'mail-new') return ui.mailThreadPath(NEW_MAIL);
    return ui.agentPath(place.agentId);
  };
  const menuOf = (key: string, title: string) => (
    <Menu
      label={`Aktionen für den Entwurf in „${title}“`}
      actions={[
        { label: 'Löschen', icon: 'delete', tone: 'danger', onSelect: () => setDeleting(key) },
      ]}
    />
  );
  return (
    <>
      {view === 'tiles' ? (
        // As the agents' cards: as many side by side as fit, each as high as the next.
        <ul aria-label="Entwürfe" className={AGENT_GRID}>
          {entries.map(({ key, place, name: title, draft }) => (
            <li
              key={key}
              className="group glass relative flex h-[148px] flex-col gap-2 rounded-panel p-4 transition-colors hover:bg-glass-hover has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus"
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center">
                  <PlaceMark place={place} />
                </span>
                <Link
                  to={pathOf(place)}
                  className="min-w-0 flex-1 truncate text-body font-medium text-fg outline-none after:absolute after:inset-0 after:rounded-panel"
                >
                  {title}
                </Link>
                <span className="relative -mt-1.5 -mr-1 flex h-8 items-center">
                  {menuOf(key, title)}
                </span>
              </div>
              <p title={draft.text} className="line-clamp-3 text-xs leading-[17px] text-fg-muted">
                {summary(draft)}
              </p>
              <span className="mt-auto text-xs text-fg-subtle">{formatRelativeTime(draft.at)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <RowList variant="hover" aria-label="Entwürfe">
          {entries.map(({ key, place, name: title, draft }) => (
            <ListRow
              key={key}
              variant="hover"
              padding="wide"
              className="relative"
              leading={
                <span className="flex size-[18px] shrink-0 items-center justify-center">
                  <PlaceMark place={place} />
                </span>
              }
              title={
                // The whole row opens the conversation; the menu stands above that.
                <Link
                  to={pathOf(place)}
                  className="outline-none after:absolute after:inset-0 after:rounded-control focus-visible:after:ring-2 focus-visible:after:ring-focus"
                >
                  {title}
                </Link>
              }
              subtitle={summary(draft)}
              subtitleTitle={draft.text}
              trailing={
                <span className="relative flex items-center gap-2">
                  <span className="text-xs text-fg-subtle">{formatRelativeTime(draft.at)}</span>
                  {menuOf(key, title)}
                </span>
              }
            />
          ))}
        </RowList>
      )}
      {deleting && (
        <ConfirmDialog
          onClose={() => setDeleting(null)}
          title="Entwurf löschen?"
          description={`Was du in „${name(deleting)}“ geschrieben hast, ist dann weg.`}
          confirmLabel="Löschen"
          confirmIcon="delete"
          onConfirm={() => {
            dropDraft(deleting);
            setDeleting(null);
            ui.notify('Entwurf gelöscht');
          }}
        />
      )}
    </>
  );
}
