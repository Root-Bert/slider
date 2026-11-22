import { useState } from 'react';
import { Link } from 'react-router';
import { AgentAvatar } from '@/features/cloud';
import { dropDraft, type Draft } from '@/lib/drafts';
import { formatRelativeTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import { ConfirmDialog, EmptyState, Icon, ListRow, Menu, RowList } from '@/ui';
import { useSender } from '../hooks/useSender';
import { useWorkspaceDrafts, type DraftPlace } from '../hooks/useWorkspaceDrafts';
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

/** A draft's words in one line – a new mail without any yet: to whom it goes. */
const summary = (draft: Draft) =>
  draft.text.replace(/\s+/g, ' ').trim() ||
  (draft.target?.kind === 'mail-new' && draft.target.to.trim()
    ? `An ${draft.target.to.trim()}`
    : '');

/**
 * „Entwürfe“: what was written and not sent – in a conversation (areas, groups, people), to an
 * agent, as a mail's answer or a new mail, as a new agent's order (an area's too) – in one list,
 * the same on every device. A click goes on writing there; „Löschen“ throws a draft away.
 */
export function DraftList() {
  const ui = useSender();
  const entries = useWorkspaceDrafts();
  const [deleting, setDeleting] = useState<string | null>(null);
  if (!ui.home) return null;
  if (entries.length === 0) {
    return (
      <div className="m-auto py-16">
        <EmptyState
          title="Keine Entwürfe"
          message="Was du in einem Chat, an einen Agenten oder als Mail schreibst und nicht abschickst, steht hier."
        />
      </div>
    );
  }
  const name = (key: string) => entries.find((each) => each.key === key)?.name ?? '';
  const pathOf = (place: DraftPlace) => {
    if (place.kind === 'conversation') return ui.pathOf(place.channel);
    if (place.kind === 'mail') return ui.mailThreadPath(place.threadId);
    if (place.kind === 'agent-new')
      return place.areaId
        ? routes.cloudAreaAgents(ui.workspace.id, place.areaId)
        : ui.newPath('agent');
    if (place.kind === 'mail-new') return ui.mailThreadPath(NEW_MAIL);
    const path = ui.agentPath(place.agentId);
    return place.chatId === place.agentId
      ? path
      : `${path}?chat=${encodeURIComponent(place.chatId)}`;
  };
  return (
    <>
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
                <Menu
                  label={`Aktionen für den Entwurf in „${title}“`}
                  actions={[
                    {
                      label: 'Löschen',
                      icon: 'delete',
                      tone: 'danger',
                      onSelect: () => setDeleting(key),
                    },
                  ]}
                />
              </span>
            }
          />
        ))}
      </RowList>
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
