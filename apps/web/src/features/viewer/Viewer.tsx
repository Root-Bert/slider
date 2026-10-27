import { useRef, useState } from 'react';
import { cn, Toast, Toolbar, ToolbarDivider, useFullscreen, useToast } from '@/ui';
import { CommentFilterBar } from './comments/CommentFilterBar';
import { Composer } from './comments/Composer';
import { MediaReplyDialog } from './comments/MediaTabs';
import { useThreadZoom } from './comments/hooks/useThreadZoom';
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
import { FindBar } from './find/FindBar';
import { useGoToSlide } from './hooks/useGoToSlide';
import { useThreadHover } from './hooks/useThreadHover';
import { useSlideUrlSync } from './hooks/useSlideUrlSync';
import { useViewerShortcuts } from './hooks/useViewerShortcuts';
import { CursorLayer } from './live/CursorLayer';
import { useLive } from './live/hooks/useLive';
import { PresentButton } from './presentation/PresentButton';
import { PresentationMode } from './presentation/PresentationMode';
import { DownloadButton } from './editing/DownloadButton';
import { EditingProvider } from './editing/EditingProvider';
import { FormatBar } from './editing/FormatBar';
import { LayersPanel } from './editing/layers/LayersPanel';
import { LayersProvider } from './editing/layers/LayersProvider';
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
  const { deck, slideIndex } = useViewerData();
  const {
    activeSlideId,
    threadPanelOpen: threadOpen,
    deletedPanelOpen,
    layersPanelOpen,
  } = useViewerState();
  // Thread panel, deleted slides and layers share the right side.
  const threadPanelOpen = threadOpen || deletedPanelOpen || layersPanelOpen;
  const toggleFullscreen = useFullscreen(rootRef);
  const [toast, showToast] = useToast();
  // Where the find bar docks: the split handle's spot (desktop), `null` on a phone.
  const [findSlot, setFindSlot] = useState<HTMLElement | null>(null);

  // The slide show (P, or the button in the deck pill): over everything, back on its last slide.
  const [presenting, setPresenting] = useState(false);
  const goTo = useGoToSlide();
  const startPresenting = () => setPresenting(true);
  const stopPresenting = (slideId: string | null) => {
    setPresenting(false);
    const index = slideId ? slideIndex.get(slideId) : undefined;
    if (index !== undefined) goTo(index);
  };

  // No button any more – F still toggles fullscreen (the hook is all it costs).
  useViewerShortcuts({ onToggleFullscreen: toggleFullscreen, onPresent: startPresenting });
  useSlideUrlSync(activeSlideId);
  useThreadHover();
  useThreadZoom();
  useLive();

  return (
    <ViewerToastContext value={showToast}>
      <EditingProvider>
        <LayersProvider>
          <div
            ref={rootRef}
            data-viewer-root
            className={cn('dot-grid relative flex h-dvh flex-col overflow-hidden text-fg')}
          >
            {/* The first focus stop: keyboard users skip the slides to the controls row. */}
            <SkipToControls targetId={CONTROLS_ID} />
            <h1 className="sr-only">{deck.title}</h1>
            <Timeline
              findSlotRef={setFindSlot}
              controls={
                // On desktop this row never wraps – its height is part of where the comment area
                // starts, which must not move when a side panel narrows the controls band: the slide
                // counter gives way (container query on the band width).
                <div id={CONTROLS_ID} className="flex flex-wrap items-center gap-3 md:flex-nowrap">
                  <ToolBar />
                  <SyncStatus />
                  {/* Figma 87:359: right-aligned, 10px apart. */}
                  <div className="ml-auto flex shrink-0 items-center gap-2.5">
                    <CommentFilterBar />
                    <RevisionControls />
                    {/* One pill for the deck, like the tool bar – a lone icon button in its own
                    glass pill would read as a circle next to the wide ones. */}
                    <Toolbar role={false} className="shrink-0">
                      <UploadRevisionControl />
                      <MinimapToggle />
                      <WideFramesToggle />
                      <PresentButton onPresent={startPresenting} />
                      <DownloadButton />
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
            <AvatarDock panelOpen={threadPanelOpen} />

            {/* Other people's pointers (BER-104): above the track, below the floating controls. */}
            <CursorLayer />

            <Composer />
            <ThreadPanel />
            <MediaReplyDialog />
            <DeletedSlidesPanel />
            <FormatBar />
            {/* „Ebenen“ (L): the active slide's layers; the slide itself turns 3D on the track. */}
            <LayersPanel />
            {/* ⌘F / Ctrl F (BER-176). Docked at the split handle, morphing out of it; on a phone
            after the panels: above the bottom sheet. */}
            <FindBar slot={findSlot} />
            <LeaveGuard />
            {/* Above the thread panel and popovers (`--z-toast`). */}
            <Toast toast={toast} />
            {presenting && (
              <PresentationMode startSlideId={activeSlideId} onExit={stopPresenting} />
            )}
          </div>
        </LayersProvider>
      </EditingProvider>
    </ViewerToastContext>
  );
}

/** The participants, left of a side panel (thread, deleted slides) while one is open. */
function AvatarDock({ panelOpen: open }: { panelOpen: boolean }) {
  return (
    <div
      className={cn(
        'fixed right-4 bottom-4 z-(--z-chrome) transition-[right] duration-300 md:right-6 md:bottom-6',
        open && 'max-md:hidden md:right-[424px]',
      )}
    >
      <ParticipantAvatars />
    </div>
  );
}
