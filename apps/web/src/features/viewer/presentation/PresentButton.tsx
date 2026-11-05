import { useCallback, useState, type MouseEvent } from 'react';
import { ContextMenu, IconButton } from '@/ui';
import { presenterShortcut } from './lib/presentation';

/**
 * Button in the deck pill: starts the slide show on the active slide (also P). A right click (a
 * long press, the menu key) chooses what shows: the slide show or „Referentenansicht“ – the
 * presenter view with the next slide and the notes (also ⌥P). A left click always starts the slide
 * show: it never depends on what was picked before.
 */
export function PresentButton({
  onPresent,
  onPresenterView,
}: {
  onPresent: () => void;
  onPresenterView: () => void;
}) {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setMenuAt(null), []);
  const onContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    // The menu key has no pointer: under the button.
    const box = event.currentTarget.getBoundingClientRect();
    const fromKey = event.clientX === 0 && event.clientY === 0;
    setMenuAt(
      fromKey ? { x: box.left, y: box.bottom + 4 } : { x: event.clientX, y: event.clientY },
    );
  };
  return (
    <>
      <IconButton
        icon="slideshow"
        label="Präsentieren"
        title={`Präsentieren (P)\nRechtsklick: Referentenansicht (${presenterShortcut()})`}
        size="sm"
        onClick={onPresent}
        onContextMenu={onContextMenu}
      />
      {menuAt && (
        <ContextMenu
          label="Präsentieren"
          at={menuAt}
          onClose={close}
          actions={[
            { label: 'Präsentieren', icon: 'slideshow', onSelect: onPresent },
            { label: 'Referentenansicht', icon: 'notes', onSelect: onPresenterView },
          ]}
        />
      )}
    </>
  );
}
