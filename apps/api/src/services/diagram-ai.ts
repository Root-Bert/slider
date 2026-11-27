import {
  DIAGRAM_DIRECTIONS,
  DIAGRAM_ENDS,
  DIAGRAM_LINES,
  DIAGRAM_SHAPES,
  DIAGRAM_TINTS,
} from '@slider/shared';

/*
 * How an AI draws a diagram file (`.diagram`, `packages/shared/src/diagram.ts`) – said the same to
 * every AI that does: the diagram's own „Was soll sich ändern?“, the Cloud chat, the agents, the AI
 * apps over MCP. It changes boxes and arrows by name; where they go is the canvas's (new boxes are
 * placed by what they come from, `tidy` lays all out anew).
 */

const BOX_SHAPES = DIAGRAM_SHAPES.filter((shape) => shape !== 'frame');

/** What each change is, said once – the tools' descriptions and the editor's prompt share it. */
export const DIAGRAM_GUIDE = [
  'A diagram is boxes and arrows on a canvas; you change it by name with a list of changes,',
  'applied in order. add_box {id, text, shape?, color?, frame?} – ids are short words you make',
  'up (e.g. "bill", "check_paid"), text is what the box says (short – a few words; a new line',
  `with \\n). Shapes: ${BOX_SHAPES.join(', ')} – rounded is the default step, pill a start or`,
  'end, rhombus a question/decision, cylinder a database or store, document a file or report,',
  'parallelogram input/output, hexagon a preparation or system, ellipse a state or event, note',
  'a remark, text words without a box. add_frame {id, text, color?, frame?} is a group (a team,',
  'a system, a phase) that boxes lie in; put a box in it with frame: its id (frames may lie in',
  'frames). change_box {id, text?, shape?, color?, frame?} – color null takes the colour away,',
  'frame null takes it out of its frame. delete_box {id} also deletes its arrows; a frame',
  'deleted leaves its boxes where they are. connect {from, to, label?, line?, end?, start?} –',
  `label is the arrow's words ("Ja", "Nein", "sendet"), line ${DIAGRAM_LINES.join('/')},`,
  `end/start ${DIAGRAM_ENDS.join('/')} (default: an arrowhead at the end only; end none is a`,
  'plain line, start arrow makes it two-way). change_arrow {from, to, …} and disconnect',
  `{from, to} name an arrow by its boxes. Colours: ${DIAGRAM_TINTS.join(', ')} – use few, each`,
  'with one meaning (e.g. a team or a state), not every box coloured; #rrggbb only when a colour',
  'is asked for exactly. New boxes are placed next to what they are connected from; tidy: true',
  `lays the whole diagram out anew (direction ${DIAGRAM_DIRECTIONS.join(' top-down or ')} left-right)`,
  '– use it for a new diagram or a big change, not for a small one (people placed the boxes).',
  'Keep one diagram to about 30 boxes; a flow reads from its start to its end along the',
  'direction; decisions have their answers on the arrows.',
].join(' ');

/** The JSON Schema of one change – flat (one object, `type` says which), as models write best. */
export const DIAGRAM_CHANGE_JSON = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: [
        'add_box',
        'add_frame',
        'change_box',
        'delete_box',
        'connect',
        'change_arrow',
        'disconnect',
      ],
    },
    id: { type: 'string', description: 'The box or frame (add_*, change_box, delete_box).' },
    text: { type: 'string', description: 'What the box says, or the frame is called.' },
    shape: { type: 'string', enum: BOX_SHAPES },
    color: {
      type: ['string', 'null'],
      description: `${DIAGRAM_TINTS.join(', ')} or #rrggbb; null takes it away (change_box).`,
    },
    frame: {
      type: ['string', 'null'],
      description: 'The frame it lies in; null takes it out (change_box).',
    },
    from: { type: 'string', description: 'The box an arrow comes from.' },
    to: { type: 'string', description: 'The box an arrow goes to.' },
    label: { type: 'string', description: "The arrow's words." },
    line: { type: 'string', enum: [...DIAGRAM_LINES] },
    end: { type: 'string', enum: [...DIAGRAM_ENDS] },
    start: { type: 'string', enum: [...DIAGRAM_ENDS] },
  },
  required: ['type'],
} as const;

export const DIAGRAM_CHANGES_JSON = {
  type: 'array',
  items: DIAGRAM_CHANGE_JSON,
  description: 'The changes, in order.',
} as const;

/** The tool the editor's „Was soll sich ändern?“ answers with – one call, nothing else. */
export const DIAGRAM_ANSWER_TOOL = {
  name: 'change_diagram',
  description: 'Change the diagram as asked.',
  input_schema: {
    type: 'object' as const,
    properties: {
      changes: DIAGRAM_CHANGES_JSON,
      tidy: {
        type: 'boolean',
        description: 'Lay the whole diagram out anew afterwards (a new diagram, a big change).',
      },
      direction: {
        type: 'string',
        enum: [...DIAGRAM_DIRECTIONS],
        description: 'With tidy: TB top-down, LR left-right.',
      },
      note: {
        type: 'string',
        description:
          "One short sentence in the person's language: what you changed – or why you changed nothing.",
      },
    },
    required: ['changes', 'tidy', 'note'],
  },
};

export const DIAGRAM_ANSWER_SYSTEM = [
  'You change a diagram in Slider Cloud, as the person asks – in their language (box texts in',
  'the language of the diagram, or of the request when it is empty). Answer only with the',
  'change_diagram tool. Change what is asked and nothing else; keep ids that exist. When asked',
  'for a new diagram on an empty canvas, draw it whole and tidy it. „this“/„das hier“ means the',
  'picked boxes when some are named as picked.',
  DIAGRAM_GUIDE,
].join('\n\n');
