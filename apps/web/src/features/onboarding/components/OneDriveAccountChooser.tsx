import type { MicrosoftConnection } from '@slider/shared';
import { Button, Dialog, IconTile, ListRow, MicrosoftMark, RowList } from '@/ui';

/**
 * Before the OneDrive picker opens, with several Microsoft accounts connected: which account's
 * OneDrive and SharePoint to browse. The picker and the import then run with that account.
 */
export function OneDriveAccountChooser({
  open,
  accounts,
  onChoose,
  onClose,
}: {
  open: boolean;
  accounts: readonly MicrosoftConnection[];
  onChoose: (account: MicrosoftConnection) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Welches Microsoft-Konto?"
      description="Wähle das Konto, in dessen OneDrive oder SharePoint die PowerPoint liegt."
    >
      <RowList>
        {accounts.map((account) => {
          const label = account.account ?? 'Microsoft-Konto';
          return (
            <ListRow
              key={account.id}
              leading={
                <IconTile tone="inherit">
                  <MicrosoftMark size={18} />
                </IconTile>
              }
              title={label}
              trailing={
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`${label} auswählen`}
                  onClick={() => onChoose(account)}
                >
                  Auswählen
                </Button>
              }
            />
          );
        })}
      </RowList>
    </Dialog>
  );
}
