import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { AvatarStack, cn, Toast, useToast } from '@/ui';
import { CommentBoard } from './comments/CommentBoard';
import { CommentFilterBar } from './comments/CommentFilterBar';
import { Composer } from './comments/Composer';
import { ConnectorLines } from './comments/ConnectorLines';
import { ThreadPanel } from './comments/ThreadPanel';
import { SessionControls } from './controls/SessionControls';
import { ToolDock } from './controls/ToolBar';
import { ViewControls } from './controls/ViewControls';
import { ZoomControl } from './controls/ZoomControl';
import { Filmstrip } from './filmstrip/Filmstrip';
import { SlideCounter } from './filmstrip/SlideCounter';
import { useFullscreen } from './hooks/useFullscreen';
import { useSlideUrlSync } from './hooks/useSlideUrlSync';
import { lockHeight, releaseHeight, useStageZoom } from './hooks/useStageZoom';
import { useViewerShortcuts } from './hooks/useViewerShortcuts';
import { SlideStage } from './stage/SlideStage';
import { useViewerData } from './state/viewer-data';
import { useViewerState } from './state/viewer-state';
import { ViewerToastContext } from './state/viewer-toast';

/**
 * Layout of the review viewer (Desktop-1, B1–B4). Composition only – behaviour lives in the
 * hooks and the components. The root is the scroll container and the fullscreen target, so
 * floating controls and panels stay visible in fullscreen.
 */
export function Viewer({ onLeave }: { onLeave: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const boardRef = useRef<HTMLElement>(null);
  const stageAreaRef = useRef<HTMLDivElement>(null);
  const { deck } = useViewerData();
  const { activeSlideId, filmstripOpen, threadPanelOpen, zoomGesture } = useViewerState();
  const fullscreen = useFullscreen(rootRef);
  const [toast, showToast] = useToast();

  useViewerShortcuts({ onToggleFullscreen: fullscreen.toggle });
  useSlideUrlSync(activeSlideId);
  useStageZoom(stageAreaRef);

  // During a zoom gesture the slide area doesn't shrink, so the zoom pill and the comments stay
  // under the pointer; it settles in one step once the gesture ends.
  useLayoutEffect(() => {
    const area = stageAreaRef.current;
    if (!area) return;
    if (zoomGesture) lockHeight(area);
    else releaseHeight(area);
  }, [zoomGesture]);

  return (
    <ViewerToastContext value={showToast}>
      <div
        ref={rootRef}
        className="dot-grid relative h-dvh overflow-x-hidden overflow-y-auto text-fg"
        style={{ '--stage-pad': 'clamp(16px, 3vw, 32px)' } as CSSProperties}
      >
        <main
          ref={contentRef}
          className={cn(
            'relative min-h-full pb-40 transition-[padding] duration-300',
            threadPanelOpen && 'md:pr-[400px]',
          )}
        >
          <h1 className="sr-only">{deck.title}</h1>

          {/* Slides and filmstrip; ⌘ + wheel / pinch here zooms the slide row (BER-96). */}
          <div ref={stageAreaRef} className="bg-canvas">
            <SlideStage />
            {/* Figma 87:327: 96px row, thumbs 32px below the slides and 16px from the edges (the
              filmstrip adds 2px for the active ring). Opaque and above the connector overlay
              (z-20), so lines pass behind the thumbnails. */}
            {filmstripOpen && (
              <div className="relative z-[25] flex items-center gap-4 bg-canvas py-3.5 pr-4 pl-3.5">
                <Filmstrip />
                <SlideCounter />
              </div>
            )}
          </div>

          {/* Connector lines fade out behind this row (and the filmstrip). */}
          <div
            data-connector-occluder="controls"
            className="mt-4 flex flex-wrap items-center gap-3 px-[var(--stage-pad)]"
          >
            <AvatarStack authors={deck.participants} size={32} max={6} className="shrink-0" />
            <CommentFilterBar />
            {/* Figma 87:359 / 87:369: 16px from the right edge, 10px apart. Without the
              filmstrip row its counter moves here, so the whole row collapses. */}
            <div className="mr-[calc(16px-var(--stage-pad))] ml-auto flex items-center gap-2.5">
              {!filmstripOpen && <SlideCounter />}
              <ZoomControl />
              <ViewControls
                isFullscreen={fullscreen.isFullscreen}
                onToggleFullscreen={fullscreen.toggle}
                fullscreenSupported={fullscreen.isSupported}
              />
            </div>
          </div>

          {/* Above the connector overlay (z-20): lines run behind the glass cards. The top padding
            holds the connectors' bus rows (set by ConnectorLines). */}
          <section
            ref={boardRef}
            aria-label="Kommentare"
            className="relative z-30 px-[var(--stage-pad)] pt-[var(--connector-room,48px)]"
          >
            <CommentBoard />
          </section>

          <ConnectorLines containerRef={contentRef} boardRef={boardRef} />
        </main>

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
