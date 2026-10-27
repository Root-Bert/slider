import { editedFileUrl } from '@/lib/api';
import { IconButton } from '@/ui';
import { useViewerData } from '../state/viewer-data';
import { useEditing } from './editing-context';

/**
 * Button in the deck pill, right of „Präsentieren“: downloads the file as it is now, edits
 * included – whenever the deck can be edited, not only while editing.
 */
export function DownloadButton() {
  const editing = useEditing();
  const { deck } = useViewerData();
  if (!editing.available) return null;
  return (
    <IconButton
      icon="download"
      label="Herunterladen (.odp)"
      size="sm"
      onClick={() => window.location.assign(editedFileUrl(deck.id))}
    />
  );
}
