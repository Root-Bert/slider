import { describe, expect, it } from 'vitest';
import {
  absolutePosition,
  applyDiagramChanges,
  describeDiagram,
  emptyDiagram,
  FRAME_PAD,
  FRAME_TITLE,
  layoutDiagram,
  readDiagram,
  sizeFor,
  writeDiagram,
  type Diagram,
  type DiagramNode,
} from './diagram';

const box = (diagram: Diagram, id: string) => diagram.nodes.find((node) => node.id === id)!;
const overlap = (a: DiagramNode, b: DiagramNode) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

describe('diagram files', () => {
  it('reads and writes the file, changes by name, places new boxes and tidies frames apart', () => {
    // An empty file is an empty diagram; anything not a diagram is none.
    expect(readDiagram('')).toEqual(emptyDiagram());
    expect(readDiagram('{"nope":1}')).toBeNull();
    expect(readDiagram('not json')).toBeNull();

    // Made whole on reading: a frame before its boxes, an arrow to nowhere gone, ids once.
    const messy = readDiagram(
      JSON.stringify({
        format: 'slider-diagram',
        version: 1,
        nodes: [
          { id: 'a', shape: 'rect', x: 10, y: 10, width: 100, height: 50, text: 'A', parent: 'f' },
          { id: 'f', shape: 'frame', x: 0, y: 0, width: 300, height: 200, text: 'Gruppe' },
          { id: 'a', shape: 'rect', x: 0, y: 0, width: 10, height: 10, text: 'twice' },
          { id: 'b', shape: 'rect', x: 0, y: 0, width: 100, height: 50, text: 'B', parent: 'a' },
        ],
        edges: [
          { id: 'e1', from: 'a', to: 'b' },
          { id: 'e2', from: 'a', to: 'gone' },
        ],
      }),
    )!;
    expect(messy.nodes.map((node) => node.id)).toEqual(['f', 'b', 'a']);
    expect(box(messy, 'b').parent).toBeUndefined(); // a box is no frame
    expect(messy.edges.map((edge) => edge.id)).toEqual(['e1']);
    // Written one box a line, and read back the same.
    const text = writeDiagram(messy);
    expect(text.split('\n').filter((line) => line.startsWith('    {'))).toHaveLength(4);
    expect(readDiagram(text)).toEqual(messy);

    // A box fits its words: longer words, wider box; a diamond needs more room than a box.
    expect(sizeFor('rect', 'Rechnung schreiben').width).toBeGreaterThan(sizeFor('rect', 'A').width);
    expect(sizeFor('rhombus', 'Kunde bekannt?').width).toBeGreaterThan(
      sizeFor('rect', 'Kunde bekannt?').width,
    );

    // The AI's changes by name: boxes, a frame, arrows; mistakes said, the rest done.
    const made = applyDiagramChanges(emptyDiagram(), [
      { type: 'add_box', id: 'start', text: 'Anfrage', shape: 'pill' },
      { type: 'add_box', id: 'check', text: 'Kunde bekannt?', shape: 'rhombus' },
      { type: 'connect', from: 'start', to: 'check' },
      { type: 'add_frame', id: 'buch', text: 'Buchhaltung', color: 'blue' },
      { type: 'add_box', id: 'bill', text: 'Rechnung', frame: 'buch' },
      { type: 'add_box', id: 'pay', text: 'Bezahlt?', shape: 'rhombus', frame: 'buch' },
      { type: 'connect', from: 'check', to: 'bill', label: 'Ja' },
      { type: 'connect', from: 'bill', to: 'pay' },
      { type: 'connect', from: 'pay', to: 'bill', label: 'Nein', line: 'dashed' },
      { type: 'connect', from: 'start', to: 'nowhere' },
      { type: 'add_box', id: 'start', text: 'again' },
    ]);
    expect(made.problems).toHaveLength(2);
    const drawn = made.diagram;
    expect(drawn.nodes.map((node) => node.id)).toEqual(['start', 'check', 'buch', 'bill', 'pay']);
    expect(box(drawn, 'bill').parent).toBe('buch');
    expect(drawn.edges.find((edge) => edge.label === 'Nein')).toMatchObject({ line: 'dashed' });
    // Placed next to what they come from, nothing on top of each other; a frame holds its boxes.
    expect(box(drawn, 'check').y).toBeGreaterThan(
      box(drawn, 'start').y + box(drawn, 'start').height,
    );
    expect(box(drawn, 'pay').y).toBeGreaterThan(box(drawn, 'bill').y);
    const frame = box(drawn, 'buch');
    for (const id of ['bill', 'pay']) {
      expect(box(drawn, id).x).toBeGreaterThanOrEqual(0);
      expect(box(drawn, id).x + box(drawn, id).width).toBeLessThanOrEqual(frame.width);
      expect(box(drawn, id).y + box(drawn, id).height).toBeLessThanOrEqual(frame.height);
    }
    expect(overlap(box(drawn, 'start'), box(drawn, 'check'))).toBe(false);
    // Read by the AI by name, without positions.
    const read = describeDiagram(drawn);
    expect(read).toContain('{"id":"bill","shape":"rounded","text":"Rechnung","in":"buch"}');
    expect(read).toContain('{"from":"pay","to":"bill","label":"Nein","line":"dashed"}');
    expect(read).not.toContain('"x"');

    // Changed, moved out of its frame where it stands, deleted with its arrows.
    const changed = applyDiagramChanges(drawn, [
      { type: 'change_box', id: 'check', text: 'Kunde schon bekannt?', color: 'yellow' },
      { type: 'change_arrow', from: 'check', to: 'bill', label: 'Ja, schon' },
      { type: 'change_box', id: 'pay', frame: null },
      { type: 'delete_box', id: 'start' },
    ]).diagram;
    expect(box(changed, 'check')).toMatchObject({ text: 'Kunde schon bekannt?', color: 'yellow' });
    expect(changed.edges.find((edge) => edge.from === 'check')!.label).toBe('Ja, schon');
    expect(box(changed, 'pay').parent).toBeUndefined();
    expect(box(changed, 'pay')).toMatchObject(absolutePosition(drawn.nodes, box(drawn, 'pay')));
    expect(changed.edges.some((edge) => edge.from === 'start')).toBe(false);
    // A frame deleted: its boxes stay where they are on the canvas.
    const unframed = applyDiagramChanges(drawn, [{ type: 'delete_box', id: 'buch' }]).diagram;
    expect(box(unframed, 'bill')).toMatchObject(absolutePosition(drawn.nodes, box(drawn, 'bill')));

    // „Aufräumen“: rows along the direction, frames as blocks – no box in a frame not its own.
    const tidy = layoutDiagram(
      applyDiagramChanges(drawn, [
        { type: 'add_frame', id: 'side', text: 'Andere' },
        { type: 'add_box', id: 'x', text: 'X', frame: 'side' },
        { type: 'connect', from: 'check', to: 'x' },
      ]).diagram,
      'LR',
    );
    expect(tidy.direction).toBe('LR');
    expect(box(tidy, 'check').x).toBeGreaterThan(box(tidy, 'start').x);
    expect(box(tidy, 'bill')).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(box(tidy, 'bill').y).toBeGreaterThanOrEqual(FRAME_TITLE);
    expect(box(tidy, 'bill').x).toBeGreaterThanOrEqual(FRAME_PAD);
    expect(overlap(box(tidy, 'buch'), box(tidy, 'side'))).toBe(false);
    for (const id of ['start', 'check']) {
      expect(overlap(box(tidy, id), box(tidy, 'buch'))).toBe(false);
      expect(overlap(box(tidy, id), box(tidy, 'side'))).toBe(false);
    }
  });
});
