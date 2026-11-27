import type { DiagramShape } from '@slider/shared';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useState, type FormEvent, type ReactNode } from 'react';
import {
  AI_ICON,
  cn,
  Icon,
  IconButton,
  PopoverPanel,
  Spinner,
  Toolbar,
  ToolbarDivider,
  usePopover,
} from '@/ui';
import { SHAPE_LABEL, TOOL_KEYS, type Tool } from '../lib/labels';
import { ShapeIcon } from './ShapeOutline';



const keyOf = (tool: Tool) => Object.entries(TOOL_KEYS).find(([, each]) => each === tool)?.[0];

const MORE: DiagramShape[] = ['rect', 'pill', 'cylinder', 'hexagon', 'parallelogram', 'document'];

function ToolButton({
  tool,
  current,
  label,
  onPick,
  children,
}: {
  tool: Tool;
  current: Tool;
  label: string;
  onPick: (tool: Tool) => void;
  children: ReactNode;
}) {
  const key = keyOf(tool);
  return (
    <button
      type="button"
      aria-label={label}
      title={key ? `${label} (${key.toUpperCase()})` : label}
      aria-pressed={current === tool}
      onClick={() => onPick(tool)}
      className={cn(
        'flex size-8 items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-hover hover:text-fg',
        current === tool && 'bg-selected text-fg',
      )}
    >
      {children}
    </button>
  );
}

function MoreShapes({ current, onPick }: { current: Tool; onPick: (tool: Tool) => void }) {
  const { open, close, wrapperRef, triggerProps, panelRef, panelId } = usePopover({ hasPopup: true });
  const picked = MORE.includes(current as DiagramShape) ? (current as DiagramShape) : null;
  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        {...triggerProps}
        aria-label="Weitere Formen"
        title="Weitere Formen"
        className={cn(
          'flex h-8 items-center gap-0.5 rounded-control pr-0.5 pl-1.5 text-fg-muted transition-colors hover:bg-hover hover:text-fg',
          picked && 'bg-selected text-fg',
        )}
      >
        <ShapeIcon shape={picked ?? 'cylinder'} />
        <Icon name="expandLess" size={14} />
      </button>
      {open && (
        <PopoverPanel ref={panelRef} id={panelId} side="top" padding="sm" aria-label="Weitere Formen" className="w-48">
          {MORE.map((shape) => (
            <button
              key={shape}
              type="button"
              onClick={() => {
                onPick(shape);
                close();
              }}
              className="flex h-8 items-center gap-2 rounded-control px-2 text-left text-sm text-fg-muted hover:bg-hover hover:text-fg"
            >
              <ShapeIcon shape={shape} />
              {SHAPE_LABEL[shape]}
            </button>
          ))}
        </PopoverPanel>
      )}
    </div>
  );
}

/**
 * The tools along the bottom, as in Figma: pick and move, the hand, the shapes, a sticky note,
 * text and a frame – and the AI, asked in words what is to change.
 */
export function Tools({
  tool,
  onTool,
  asking,
  onAsk,
  onTidy,
}: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  asking: boolean;
  onAsk: () => void;
  onTidy: () => void;
}) {
  return (
    <Toolbar label="Werkzeuge">
      <ToolButton tool="select" current={tool} label="Auswählen" onPick={onTool}>
        <Icon name="cursor" size={20} />
      </ToolButton>
      <ToolButton tool="hand" current={tool} label="Verschieben" onPick={onTool}>
        <Icon name="gesture" size={20} />
      </ToolButton>
      <ToolbarDivider />
      <ToolButton tool="rounded" current={tool} label="Rechteck" onPick={onTool}>
        <ShapeIcon shape="rounded" />
      </ToolButton>
      <ToolButton tool="ellipse" current={tool} label="Ellipse" onPick={onTool}>
        <ShapeIcon shape="ellipse" />
      </ToolButton>
      <ToolButton tool="rhombus" current={tool} label="Raute" onPick={onTool}>
        <ShapeIcon shape="rhombus" />
      </ToolButton>
      <MoreShapes current={tool} onPick={onTool} />
      <ToolbarDivider />
      <ToolButton tool="note" current={tool} label="Notiz" onPick={onTool}>
        <Icon name="notes" size={20} />
      </ToolButton>
      <ToolButton tool="text" current={tool} label="Text" onPick={onTool}>
        <Icon name="title" size={20} />
      </ToolButton>
      <ToolButton tool="frame" current={tool} label="Rahmen" onPick={onTool}>
        <Icon name="frameWide" size={20} />
      </ToolButton>
      <ToolbarDivider />
      <IconButton icon="autoFixHigh" label="Aufräumen" title="Aufräumen: alles neu anordnen" size="md" onClick={onTidy} />
      <IconButton icon={AI_ICON} label="Mit KI ändern" title="Mit KI ändern" size="md" active={asking} onClick={onAsk} />
    </Toolbar>
  );
}

/** „Was soll sich ändern?“ – the AI changes the diagram; ⌘Z takes it back as one step. */
export function AskBar({
  picked,
  onAsk,
  onClose,
}: {
  picked: number;
  onAsk: (prompt: string) => Promise<string>;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState('');
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || pending) return;
    setPending(true);
    setNote(null);
    try {
      setNote(await onAsk(text));
      setPrompt('');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Das hat nicht geklappt');
    } finally {
      setPending(false);
    }
  };
  return (
    <form onSubmit={(event) => void submit(event)} className="glass-elevated flex w-[min(560px,calc(100vw-32px))] flex-col rounded-panel p-1.5">
      <div className="flex items-center gap-1.5">
        <span className="flex size-8 shrink-0 items-center justify-center text-fg-subtle">
          {pending ? <Spinner size={16} /> : <Icon name={AI_ICON} size={18} />}
        </span>
        <input
          autoFocus
          value={prompt}
          disabled={pending}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
          aria-label="Was soll sich ändern?"
          placeholder={picked > 0 ? 'Was soll sich am Ausgewählten ändern?' : 'Was soll sich ändern?'}
          className="h-8 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
        />
        <IconButton icon="send" label="Senden" size="sm" type="submit" disabled={pending || !prompt.trim()} />
        <IconButton icon="close" label="Schließen" size="sm" onClick={onClose} />
      </div>
      {note && <p className="px-2.5 pt-1 pb-1.5 text-caption text-fg-muted">{note}</p>}
    </form>
  );
}

/** How near one looks: out, the percentage (back to 100 %), in, everything in view. */
export function ZoomControls() {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  return (
    <Toolbar label="Ansicht">
      <IconButton icon="remove" label="Verkleinern" title="Verkleinern (⌘−)" size="sm" onClick={() => void flow.zoomOut({ duration: 150 })} />
      <button
        type="button"
        title="Auf 100 % (⇧0)"
        onClick={() => void flow.zoomTo(1, { duration: 150 })}
        className="h-7 min-w-12 rounded-control px-1 text-caption text-fg-muted tabular-nums hover:bg-hover hover:text-fg"
      >
        {Math.round(zoom * 100)} %
      </button>
      <IconButton icon="add" label="Vergrößern" title="Vergrößern (⌘+)" size="sm" onClick={() => void flow.zoomIn({ duration: 150 })} />
      <IconButton
        icon="fitSize"
        label="Alles zeigen"
        title="Alles zeigen (⇧1)"
        size="sm"
        onClick={() => void flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 })}
      />
    </Toolbar>
  );
}
