import type { Ref } from 'react';
import { cn, MicrosoftMark, Spinner } from '@/ui';
import { PickerPanel } from './PickerPanel';

/** Name the picker form targets; one picker at a time. */
const PICKER_FRAME_NAME = 'slider-onedrive-picker';

/**
 * "Aus OneDrive / SharePoint wählen": the button opens up into Microsoft's file picker,
 * right in the page (`PickerPanel`). The picker draws its own list, search and
 * "Öffnen"/"Abbrechen".
 */
export function OneDrivePicker({
  open,
  ready,
  onOpen,
  onClose,
  frameRef,
  pending,
  error,
  onShownChange,
  label = 'Aus OneDrive / SharePoint wählen',
}: {
  open: boolean;
  /** The picker page has loaded – until then a spinner stands in for the frame. */
  ready: boolean;
  onOpen: () => void;
  onClose: () => void;
  frameRef: Ref<HTMLIFrameElement>;
  /** The picked file is being imported. */
  pending: boolean;
  error: string | null;
  /** The panel is on the page (open, or still shrinking back). */
  onShownChange?: (shown: boolean) => void;
  /** Shorter next to two other sources. */
  label?: string;
}) {
  return (
    <PickerPanel
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      label={label}
      mark={<MicrosoftMark size={16} />}
      pending={pending}
      error={error}
      onShownChange={onShownChange}
    >
      {(expanded) => (
        <>
          <iframe
            ref={frameRef}
            name={PICKER_FRAME_NAME}
            title="OneDrive-Dateiauswahl"
            className={cn(
              'size-full transition-opacity duration-300',
              ready ? 'opacity-100' : 'opacity-0',
            )}
          />
          {!ready && expanded && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-fg-subtle">
              <Spinner size="xl" />
              <p className="text-xs">OneDrive wird geladen …</p>
            </div>
          )}
        </>
      )}
    </PickerPanel>
  );
}
