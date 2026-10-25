import { useRef } from 'react';
import { cn, Toast, Toolbar, ToolbarDivider, useFullscreen, useToast } from '@/ui';
import { CommentFilterBar } from './comments/CommentFilterBar';
import { Composer } from './comments/Composer';
import { MediaReplyDialog } from './comments/MediaTabs';
import { ThreadPanel } from './comments/ThreadPanel';
import { LeaveGuard } from './components/LeaveGuard';
import { SkipToControls } from './components/SkipToControls';
import { MinimapToggle } from './controls/MinimapToggle';
import { ParticipantAvatars } from './controls/ParticipantAvatars';
import { RevisionControls, UploadRevisionControl } from './controls/RevisionControls';
import { SessionControls } from './controls/SessionControls';
import { SlideCounter } from './controls/SlideCounter';
import { ToolBar } from './controls/ToolBar';
import { WideFramesToggle } from './controls/WideFramesToggle';
import { useThreadHover } from './hooks/useThreadHover';
import { useSlideUrlSync } from './hooks/useSlideUrlSync';
import { useViewerShortcuts } from './hooks/useViewerShortcuts';
import { CursorLayer } from './live/CursorLayer';
import { useLive } from './live/hooks/useLive';
import { DeletedSlidesPanel } from './revisions/DeletedSlidesPanel';
import { SyncStatus } from './revisions/SyncStatus';
import { useViewerData } from './state/viewer-data';
import { useViewerState } from './state/viewer-state';
import { ViewerToastContext } from './state/viewer-toast';
import { Timeline } from './timeline/Timeline';

/** The controls row (tool bar, filter, deck controls): where the skip link leads. */
const CONTROLS_ID = 'viewer-controls';

/**
 * Layout of the review viewer: the deck as a timeline (all slides side by side, every slide's
 * comments in a column below it), the controls row with the tool bar in between (session controls sit
 * right of the slide counter), and the floating participants, composer and thread panel. Composition only –
 * behaviour lives in the hooks and the components. The root is the fullscreen target, so
 * floating controls and panels stay visible in fullscreen.
 */
export function Viewer() {
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
  useThreadHover();
  useLive();

  return (
    <ViewerToastContext value={showToast}>
      <div
        ref={rootRef}
        data-viewer-root
        className={cn('dot-grid relative flex h-dvh flex-col overflow-hidden text-fg')}
      >
        {/* The first focus stop: keyboard users skip the slides to the controls row. */}
        <SkipToControls targetId={CONTROLS_ID} />
        <h1 className="sr-only">{deck.title}</h1>
        <Timeline
          controls={
            // On desktop this row never wraps – its height is part of where the comment area
            // starts, which must not move when a side panel narrows the controls band: the slide
            // counter gives way (container query on the band width), the filter pill scrolls.
            <div id={CONTROLS_ID} className="flex flex-wrap items-center gap-3 md:flex-nowrap">
              <ToolBar />
              <CommentFilterBar />
              <SyncStatus />
              {/* Figma 87:359: right-aligned, 10px apart. */}
              <div className="ml-auto flex shrink-0 items-center gap-2.5">
                <RevisionControls />
                {/* One pill for the deck, like the tool bar – a lone icon button in its own
                    glass pill would read as a circle next to the wide ones. */}
                <Toolbar role={false} className="shrink-0">
                  <UploadRevisionControl />
                  <MinimapToggle />
                  <WideFramesToggle />
                  <ToolbarDivider />
                  {/* Gives way on a narrow band, with its divider. */}
                  <span className="flex items-center gap-1 md:@max-[740px]:hidden">
                    <SlideCounter />
                    <ToolbarDivider />
                  </span>
                  <SessionControls />
                </Toolbar>
              </div>
            </div>
          }
        />

        {/* Bottom right: who else is here, then you – hover for the name, click to pick a colour. Moves left of the side panel when that opens. */}
        <div
          className={cn(
            'fixed right-4 bottom-4 z-(--z-chrome) transition-[right] duration-300 md:right-6 md:bottom-6',
            threadPanelOpen && 'max-md:hidden md:right-[424px]',
          )}
        >
          <ParticipantAvatars />
        </div>

        {/* Other people's pointers (BER-104): above the track, below the floating controls. */}
        <CursorLayer />

        <Composer />
        <ThreadPanel />
        <MediaReplyDialog />
        <DeletedSlidesPanel />
        <LeaveGuard />
        {/* Above the thread panel and popovers (`--z-toast`). */}
        <Toast toast={toast} />
      </div>
    </ViewerToastContext>
  );
}
