import { IconButton } from '@/ui';
import { useEditing } from '../editing/editing-context';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';

/**
 * Button in the deck pill, right of „Präsentieren“: opens „Exportieren“ (S) in the side panel –
 * the deck's file (a template's as `.otp`) and a PDF. Only for whoever can edit the deck.
 */
export function ShareButton() {
  const { sharePanelOpen } = useViewerState();
  const dispatch = useViewerDispatch();
  if (!useEditing().available) return null;
  return (
    <IconButton
      icon="iosShare"
      label="Exportieren"
      title="Exportieren (S)"
      size="sm"
      expanded={sharePanelOpen}
      onClick={() => dispatch({ type: 'sharePanelSet', open: !sharePanelOpen })}
    />
  );
}
