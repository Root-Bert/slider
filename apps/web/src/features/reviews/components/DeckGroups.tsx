import type { Deck, Workspace } from '@slider/shared';
import type { ShowToast } from '@/ui';
import { WorkspaceMark } from '@/features/workspaces/components/WorkspaceMark';
import { ROLE_LABELS } from '@/features/workspaces/lib/roles';
import { DeckCollection, type DeckView } from './DeckCollection';

interface DeckGroupsProps {
  decks: readonly Deck[];
  workspaces: readonly Workspace[];
  view: DeckView;
  isUnseen: (deck: Deck) => boolean;
  onNotify: ShowToast;
}

/** Tab "Geteilt": decks from several organisations, one section each, in switcher order. */
export function DeckGroups({ decks, workspaces, view, isUnseen, onNotify }: DeckGroupsProps) {
  const groups = workspaces
    .map((workspace) => ({
      workspace,
      decks: decks.filter((deck) => deck.workspaceId === workspace.id),
    }))
    .filter((group) => group.decks.length > 0);

  return (
    <div className="flex flex-col gap-10">
      {groups.map(({ workspace, decks: groupDecks }) => (
        <section key={workspace.id} aria-label={workspace.name} className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-[15px] font-medium text-fg">
            <WorkspaceMark name={workspace.name} />
            <span className="truncate">{workspace.name}</span>
            <span className="text-xs font-normal text-fg-subtle">
              {ROLE_LABELS[workspace.role]}
            </span>
          </h2>
          <DeckCollection decks={groupDecks} view={view} isUnseen={isUnseen} onNotify={onNotify} />
        </section>
      ))}
    </div>
  );
}
