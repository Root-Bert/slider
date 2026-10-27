import { IconButton } from '@/ui';

/** Button in the deck pill: starts the slide show on the active slide (also P). */
export function PresentButton({ onPresent }: { onPresent: () => void }) {
  return (
    <IconButton
      icon="slideshow"
      label="Präsentieren"
      title="Präsentieren (P)"
      size="sm"
      onClick={onPresent}
    />
  );
}
