import type { Slide } from '@slider/shared';
import type { StatusFilter } from '@/lib/preferences/work-preferences';
import type { StatusCounts } from '../../comments/lib/comment-selectors';
import { cn, GlassPanel, Icon, IconButton, SegmentedControl, Toolbar, ToolbarDivider } from '@/ui';
import { CONTROLS_DELAY } from '../lib/import-skeleton';
import { EASE_OUT } from './stage-motion';
import { STAGE_TONE } from './stage-tones';

/** How the viewer will open – the controls row shows exactly that, already while importing. */
export interface GhostControlsSetup {
  canComment: boolean;
  /** Owner of an uploaded deck: the deck pill starts with the upload of a new version. */
  canUpload: boolean;
  boxMode: boolean;
  showGuides: boolean;
  statusFilter: StatusFilter;
  showMinimap: boolean;
  /** What only the viewer's data tells – known once it is in, while the stage settles. */
  opening: ViewerOpening | null;
  showHiddenSlides: boolean;
}

/** The viewer's data as the controls row will show it when the deck opens. */
export interface ViewerOpening {
  /** Slides hidden in PowerPoint: the tool bar gets their switch. */
  hiddenSlideCount: number;
  /** The comment filter's counts. */
  counts: StatusCounts;
  /** The slides it opens with – they appear over the placeholders at the end. */
  slides: readonly Slide[];
  /** Hidden slides showing: if so set, or because the link points at one. */
  showHiddenSlides: boolean;
}

const noop = () => {};

const rise = (index: number) => ({
  animation: `import-rise 680ms ${EASE_OUT} ${CONTROLS_DELAY + index * 80}ms both`,
});

/**
 * The controls row as the viewer will open it, pill for pill and in the same states – tool bar,
 * comment filter, deck pill – built from the same parts, so the stage fades into the real row
 * without a seam. Nothing here is interactive (the stage makes it `inert`). What only the deck's
 * data can tell – slide count, comment counts, hidden slides – comes in as it is known.
 */
export function GhostControls({
  count,
  setup,
}: {
  count: number | null;
  setup: GhostControlsSetup;
}) {
  const counts = setup.opening?.counts;
  return (
    <div className="flex flex-wrap items-center gap-3 md:flex-nowrap">
      {setup.canComment ? (
        <Toolbar role={false} className="shrink-0" style={rise(0)}>
          <IconButton icon="cursorBox" label="" title={false} size="sm" active />
          {(['gesture', 'arrow', 'marker', 'eraser'] as const).map((icon) => (
            <IconButton key={icon} icon={icon} label="" title={false} size="sm" />
          ))}
          <ToolbarDivider />
          <IconButton icon="gridView" label="" title={false} size="sm" active={setup.boxMode} />
          <IconButton icon="guides" label="" title={false} size="sm" active={setup.showGuides} />
          {/* Known only once the viewer's data is in: it pops in while the stage settles. */}
          {(setup.opening?.hiddenSlideCount ?? 0) > 0 && (
            <IconButton
              icon={setup.showHiddenSlides ? 'visibility' : 'visibilityOff'}
              label=""
              title={false}
              size="sm"
              active={setup.showHiddenSlides}
              className="animate-pop-in"
            />
          )}
        </Toolbar>
      ) : (
        <GlassPanel
          className="flex h-10 shrink-0 items-center gap-2 px-3 text-sm text-fg-muted"
          style={rise(0)}
        >
          <Icon name="visibility" size={18} />
          Nur ansehen
        </GlassPanel>
      )}
      <GlassPanel
        className="scrollbar-none flex max-w-full min-w-0 items-center gap-3 overflow-x-auto p-1"
        style={rise(1)}
      >
        <SegmentedControl<StatusFilter>
          label=""
          value={setup.statusFilter}
          onChange={noop}
          segments={[
            { value: 'all', label: 'Alle', icon: 'chatBubble', count: counts?.all },
            { value: 'open', label: 'Offen', icon: 'radioButtonUnchecked', count: counts?.open },
            { value: 'done', label: 'Erledigt', icon: 'checkCircleOutline', count: counts?.done },
          ]}
        />
      </GlassPanel>
      <div className="ml-auto flex shrink-0 items-center gap-2.5" style={rise(2)}>
        <Toolbar role={false} className="shrink-0">
          {setup.canUpload && <IconButton icon="upload" label="" title={false} size="sm" />}
          <IconButton
            icon={setup.showMinimap ? 'minimapOff' : 'minimap'}
            label=""
            title={false}
            size="sm"
          />
          <ToolbarDivider />
          <span className="flex items-center gap-1 md:@max-[740px]:hidden">
            <span className="flex shrink-0 items-center gap-2 pr-2 text-base leading-5 tabular-nums">
              <span className="flex h-8 min-w-8 items-center justify-center px-1.5 text-fg-muted">
                1
              </span>
              <span className="text-fg-subtle">/</span>
              {count === null ? (
                <span className={cn('h-3 w-2.5 rounded-full', STAGE_TONE.ghostControl)} />
              ) : (
                <span key={count} className="animate-pop-in text-fg-muted">
                  {count}
                </span>
              )}
            </span>
            <ToolbarDivider />
          </span>
          <IconButton icon="close" label="" title={false} size="sm" />
        </Toolbar>
      </div>
    </div>
  );
}

/** The split handle, centred in the controls row like the viewer's. */
export function GhostHandle() {
  return (
    <span
      className={cn('h-[3px] w-24 rounded-full', STAGE_TONE.handle)}
      style={{ animation: `import-pop 520ms ${EASE_OUT} ${CONTROLS_DELAY + 420}ms both` }}
    />
  );
}
