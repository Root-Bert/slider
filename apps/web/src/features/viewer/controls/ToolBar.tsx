import {
  cn,
  GlassPanel,
  Icon,
  IconButton,
  type IconName,
  SegmentedControl,
  Toolbar,
  ToolbarDivider,
} from '@/ui';
import { guideOverflows } from '@slider/shared';
import { useEffect, useMemo } from 'react';
import { EditActions } from '../editing/EditActions';
import { useEditing } from '../editing/editing-context';
import { useRevisionData } from '../state/revision-data';
import { useViewerData } from '../state/viewer-data';
import {
  isBoxModeActive,
  type Tool,
  useViewerDispatch,
  useViewerState,
} from '../state/viewer-state';
import { VIEW_ONLY_HINT } from '../comments/lib/view-only';
import { useMisspellings } from '../spelling/useMisspellings';
import { useLayoutGuides, useTemplate } from '../template/useTemplate';

/** The drawing tools, right next to the pointer. Boxes are the pointer's (drag). */
const PEN_TOOLS: { tool: Tool; icon: IconName; label: string }[] = [
  { tool: 'pen', icon: 'gesture', label: 'Freihand' },
  { tool: 'arrow', icon: 'arrow', label: 'Pfeil' },
  { tool: 'highlighter', icon: 'marker', label: 'Marker' },
  { tool: 'eraser', icon: 'eraser', label: 'Radierer' },
];

/** Reviewing (comments and drawings) or editing the slides – the tools after the switch follow it. */
type Mode = 'review' | 'edit';

const MODES = [
  { value: 'review', label: 'Besprechen', icon: 'chatBubble', title: 'Besprechen (R)' },
  {
    value: 'edit',
    label: 'Bearbeiten',
    icon: 'editor',
    title: 'Bearbeiten (E) – ⇧ und ziehen fügt auch über anderen Boxen hinzu',
  },
] as const;

/**
 * Tool bar at the left of the controls row (Figma D1), a compact pill as tall as the filter pill.
 * Far left the switch between reviewing and editing, the two main modes. Then the tools of the
 * mode: reviewing – pointer (pins, boxes and text on the slide), freehand, arrow, marker, eraser;
 * editing – undo and redo (picking and drawing a frame need no tool; a symbol goes into a picture
 * frame's „Symbole“). Then how the slides are shown, in either mode: the PowerPoint boxes comments
 * attach to, the layers in 3D, the guides, the slides hidden in PowerPoint and the change markers
 * of the latest version.
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

/**
 * Every button here is a toggle: a stable name for what it switches, `aria-pressed` true or false
 * (screen readers announce "Box-Modus, Umschalter, gedrückt"), the action in the tooltip.
 */
function ToolButtons() {
  const state = useViewerState();
  const { showGuides, showLayoutGrid, showHiddenSlides, showChanges } = state;
  const { hiddenSlideCount } = useViewerData();
  const { crossed: guidesCrossed, misspelt } = useGuidesCrossed();
  const { revisionNumber, badges } = useRevisionData();
  // Only when the latest version actually added, changed or moved slides.
  const hasChanges = revisionNumber > 1 && badges.size > 0;
  // Lit while box mode applies – also while ⌥ flips it on for a moment.
  const boxes = isBoxModeActive(state);
  const dispatch = useViewerDispatch();
  const editing = useEditing();
  const mode: Mode = editing.active ? 'edit' : 'review';
  // A template being designed opens in editing: designing is editing.
  const isTemplate = useTemplate().template !== null;
  const { setActive } = editing;
  useEffect(() => {
    if (isTemplate) setActive(true);
  }, [isTemplate, setActive]);

  return (
    <Toolbar
      label="Werkzeuge (Tab wechselt)"
      // A click keeps the focus off the button, so Tab goes on stepping through the tools.
      onMouseDown={(event) => event.preventDefault()}
    >
      {/* The two modes, always first: the tools after them follow the mode. */}
      {editing.available && (
        <>
          <SegmentedControl
            label="Modus (R Besprechen, E Bearbeiten)"
            segments={MODES}
            iconOnly
            value={mode}
            onChange={(next) => editing.setActive(next === 'edit')}
          />
          <ToolbarDivider />
        </>
      )}
      {mode === 'edit' ? <EditTools /> : <ReviewTools />}
      <ToolbarDivider />
      {/* How the slides are shown – the same in either mode. */}
      <div role="group" aria-label="Ansicht" className="flex items-center gap-1">
        <IconButton
          icon="gridViewFill"
          label="Box-Modus"
          title="Box-Modus (B)"
          aria-keyshortcuts="B"
          size="sm"
          active={boxes}
          aria-pressed={boxes}
          onClick={() => dispatch({ type: 'boxModeToggled' })}
        />
        {/* The slides taken apart in 3D: what lies over what – commented on while reviewing,
            picked and restacked while editing. The list (⇧L) opens on asking, or on a layer
            picked. */}
        {editing.available && (
          <IconButton
            icon="layers"
            label="Ebenen"
            title="Ebenen (L)"
            aria-keyshortcuts="L Shift+L"
            size="sm"
            active={editing.layers}
            aria-pressed={editing.layers}
            onClick={() => editing.setLayers(!editing.layers)}
          />
        )}
        <IconButton
          icon="guides"
          label="Hilfslinien"
          title={
            guidesCrossed
              ? 'Hilfslinien (G) – eine Box ragt über die Hilfslinien'
              : misspelt
                ? 'Hilfslinien (G) – ein Wort ist falsch geschrieben'
                : 'Hilfslinien (G)'
          }
          aria-keyshortcuts="G"
          size="sm"
          // Lit, softly pulsing, while a box on this slide sticks out over the guides or has a
          // misspelt word – also with the guides hidden (the words: once the view was shown).
          className={guidesCrossed || misspelt ? 'guide-alert' : undefined}
          active={showGuides}
          aria-pressed={showGuides}
          onClick={() => dispatch({ type: 'showGuidesToggled' })}
        />
        {/* The layout grid, as in Figma (H) – a template's own, a presentation's from its
            template; a template's columns and rows set in the side panel (⇧H). */}
        <IconButton
          icon="layoutGrid"
          label="Layout-Ansicht"
          title="Layout-Ansicht (H)"
          aria-keyshortcuts={isTemplate ? 'H Shift+H' : 'H'}
          size="sm"
          active={showLayoutGrid}
          aria-pressed={showLayoutGrid}
          onClick={() => dispatch({ type: 'layoutGridToggled' })}
        />
        {hiddenSlideCount > 0 && (
          <IconButton
            icon={showHiddenSlides ? 'visibility' : 'visibilityOff'}
            label={`Ausgeblendete Folien zeigen (${hiddenSlideCount})`}
            title="Ausgeblendete Folien"
            size="sm"
            active={showHiddenSlides}
            aria-pressed={showHiddenSlides}
            onClick={() => dispatch({ type: 'showHiddenSlidesToggled' })}
          />
        )}
        {/* The "Neu" / "Geändert" / "Verschoben" chips of the latest version (Figma D2); off unless set on in /konto. */}
        {hasChanges && (
          <IconButton
            icon="difference"
            label="Änderungshinweise"
            size="sm"
            active={showChanges}
            aria-pressed={showChanges}
            onClick={() => dispatch({ type: 'showChangesSet', show: !showChanges })}
          />
        )}
      </div>
      {editing.available && <EditActions />}
    </Toolbar>
  );
}

