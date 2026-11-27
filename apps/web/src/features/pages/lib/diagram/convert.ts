import {
  applyDiagramChanges,
  emptyDiagram,
  type Diagram as DiagramFile,
  type DiagramChange,
  type DiagramShape,
} from '@slider/shared';
import type { Diagram, Look, Shape } from './parse';

/*
 * A ```mermaid flowchart on a page turned into a diagram of its own (a Cloud file, drawn in the
 * editor): its boxes, groups as frames, arrows with their words – laid out anew, as „Aufräumen“
 * would. What the editor has no way to show (an invisible arrow, a colour that is not one) is left.
 */

const SHAPE: Record<Shape, Exclude<DiagramShape, 'frame'>> = {
  rect: 'rect',
  round: 'rounded',
  stadium: 'pill',
  subroutine: 'rect',
  cylinder: 'cylinder',
  circle: 'ellipse',
  'double-circle': 'ellipse',
  flag: 'rect',
  rhombus: 'rhombus',
  hexagon: 'hexagon',
  'lean-right': 'parallelogram',
  'lean-left': 'parallelogram',
  trapezoid: 'rect',
  'trapezoid-alt': 'rect',
};

/** A fill given as `#rgb` or `#rrggbb`, as the diagram keeps colours of its own. */
function colorOf(look: Look): string | undefined {
  const fill = look.fill?.trim().toLowerCase();
  if (!fill) return undefined;
  if (/^#[0-9a-f]{6}$/.test(fill)) return fill;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(fill);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : undefined;
}

/** An id of the file: at most 64 characters, as the file allows. */
const MAX_ID = 64;

export function diagramFromMermaid(flowchart: Diagram): DiagramFile {
  const changes: DiagramChange[] = [];
  // Boxes and groups share no ids in the file, and none is longer than it holds: each gets one of
  // its own – its name where it can, cut and numbered where it is too long or taken.
  const taken = new Set<string>();
  const own = (name: string) => {
    const stem = name.slice(0, MAX_ID - 4);
    let id = stem;
    for (let n = 2; taken.has(id); n += 1) id = `${stem}-${n}`;
    taken.add(id);
    return id;
  };
  const boxIds = new Map([...flowchart.nodes.keys()].map((id) => [id, own(id)]));
  const frameIds = new Map([...flowchart.groups.keys()].map((id) => [id, own(`group-${id}`)]));
  const frameId = (group: string) => frameIds.get(group)!;
  // An arrow to a group's name is an arrow to its frame.
  const endOf = (id: string) => boxIds.get(id) ?? frameIds.get(id);
  for (const group of flowchart.groups.values()) {
    changes.push({
      type: 'add_frame',
      id: frameId(group.id),
      text: group.label,
      ...(group.parent && { frame: frameId(group.parent) }),
      ...(colorOf(group.look) && { color: colorOf(group.look) }),
    });
  }
  for (const node of flowchart.nodes.values()) {
    changes.push({
      type: 'add_box',
      id: boxIds.get(node.id)!,
      text: node.label,
      shape: SHAPE[node.shape],
      ...(node.group && { frame: frameId(node.group) }),
      ...(colorOf(node.look) && { color: colorOf(node.look) }),
    });
  }
  for (const edge of flowchart.edges) {
    const from = endOf(edge.from);
    const to = endOf(edge.to);
    if (edge.stroke === 'invisible' || !from || !to || from === to) continue;
    changes.push({
      type: 'connect',
      from,
      to,
      ...(edge.label && { label: edge.label }),
      ...(edge.stroke === 'dotted' && { line: 'dotted' as const }),
      ...(edge.head !== 'arrow' && { end: 'none' as const }),
      ...(edge.tail === 'arrow' && { start: 'arrow' as const }),
    });
  }
  const direction = flowchart.direction === 'LR' || flowchart.direction === 'RL' ? 'LR' : 'TB';
  return applyDiagramChanges(emptyDiagram(), changes, { tidy: true, direction }).diagram;
}
