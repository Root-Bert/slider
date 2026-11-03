import { Icon, ToolbarDivider, Tooltip } from '@/ui';
import { useEditing } from './editing-context';

/**
 * The tool bar's waiting edits. Saving itself shows nothing. Undo and redo are ⌘Z and ⇧⌘Z; the
 * download sits in the deck pill. The deck lives in Slider: nothing is written back to its
 * source. With the server out of reach – or the session ended – it says so, and how many edits
 * wait in the browser to be sent: shown while reviewing too, they are not saved yet.
 */
export function EditActions() {
  const editing = useEditing();
  if ((editing.offline || editing.signedOut) && editing.pending > 0) {
    const waiting =
      editing.pending === 1 ? 'Eine Änderung wartet' : `${editing.pending} Änderungen warten`;
    // Offline first: signed in again, they would still wait for the server.
    const [state, until, icon] = editing.offline
      ? (['Offline', 'der Server wieder erreichbar ist', 'cloud'] as const)
      : (['Abgemeldet', 'dasselbe Konto wieder angemeldet ist', 'logout'] as const);
    return (
      <>
        <ToolbarDivider />
        <Tooltip
          align="end"
          maxWidth={64}
          className="shrink-0"
          label={
            <>
              <span className="block">
                {state} – {waiting}.
              </span>
              <span className="block text-fg-subtle">
                Sie bleiben in diesem Browser und werden gespeichert, sobald {until}.
              </span>
            </>
          }
        >
          <span
            role="status"
            tabIndex={0}
            aria-label={`${state} – ${waiting}`}
            className="flex h-8 items-center gap-1.5 rounded-control px-2 text-sm text-fg-subtle"
          >
            <Icon name={icon} size={16} />
            {editing.pending}
          </span>
        </Tooltip>
      </>
    );
  }
  return null;
}
