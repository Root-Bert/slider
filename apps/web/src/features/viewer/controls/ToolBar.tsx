import { cn, GlassPanel, Icon, IconButton, type IconName, Toolbar, ToolbarDivider } from '@/ui';
import { useViewerData } from '../state/viewer-data';
import {
  isBoxModeActive,
  type Tool,
  useViewerDispatch,
  useViewerState,
} from '../state/viewer-state';
import { VIEW_ONLY_HINT } from '../comments/lib/view-only';

/** The drawing tools, right next to the pointer. Boxes are the pointer's (drag). */
const PEN_TOOLS: { tool: Tool; icon: IconName; label: string }[] = [
  { tool: 'pen', icon: 'gesture', label: 'Freihand' },
  { tool: 'arrow', icon: 'arrow', label: 'Pfeil' },
  { tool: 'highlighter', icon: 'marker', label: 'Marker' },
  { tool: 'eraser', icon: 'eraser', label: 'Radierer: Freihand und Marker wegwischen' },
];

/**
 * Tool bar at the left of the controls row (Figma D1): pointer (the default – pins, boxes and
 * text on the slide), freehand, arrow, marker and the eraser, and the switch for the PowerPoint boxes comments
 * attach to, for the guides and for the slides hidden in PowerPoint – a compact pill as tall as the filter pill.
 */
export function ToolBar({ className }: { className?: string }) {
  const { canComment } = useViewerData();

  if (!canComment) {
    return (
      <GlassPanel
        role="status"
        title={VIEW_ONLY_HINT}
        className={cn(
          'flex h-10 shrink-0 items-center gap-2 px-3 text-sm text-fg-muted',
          className,
        )}
      >
        <Icon name="visibility" size={18} />
        Nur ansehen
        <span className="sr-only">{VIEW_ONLY_HINT}</span>
      </GlassPanel>
    );
  }

  return (
    <div className={cn('relative shrink-0', className)}>
      <ToolButtons />
    </div>
  );
}

function ToolButtons() {
  const state = useViewerState();
  const { tool, boxMode, showGuides, showHiddenSlides } = state;
  const { hiddenSlideCount } = useViewerData();
  // Lit while box mode applies – also while ⌥ flips it on for a moment.
  const boxes = isBoxModeActive(state);
  const dispatch = useViewerDispatch();

  return (
    <Toolbar
      label="Werkzeuge (Tab wechselt)"
      // A click keeps the focus off the button, so Tab goes on stepping through the tools.
      onMouseDown={(event) => event.preventDefault()}
    >
      {/* The default: click the slide to comment – on a PowerPoint box in box mode. */}
      <IconButton
        icon="cursor"
        label={
          boxes
            ? 'Zeiger: Box anklicken und kommentieren'
            : 'Zeiger: Stelle anklicken und kommentieren'
        }
        size="sm"
        active={tool === null}
        onClick={() => dispatch({ type: 'toolSelected', tool: null })}
      />
      {/* Freehand, arrow and marker are bare drawings; their badge takes the comment. */}
      {PEN_TOOLS.map((option) => (
        <IconButton
          key={option.tool}
          icon={option.icon}
          label={option.label}
          size="sm"
          active={tool === option.tool}
          onClick={() => dispatch({ type: 'toolSelected', tool: option.tool })}
        />
      ))}
      <ToolbarDivider />
      <IconButton
        icon="gridView"
        label={`Box-Modus ${boxMode ? 'aus' : 'an'} (B) – ⌥ halten wechselt kurz`}
        size="sm"
        active={boxes}
        onClick={() => dispatch({ type: 'boxModeToggled' })}
      />
      <IconButton
        icon="guides"
        label={showGuides ? 'Hilfslinien ausblenden (G)' : 'Hilfslinien zeigen (G)'}
        size="sm"
        active={showGuides}
        onClick={() => dispatch({ type: 'showGuidesToggled' })}
      />
      {hiddenSlideCount > 0 && (
        <IconButton
          icon={showHiddenSlides ? 'visibility' : 'visibilityOff'}
          label={
            showHiddenSlides
              ? 'Ausgeblendete Folien verbergen (H)'
              : `${hiddenSlideCount === 1 ? '1 ausgeblendete Folie' : `${hiddenSlideCount} ausgeblendete Folien`} zeigen (H)`
          }
          size="sm"
          active={showHiddenSlides}
          onClick={() => dispatch({ type: 'showHiddenSlidesToggled' })}
        />
      )}
    </Toolbar>
  );
}
