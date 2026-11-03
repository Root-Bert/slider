import { useEffect, useRef, useState } from 'react';
import { ctrlClickIsClick } from '@/lib/dom';
import { cn, Toast, Toolbar, ToolbarDivider, useFullscreen, useToast } from '@/ui';
import { CommentFilterBar } from './comments/CommentFilterBar';
import { Composer } from './comments/Composer';
import { MediaReplyDialog } from './comments/MediaTabs';
import { useAskAiShortcut } from './comments/hooks/useAskAiShortcut';
import { useThreadZoom } from './comments/hooks/useThreadZoom';
import { ThreadPanel } from './comments/ThreadPanel';
import { LeaveGuard } from './components/LeaveGuard';
import { SkipToControls } from './components/SkipToControls';
import { MinimapToggle } from './controls/MinimapToggle';
import { ParticipantAvatars } from './controls/ParticipantAvatars';
import { RevisionControls } from './controls/RevisionControls';
import { ShareButton } from './share/ShareButton';
import { SharePanel } from './share/SharePanel';
import { SessionControls } from './controls/SessionControls';
import { SlideCounter } from './controls/SlideCounter';
import { ToolBar } from './controls/ToolBar';
import { WideFramesToggle } from './controls/WideFramesToggle';
import { FindBar } from './find/FindBar';
import { HandleHint } from './hint/HandleHint';
import { useGoToSlide } from './hooks/useGoToSlide';
import { useThreadHover } from './hooks/useThreadHover';
import { useSlideUrlSync } from './hooks/useSlideUrlSync';
import { useViewerShortcuts } from './hooks/useViewerShortcuts';
import { CursorLayer } from './live/CursorLayer';
import { useLive } from './live/hooks/useLive';
import { PresentButton } from './presentation/PresentButton';
import { PresentationMode } from './presentation/PresentationMode';
import { EditingProvider } from './editing/EditingProvider';
import { FillRefresh } from './editing/fills/FillRefresh';
import { TiltRefreshes } from './editing/tilt/TiltRefreshes';
import { FormatBar } from './editing/FormatBar';
import { LayersPanel } from './editing/layers/LayersPanel';
import { SlideBackgroundPanel } from './editing/SlideBackgroundPanel';
import { LayersProvider } from './editing/layers/LayersProvider';
import { DeletedSlidesPanel } from './revisions/DeletedSlidesPanel';
import { SyncStatus } from './revisions/SyncStatus';
import { useViewerData } from './state/viewer-data';
import { isSidePanelOpen, useViewerState } from './state/viewer-state';
import { ViewerToastContext } from './state/viewer-toast';
import { useCommentRefusals } from './comments/hooks/useCommentRefusals';
import { Timeline } from './timeline/Timeline';
import { LayoutGridPanel } from './template/LayoutGridPanel';
import { VoiceBar } from './voice/VoiceBar';
import { VoiceProvider } from './voice/VoiceProvider';
import { TemplateControls } from './template/TemplateControls';

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
  const viewerState = useViewerState();
  const { activeSlideId, commentsClosed } = viewerState;
  // Thread panel, deleted slides, layers, a slide's background and the layout share the right side.
  const threadPanelOpen = isSidePanelOpen(viewerState);
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
  useLive();
  useCommentRefusals(showToast);
  // On the slides (picking elements, multi-select), ctrl+click on a Mac is a click, not a right
  // click; fields and comments' marks keep their menus, as does everything else on the page.
  useEffect(
    () => ctrlClickIsClick((target) => !!target.closest('[data-track]'), '[data-mark]'),
    [],
  );

  return (
    <ViewerToastContext value={showToast}>
      <EditingProvider>
        <LayersProvider>
          <VoiceProvider>
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
                  <div
                    id={CONTROLS_ID}
                    className="flex flex-wrap items-center gap-3 md:flex-nowrap"
                  >
                    <ToolBar />
                    {/* A template being designed: its name, its layout's, guides and saving. */}
                    <TemplateControls />
                    <SyncStatus />
                    {/* Figma 87:359: right-aligned, 10px apart. */}
                    <div
                      data-controls-cluster
                      className="ml-auto flex shrink-0 items-center gap-2.5"
                    >
                      <CommentFilterBar />
                      <RevisionControls />
                      {/* One pill for the deck, like the tool bar – a lone icon button in its own
                    glass pill would read as a circle next to the wide ones. */}
                      <Toolbar role={false} className="shrink-0">
                        <MinimapToggle />
                        <WideFramesToggle />
                        <PresentButton onPresent={startPresenting} />
                        <ShareButton />
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

              {/* Bottom right: who else is here, then you – hover for the name, click to pick a colour. Moves left of the side panel when that opens; gone while the comment area is closed. */}
              {!commentsClosed && <AvatarDock panelOpen={threadPanelOpen} />}

              {/* Other people's pointers (BER-104): above the track, below the floating controls. */}
              <CursorLayer />

              <Composer />
              <AskAiShortcut />
              <ThreadZoom />
              <ThreadPanel />
              <MediaReplyDialog />
              <DeletedSlidesPanel />
              <FormatBar />
              {/* Tilted elements changed: drawn tilted anew, picked or not. */}
              <TiltRefreshes />
              <FillRefresh />
              {/* „Ebenen“ (L): the active slide's layers; the slide itself turns 3D on the track. */}
              <LayersPanel />
              {/* „Hintergrund“ from a slide's right-click menu. */}
              <SlideBackgroundPanel />
              {/* „Layout-Ansicht“ of a template (⇧H): its columns and rows. */}
              <LayoutGridPanel />
              {/* „Exportieren“ (S): the file (a template's as OTP) and a PDF. */}
              <SharePanel />
              {/* ⌘F / Ctrl F (BER-176). Docked at the split handle, morphing out of it; on a phone
            after the panels: above the bottom sheet. */}
              <FindBar slot={findSlot} />
              {/* Speaking to the AI (a click on its avatar): what it heard and made of it, out of
            the split handle like the find bar. */}
              <VoiceBar slot={findSlot} />
              <HandleHint slot={findSlot} />
              <LeaveGuard />
              {/* Above the thread panel and popovers (`--z-toast`). */}
              <Toast toast={toast} />
              {presenting && (
                <PresentationMode startSlideId={activeSlideId} onExit={stopPresenting} />
              )}
            </div>
          </VoiceProvider>
        </LayersProvider>
      </EditingProvider>
    </ViewerToastContext>
  );
}

/** ⌘↵ on the selected thread – inside the editing context the AI needs. */
function AskAiShortcut() {
  useAskAiShortcut();
  return null;
}

/** Zooming in on an opened thread's mark – inside the editing context, for the layers view. */
function ThreadZoom() {
  useThreadZoom();
  return null;
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
