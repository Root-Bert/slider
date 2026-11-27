import { describe, expect, it } from 'vitest';
import { diagramFromMermaid } from './convert';
import { layoutDiagram } from './layout';
import { isFlowchart, parseDiagram, type Diagram } from './parse';

const SOURCE = [
  'flowchart TD',
  '  A([Anfrage]) --> B{Kunde bekannt?}',
  '  B -- Ja --> C[Angebot]',
  '  B -->|Nein| D',
  '  D --> C',
  '  subgraph G[Gruppe]',
  '    X[Eins] --> Y',
  '  end',
  '  C & D --> Z',
  '  style D fill:#f00',
].join('\n');

const diagramOf = (text: string): Diagram => {
  const parsed = parseDiagram(text);
  if ('error' in parsed) throw new Error(parsed.error);
  return parsed.diagram;
};

describe('diagrams', () => {
  it('reads a flowchart and turns it into a diagram file', () => {
    expect(isFlowchart('%% Kommentar\nflowchart LR\n  A --> B')).toBe(true);
    expect(isFlowchart('---\ntitle: X\n---\ngraph TD\nA-->B')).toBe(true);
    expect(isFlowchart('sequenceDiagram\n  A->>B: Hallo')).toBe(false);

    const diagram = diagramOf(SOURCE);
    expect(diagram.direction).toBe('TB');
    expect([...diagram.nodes.keys()]).toEqual(['A', 'B', 'C', 'D', 'X', 'Y', 'Z']);
    expect(diagram.nodes.get('A')).toMatchObject({
      shape: 'stadium',
      label: 'Anfrage',
      group: null,
    });
    expect(diagram.nodes.get('B')!.shape).toBe('rhombus');
    expect(diagram.nodes.get('X')!.group).toBe('G');
    expect(diagram.nodes.get('D')!.look.fill).toBe('#f00');
    expect(diagram.edges.map((edge) => `${edge.from}>${edge.to}:${edge.label}`)).toEqual([
      'A>B:',
      'B>C:Ja',
      'B>D:Nein',
      'D>C:',
      'X>Y:',
      'C>Z:',
      'D>Z:',
    ]);
    expect(diagram.groups.get('G')!.label).toBe('Gruppe');
    // A mistake says where, in German.
    expect(parseDiagram('flowchart TD\n  A[offen --> B')).toMatchObject({ line: 1 });
    expect(parseDiagram('pie\n  "a": 1')).toMatchObject({ line: 0 });

    // Turned into a diagram file: groups as frames holding their boxes, shapes as near as there
    // are, arrows with their words, all laid out top to bottom.
    const file = diagramFromMermaid(diagram);
    const box = (id: string) => file.nodes.find((node) => node.id === id)!;
    expect(file.nodes.map((node) => node.id).sort()).toEqual(
      ['A', 'B', 'C', 'D', 'X', 'Y', 'Z', 'group-G'].sort(),
    );
    expect(box('group-G')).toMatchObject({ shape: 'frame', text: 'Gruppe' });
    expect(box('X').parent).toBe('group-G');
    expect(box('A').shape).toBe('pill');
    expect(box('B')).toMatchObject({ shape: 'rhombus', text: 'Kunde bekannt?' });
    expect(box('D').color).toBe('#ff0000');
    expect(file.edges).toHaveLength(7);
    expect(file.edges.find((edge) => edge.from === 'B' && edge.to === 'C')!.label).toBe('Ja');
    expect(box('C').y).toBeGreaterThan(box('A').y);
    expect(diagramFromMermaid(diagramOf('flowchart LR\n  A --> B')).direction).toBe('LR');

    // An arrow to a group goes to its frame; a box named as a group's frame would be, and an id
    // longer than the file holds, each get an id of their own – nothing is dropped or refused.
    const long = 'L'.repeat(70);
    const tricky = diagramFromMermaid(
      diagramOf(
        `flowchart TD\n  subgraph A [Gruppe]\n    X --> Y\n  end\n  S --> A\n  A --> Z\n  group-A[Kasten]\n  ${long} --> X`,
      ),
    );
    expect(tricky.nodes).toHaveLength(7);
    expect(tricky.nodes.every((node) => node.id.length <= 64)).toBe(true);
    expect(tricky.nodes.find((node) => node.text === 'Kasten')!.shape).not.toBe('frame');
    const frame = tricky.nodes.find((node) => node.shape === 'frame')!;
    expect(tricky.edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual(
      expect.arrayContaining([`S>${frame.id}`, `${frame.id}>Z`]),
    );
    expect(tricky.edges).toHaveLength(4);
  });

  it('lays boxes out as large as their words, frames apart, arrows from edge to edge', () => {
    const measure = (text: string, size: number) => text.length * size * 0.55;
    const placed = layoutDiagram(diagramOf(SOURCE), measure);
    expect(placed.nodes).toHaveLength(7);
    expect(placed.edges).toHaveLength(7);
    expect(placed.groups).toHaveLength(1);
    const box = (id: string) => placed.nodes.find((each) => each.node.id === id)!;
    // Top to bottom: each step under the one before.
    expect(box('B').y).toBeGreaterThan(box('A').y);
    expect(box('C').y).toBeGreaterThan(box('B').y);
    // A box fits its words.
    expect(box('C').width).toBeGreaterThanOrEqual(measure('Angebot', 14) + 32);
    // Its group's frame holds its boxes.
    const frame = placed.groups[0]!;
    for (const id of ['X', 'Y']) {
      expect(box(id).x - box(id).width / 2).toBeGreaterThanOrEqual(frame.x);
      expect(box(id).x + box(id).width / 2).toBeLessThanOrEqual(frame.x + frame.width);
    }
    // An arrow starts on its box's outline, not inside it.
    const first = placed.edges[0]!.points[0]!;
    expect(first.y).toBeCloseTo(box('A').y + box('A').height / 2, 0);
    // Everything in view.
    for (const each of placed.nodes) {
      expect(each.x - each.width / 2).toBeGreaterThanOrEqual(0);
      expect(each.x + each.width / 2).toBeLessThanOrEqual(placed.width);
      expect(each.y + each.height / 2).toBeLessThanOrEqual(placed.height);
    }
  });
});
