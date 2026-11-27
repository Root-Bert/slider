import { DIAGRAM_SIDES, type DiagramNode } from '@slider/shared';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { useState, type KeyboardEvent } from 'react';
import { isModKey } from '@/lib/keyboard';
import { Icon } from '@/ui';
import type { BoxNode } from '../lib/flow';
import { tintProps, useDiagramUi } from './context';
import { ShapeOutline } from './ShapeOutline';

const SIDE_LABEL = { top: 'oben', right: 'rechts', bottom: 'unten', left: 'links' } as const;

/**
 * Where the words are typed: in the box, where they stand. Esc, ⌘↵ and a click elsewhere keep
 * them (as everywhere: the words stay, the box is left); Enter starts a new line.
 */
function TextEdit({
  box,
  onDone,
  className,
  single = false,
}: {
  box: DiagramNode;
  onDone: (text: string) => void;
  className?: string;
  single?: boolean;
}) {
  const [text, setText] = useState(box.text);
  const done = () => onDone(text);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (
      event.key === 'Escape' ||
      (event.key === 'Enter' && (isModKey(event) || single)) ||
      (event.key === 'Tab' && !event.shiftKey)
    ) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };
  return (
    <div className={className}>
      <textarea
        // The canvas must not take the press as a drag, nor its keys as its own.
        className="nodrag nopan nowheel"
        aria-label={box.shape === 'frame' ? 'Titel des Rahmens' : 'Text'}
        autoFocus
        rows={Math.max(1, text.split('\n').length)}
        value={text}
        placeholder={box.shape === 'frame' ? 'Rahmen' : ''}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setText(event.target.value)}
        onBlur={done}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
      />
    </div>
  );
}

/** A box (or a frame) on the canvas: its outline in its tint, its words, its ports. */
export function BoxView({ id, data, selected }: NodeProps<BoxNode>) {
  const ui = useDiagramUi();
  const { box } = data;
  const editing = ui.editing === id;
  const frame = box.shape === 'frame';
  const resizable = ui.canEdit && selected && ui.single === id && !editing;
  const tint = tintProps(box.color);
  const ports = ui.canEdit && !frame && !editing && !ui.busy;

  return (
    <div
      className="dg-box"
      data-shape={box.shape}
      data-size={box.size}
      data-picked={selected || undefined}
      data-single={(selected && ui.single === id) || undefined}
      data-drop={ui.dropFrame === id || undefined}
      data-near={ui.near === id || undefined}
      {...tint}
    >
      <NodeResizer
        isVisible={resizable}
        minWidth={frame ? 120 : 24}
        minHeight={frame ? 80 : 16}
        handleClassName="dg-resize"
      />
      {frame ? (
        <>
          <div className="dg-frame" />
          {editing ? (
            <TextEdit
              box={box}
              className="dg-frame-title"
              single
              onDone={(text) => ui.commitText(id, text)}
            />
          ) : (
            <div className="dg-frame-title">
              {box.text || <span className="dg-placeholder">Rahmen</span>}
            </div>
          )}
        </>
      ) : (
        <>
          <ShapeOutline shape={box.shape} width={box.width} height={box.height} />
          {editing ? (
            <TextEdit
              box={box}
              className="dg-text dg-text-edit"
              onDone={(text) => ui.commitText(id, text)}
            />
          ) : (
            <div className="dg-text">{box.text}</div>
          )}
        </>
      )}
      {ports &&
        DIAGRAM_SIDES.map((side) => (
          <button
            key={side}
            type="button"
            tabIndex={-1}
            className="dg-port nodrag nopan"
            data-side={side}
            aria-label={`Pfeil nach ${SIDE_LABEL[side]}`}
            title="Ziehen: Pfeil zu einer Form | Klicken: neue Form daneben"
            onPointerDown={(event) => ui.startConnect(id, side, event)}
          >
            <Icon name="add" size={12} />
          </button>
        ))}
      {/* Arrows find their side themselves (`ArrowView`); the canvas wants a handle to hold. */}
      <Handle type="source" position={Position.Bottom} className="dg-handle" isConnectable={false} />
      <Handle type="target" position={Position.Top} className="dg-handle" isConnectable={false} />
    </div>
  );
}
