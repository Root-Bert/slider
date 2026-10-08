import { MicrosoftMark } from '@/features/auth/components/MicrosoftMark';
import { Button } from '@/ui';

/** Opens Microsoft's OneDrive file picker – own files, recent ones and those shared with me. */
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
    <div className="flex flex-col items-center gap-2">
      <Button variant="secondary" loading={pending} onClick={onOpen}>
        {!pending && <MicrosoftMark size={16} />}
        Aus OneDrive auswählen
      </Button>
      {error && (
        <p role="alert" className="max-w-[420px] text-center text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
