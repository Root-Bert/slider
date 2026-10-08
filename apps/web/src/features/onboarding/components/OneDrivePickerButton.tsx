import { MicrosoftMark } from '@/features/auth/components/MicrosoftMark';
import { Button } from '@/ui';

/** Opens Microsoft's file picker – own OneDrive files, recent ones, shared ones and SharePoint. */
export function OneDrivePickerButton({
  onOpen,
  pending,
  error,
}: {
  onOpen: () => void;
  pending: boolean;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Button variant="secondary" size="lg" loading={pending} onClick={onOpen} className="w-full">
        {!pending && <MicrosoftMark size={16} />}
        Aus OneDrive oder SharePoint auswählen
      </Button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
