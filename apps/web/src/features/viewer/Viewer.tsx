import { useRef } from 'react';
import { AvatarStack, cn, GlassPanel, Toast, useToast } from '@/ui';
import { CommentFilterBar } from './comments/CommentFilterBar';
import { Composer } from './comments/Composer';
import { ThreadPanel } from './comments/ThreadPanel';
import { RevisionControls } from './controls/RevisionControls';
import { SessionControls } from './controls/SessionControls';
import { SlideCounter } from './controls/SlideCounter';
import { ToolBar } from './controls/ToolBar';
import { useFullscreen } from './hooks/useFullscreen';
import { useSlideUrlSync } from './hooks/useSlideUrlSync';
import { useViewerShortcuts } from './hooks/useViewerShortcuts';
import { DeletedSlidesPanel } from './revisions/DeletedSlidesPanel';
import { RevisionBanners } from './revisions/RevisionBanners';
import { useViewerData } from './state/viewer-data';
import { useViewerState } from './state/viewer-state';
import { ViewerToastContext } from './state/viewer-toast';
import { Timeline } from './timeline/Timeline';

/**
 * Layout of the review viewer: the deck as a timeline (all slides side by side, every slide's
 * comments in a column below it), the controls row with the tool bar in between, and the
 * floating participants dock, session controls, composer and thread panel. Composition only –
 * behaviour lives in the hooks and the components. The root is the fullscreen target, so
 * floating controls and panels stay visible in fullscreen.
 */
export function Viewer({ onLeave }: { onLeave: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { deck } = useViewerData();
  const { activeSlideId, threadPanelOpen: threadOpen, deletedPanelOpen } = useViewerState();
  // Thread panel and deleted slides panel share the right side.
  const threadPanelOpen = threadOpen || deletedPanelOpen;
  const toggleFullscreen = useFullscreen(rootRef);
  const [toast, showToast] = useToast();

  // No button any more – F still toggles fullscreen (the hook is all it costs).
  useViewerShortcuts({ onToggleFullscreen: toggleFullscreen });
  useSlideUrlSync(activeSlideId);

  return (
    <ViewerToastContext value={showToast}>
      <div
        ref={rootRef}
        data-viewer-root
        className={cn(
          'dot-grid relative flex h-dvh flex-col overflow-hidden text-fg transition-[padding] duration-300',
          threadPanelOpen && 'md:pr-[400px]',
        )}
      >
        <h1 className="sr-only">{deck.title}</h1>
        {/* In the flow above the track: a banner shortens the track instead of covering it. */}
        <RevisionBanners />
        <Timeline
          controls={
            // On desktop this row never wraps – its height is part of where the comment area
            // starts, which must not move when the thread panel narrows the timeline: the slide
            // counter gives way (container query on the timeline width), the filter pill scrolls.
            <div className="flex flex-wrap items-center gap-3 md:flex-nowrap">
              <ToolBar />
              <CommentFilterBar />
              {/* Figma 87:359: right-aligned, 10px apart. */}
              <div className="ml-auto flex shrink-0 items-center gap-2.5">
                <RevisionControls />
                <SlideCounter className="md:@max-[740px]:hidden" />
              </div>
            </div>
          }
        />

        {/* Bottom left: close and share (owners) or leave (guests). */}
        <div
          className={cn(
            'fixed bottom-4 left-4 z-30 md:bottom-6 md:left-6',
            threadPanelOpen && 'max-md:hidden',
          )}
        >
          <SessionControls onLeave={onLeave} />
        </div>
        {/* Bottom right: who else is here – moves left of the side panel when that opens. */}
        {deck.participants.length > 0 && (
          <div
            className={cn(
              'fixed right-4 bottom-4 z-30 transition-[right] duration-300 md:right-6 md:bottom-6',
              threadPanelOpen && 'max-md:hidden md:right-[424px]',
            )}
          >
            <GlassPanel
              role="group"
              aria-label="Teilnehmende"
              className="flex h-14 items-center px-3"
            >
              <AvatarStack authors={deck.participants} size={32} max={6} />
            </GlassPanel>
          </div>
        )}

        <Composer />
        <ThreadPanel />
        <DeletedSlidesPanel />
        {/* Above the thread panel (z-40). */}
        <Toast toast={toast} />
      </div>
    </ViewerToastContext>
  );
}
