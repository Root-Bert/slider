import { useRef } from 'react';
import { AvatarStack, cn, Toast, useToast } from '@/ui';
import { CommentFilterBar } from './comments/CommentFilterBar';
import { Composer } from './comments/Composer';
import { ThreadPanel } from './comments/ThreadPanel';
import { SessionControls } from './controls/SessionControls';
import { SlideCounter } from './controls/SlideCounter';
import { ToolDock } from './controls/ToolBar';
import { ViewControls } from './controls/ViewControls';
import { ZoomControl } from './controls/ZoomControl';
import { useFullscreen } from './hooks/useFullscreen';
import { useSlideUrlSync } from './hooks/useSlideUrlSync';
import { useViewerShortcuts } from './hooks/useViewerShortcuts';
import { useViewerData } from './state/viewer-data';
import { useViewerState } from './state/viewer-state';
import { ViewerToastContext } from './state/viewer-toast';
import { Timeline } from './timeline/Timeline';

/**
 * Layout of the review viewer: the deck as a timeline (all slides side by side, every slide's
 * comments in a column below it), the controls row in between, and the floating tool dock,
 * session controls, composer and thread panel. Composition only – behaviour lives in the hooks
 * and the components. The root is the fullscreen target, so floating controls and panels stay
 * visible in fullscreen.
 */
export function Viewer({ onLeave }: { onLeave: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { deck } = useViewerData();
  const { activeSlideId, threadPanelOpen } = useViewerState();
  const fullscreen = useFullscreen(rootRef);
  const [toast, showToast] = useToast();

  useViewerShortcuts({ onToggleFullscreen: fullscreen.toggle });
  useSlideUrlSync(activeSlideId);

  return (
    <ViewerToastContext value={showToast}>
      <div
        ref={rootRef}
        className={cn(
          'dot-grid relative flex h-dvh flex-col overflow-hidden text-fg transition-[padding] duration-300',
          threadPanelOpen && 'md:pr-[400px]',
        )}
      >
        <h1 className="sr-only">{deck.title}</h1>
        <Timeline
          controls={
            // Connector lines fade out behind this row. On desktop it never wraps – its height
            // is part of where the comment area starts, which must not move when the thread
            // panel narrows the timeline: the avatars, the slide counter and the zoom pill give
            // way (container queries on the timeline width), and the filter pill scrolls last.
            <div
              data-connector-occluder="controls"
              className="flex flex-wrap items-center gap-3 md:flex-nowrap"
            >
              <AvatarStack
                authors={deck.participants}
                size={32}
                max={6}
                className="shrink-0 md:@max-[900px]:hidden"
              />
              <CommentFilterBar />
              {/* Figma 87:359 / 87:369: right-aligned, 10px apart. */}
              <div className="ml-auto flex shrink-0 items-center gap-2.5">
                <SlideCounter className="md:@max-[740px]:hidden" />
                <ZoomControl />
                <ViewControls
                  isFullscreen={fullscreen.isFullscreen}
                  onToggleFullscreen={fullscreen.toggle}
                  fullscreenSupported={fullscreen.isSupported}
                />
              </div>
            </div>
          }
        />

        <div className="fixed bottom-4 left-4 z-30 md:bottom-6 md:left-6">
          <ToolDock />
        </div>
        <div
          className={cn(
            'fixed right-4 bottom-4 z-30 transition-[right] duration-300 md:right-6 md:bottom-6',
            threadPanelOpen && 'max-md:hidden md:right-[424px]',
          )}
        >
          <SessionControls onLeave={onLeave} />
        </div>

        <Composer />
        <ThreadPanel />
        {/* Above the thread panel (z-40). */}
        <Toast toast={toast} />
      </div>
    </ViewerToastContext>
  );
}
