import { Button, ErrorText, GoogleMark } from '@/ui';

/**
 * "Aus Google Drive wählen": leaves for Google's own picker page (BER-158) and comes back with
 * the picked presentation – unlike OneDrive and Nextcloud, it does not open up in the page.
 */
export function GoogleDriveButton({
  onOpen,
  pending,
  error,
  label = 'Aus Google Drive wählen',
}: {
  onOpen: () => void;
  /** Leaving for Google, or importing the picked file. */
  pending: boolean;
  error: string | null;
  /** Shorter next to two other sources. */
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" size="lg" loading={pending} onClick={onOpen} className="w-full">
        {!pending && <GoogleMark size={16} />}
        {label}
      </Button>
      {error && (
        <ErrorText role="alert" size="xs">
          {error}
        </ErrorText>
      )}
    </div>
  );
}
