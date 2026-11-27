import {
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useInternalNode,
  type EdgeProps,
} from '@xyflow/react';
import { useState } from 'react';
import { isModKey } from '@/lib/keyboard';
import { arrowEnds, rectOf, type ArrowEdge } from '../lib/flow';
import { tintProps, useDiagramUi } from './context';

/**
 * An arrow between two boxes: it leaves and meets them on the sides that face each other
 * (unless it was told a side), and follows its boxes wherever they are dragged.
 */
export function ArrowView({ id, source, target, data, selected }: EdgeProps<ArrowEdge>) {
  const ui = useDiagramUi();
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  if (!from || !to || !data) return null;
  const { arrow } = data;
  const ends = arrowEnds(rectOf(from), rectOf(to), arrow);
  const [path, labelX, labelY] =
    arrow.route === 'curve'
      ? getBezierPath(ends)
      : arrow.route === 'straight'
        ? getStraightPath(ends)
        : getSmoothStepPath({ ...ends, borderRadius: 10, offset: 20 });
  const head = `dg-head-${id}`;
  const end = (arrow.end ?? 'arrow') === 'arrow';
  const start = arrow.start === 'arrow';
  const editing = ui.editing === id;
  const tint = tintProps(arrow.color);
  return (
    <>
      <g className="dg-arrow-group" data-picked={selected || undefined} {...tint}>
        <defs>
          <marker
            id={head}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="11"
            markerHeight="11"
            markerUnits="userSpaceOnUse"
            orient="auto-start-reverse"
          >
            <path className="dg-arrow-head" d="M0.5,0.8 L10,5 L0.5,9.2 L2.6,5 Z" />
          </marker>
        </defs>
        <path
          className="dg-arrow"
          data-line={arrow.line}
          d={path}
          markerEnd={end ? `url(#${head})` : undefined}
          markerStart={start ? `url(#${head})` : undefined}
        />
        {/* Wider than it looks: an arrow is easy to hit. */}
        <path className="react-flow__edge-interaction" d={path} fill="none" strokeOpacity={0} strokeWidth={18} />
      </g>
      {(arrow.label || editing) && (
        <EdgeLabelRenderer>
          <div
            className="dg-label nodrag nopan"
            data-picked={selected || undefined}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onDoubleClick={() => ui.canEdit && ui.edit(id)}
          >
            {editing ? (
              <LabelEdit text={arrow.label ?? ''} onDone={(text) => ui.commitText(id, text)} />
            ) : (
              arrow.label
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function LabelEdit({ text: initial, onDone }: { text: string; onDone: (text: string) => void }) {
  const [text, setText] = useState(initial);
  return (
    <textarea
      className="nodrag nopan"
      aria-label="Beschriftung"
      autoFocus
      rows={Math.max(1, text.split('\n').length)}
      value={text}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' || (event.key === 'Enter' && (isModKey(event) || !event.shiftKey))) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}