/**
 * Whether a box on the slide shown sticks out over its guides (`GuideLayer` outlines them) – the
 * template's layout guides while one is designed, as there – and whether one has a misspelt word,
 * known once the guides view loaded its dictionaries (`useMisspellings`).
 */
function useGuidesCrossed(): { crossed: boolean; misspelt: boolean } {
  const { slides, slideIndex } = useViewerData();
  const { activeSlideId } = useViewerState();
  const slide = activeSlideId ? slides[slideIndex.get(activeSlideId) ?? -1] : undefined;
  const layoutGuides = useLayoutGuides(activeSlideId ?? '')?.guides;
  const guides = layoutGuides ?? slide?.guides;
  const misspelt = useMisspellings(slide?.shapes, false).length > 0;
  const crossed = useMemo(
    () => !!slide && !!guides && guideOverflows(slide.shapes, guides).length > 0,
    [slide, guides],
  );
  return { crossed, misspelt };
}

/** Reviewing: comment on the slide, or draw on it. */
function ReviewTools() {
  const { tool } = useViewerState();
  const dispatch = useViewerDispatch();
  return (
    <>
      {/* The default: click the slide to comment – on a PowerPoint box in box mode. */}
      <IconButton
        icon="cursorBox"
        label="Zeiger"
        size="sm"
        active={tool === null}
        aria-pressed={tool === null}
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
          aria-pressed={tool === option.tool}
          onClick={() => dispatch({ type: 'toolSelected', tool: option.tool })}
        />
      ))}
    </>
  );
}

/**
 * Editing: „Symbol einfügen“, undo and redo – picking needs no tool (dragging on the free slide
 * draws a frame for a new text, shape, line or picture); designing a template, setting its guides
 * (Tab switches).
 */
function EditTools() {
  const editing = useEditing();
  const { template } = useTemplate();
  // In 3D, layers are picked and restacked; guides are set on the flat slide.
  const flat = !editing.layers;
  return (
    <>
      {/* No pointer: picking is all there is (a frame drawn on the free slide fills it with a
          text, shape, line or picture). Designing a template, its guides are a tool of their own. */}
      {template && (
        <>
          <IconButton
            icon="guideAdd"
            label="Hilfslinien setzen"
            size="sm"
            disabled={!flat}
            active={editing.tool === 'guides'}
            aria-pressed={editing.tool === 'guides'}
            onClick={() => editing.setTool(editing.tool === 'guides' ? 'select' : 'guides')}
          />
          <ToolbarDivider />
        </>
      )}
      <IconButton
        icon="undo"
        label="Rückgängig"
        title="Rückgängig (⌘Z)"
        aria-keyshortcuts="Meta+Z"
        size="sm"
        disabled={!editing.canUndo}
        onClick={editing.undo}
      />
      <IconButton
        icon="redo"
        label="Wiederholen"
        title="Wiederholen (⇧⌘Z)"
        aria-keyshortcuts="Meta+Shift+Z"
        size="sm"
        disabled={!editing.canRedo}
        onClick={editing.redo}
      />
    </>
  );
}
