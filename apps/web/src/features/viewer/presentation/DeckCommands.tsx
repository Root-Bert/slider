import { usePageCommands } from '@/features/commands';
import type { MenuAction } from '@/ui';
import { useEditing } from '../editing/editing-context';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch } from '../state/viewer-state';
import { presentActions } from './lib/presentation';

/**
 * ⌘K: what the deck pill offers – „Präsentieren“, „Referentenansicht“ (its right-click menu) and,
 * for whoever can edit, „Exportieren“ – lent to the command panel while the presentation is
 * shown (not presenting, not on the material page), as the desktop app's tab bar gets them.
 */
export function DeckCommands({
  active,
  onPresent,
  onPresenterView,
}: {
  active: boolean;
  onPresent: () => void;
  onPresenterView: () => void;
}) {
  const { deck } = useViewerData();
  const share = useEditing().available;
  const dispatch = useViewerDispatch();
  const actions: MenuAction[] = [
    ...presentActions(onPresent, onPresenterView),
    ...(share
      ? [
          {
            label: 'Exportieren',
            icon: 'iosShare',
            onSelect: () => dispatch({ type: 'sharePanelSet', open: true }),
          } satisfies MenuAction,
        ]
      : []),
  ];
  usePageCommands({ group: 'Präsentation', actions, workspaceId: deck.workspaceId }, active);
  return null;
}
