import { useRef, type CSSProperties } from 'react';
import { AvatarStack, cn } from '@/ui';
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
import { useViewerShortcuts } from './hooks/useViewerShortcuts';
import { SlideStage } from './stage/SlideStage';
import { useViewerData } from './state/viewer-data';
import { useViewerState } from './state/viewer-state';

/**
 * Layout of the review viewer (Desktop-1, B1–B4). Composition only – behaviour lives in the
 * hooks and the components. The root is the scroll container and the fullscreen target, so
 * floating controls and panels stay visible in fullscreen.
 */
export function Viewer({ onLeave }: { onLeave: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLElement>(null);
  const boardRef = useRef<HTMLElement>(null);
  const { deck } = useViewerData();
  const { activeSlideId, filmstripOpen, threadPanelOpen } = useViewerState();
  const fullscreen = useFullscreen(rootRef);

  useViewerShortcuts({ onToggleFullscreen: fullscreen.toggle });
  useSlideUrlSync(activeSlideId);

  return (
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

        <div className="bg-canvas">
          <SlideStage />
          <div className="flex min-h-14 items-center gap-4 px-[var(--stage-pad)] pt-2 pb-4">
            {filmstripOpen ? <Filmstrip /> : <div className="flex-1" />}
            <SlideCounter />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-[var(--stage-pad)] pt-4">
          <AvatarStack authors={deck.participants} size={32} max={6} className="shrink-0" />
          <CommentFilterBar />
          <div className="ml-auto flex items-center gap-2">
            <ZoomControl />
            <ViewControls
              isFullscreen={fullscreen.isFullscreen}
              onToggleFullscreen={fullscreen.toggle}
              fullscreenSupported={fullscreen.isSupported}
            />
          </div>
        </div>

        {/* Above the connector overlay (z-20): lines run behind the glass cards. */}
        <section
          ref={boardRef}
          aria-label="Kommentare"
          className="relative z-30 px-[var(--stage-pad)] pt-12"
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
    </div>
  );
}
