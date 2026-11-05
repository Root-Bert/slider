import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { EditingProvider } from '../editing/EditingProvider';
import { useViewerData } from '../state/viewer-data';
import { useViewerState } from '../state/viewer-state';
import { AUDIENCE_PARAM } from './lib/show-sync';
import { PresentationMode } from './PresentationMode';
import { useShowChannel } from './show-hooks';

/**
 * The audience's window: the slide show alone (no timeline, comments or tools), following the
 * presenter view in the other window and leading it when stepped here. Ended (here or there), the
 * window closes; one opened by hand, which a page cannot close, turns into the viewer.
 */
export function AudienceShow() {
  const { activeSlideId } = useViewerState();
  const { deck } = useViewerData();
  const [, setSearchParams] = useSearchParams();
  const { post } = useShowChannel(deck.id);
  // Closed by its window's own button: the presenter view can open it again.
  useEffect(() => {
    const gone = () => post({ type: 'gone' });
    window.addEventListener('pagehide', gone);
    return () => window.removeEventListener('pagehide', gone);
  }, [post]);

  const ended = () => {
    window.close();
    setSearchParams(
      (params) => {
        params.delete(AUDIENCE_PARAM);
        return params;
      },
      { replace: true },
    );
  };
  return (
    <EditingProvider>
      <PresentationMode audience startSlideId={activeSlideId} onExit={ended} />
    </EditingProvider>
  );
}
