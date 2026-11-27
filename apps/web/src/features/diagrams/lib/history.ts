import { mergeDiagrams, type Diagram } from '@slider/shared';

/*
 * What is drawn and the steps back through it (⌘Z, ⇧⌘Z). A drag or a resize changes the diagram
 * live without a step; letting go makes it one (`end`). Someone else's save is joined into the
 * diagram and into every step – ⌘Z takes back one's own changes, never theirs.
 */

const MAX_STEPS = 200;

export interface DiagramHistory {
  diagram: Diagram;
  past: Diagram[];
  future: Diagram[];
  /** The diagram before a drag began: one step once it is let go. */
  held: Diagram | null;
  /** Counts one's own changes: each is to be saved. */
  edits: number;
}

export type HistoryAction =
  /** A change as it happens (a box being dragged): no step yet. */
  | { type: 'live'; diagram: Diagram }
  /** A change done: one step. */
  | { type: 'commit'; diagram: Diagram }
  /** What was live becomes one step. */
  | { type: 'end' }
  | { type: 'undo' }
  | { type: 'redo' }
  /** Someone else's diagram, saved on `base`: joined in, also into the steps. No edit of one's own. */
  | { type: 'joined'; base: Diagram; theirs: Diagram };

export const startHistory = (diagram: Diagram): DiagramHistory => ({
  diagram,
  past: [],
  future: [],
  held: null,
  edits: 0,
});

const capped = (steps: Diagram[]) =>
  steps.length > MAX_STEPS ? steps.slice(steps.length - MAX_STEPS) : steps;

export function historyReducer(state: DiagramHistory, action: HistoryAction): DiagramHistory {
  switch (action.type) {
    case 'live':
      if (action.diagram === state.diagram) return state;
      return {
        ...state,
        held: state.held ?? state.diagram,
        diagram: action.diagram,
        edits: state.edits + 1,
      };
    case 'commit': {
      if (action.diagram === state.diagram && !state.held) return state;
      const before = state.held ?? state.diagram;
      return {
        diagram: action.diagram,
        past: capped([...state.past, before]),
        future: [],
        held: null,
        edits: state.edits + 1,
      };
    }
    case 'end':
      if (!state.held) return state;
      if (state.held === state.diagram) return { ...state, held: null };
      return {
        ...state,
        past: capped([...state.past, state.held]),
        future: [],
        held: null,
      };
    case 'undo': {
      const before = state.past.at(-1);
      if (!before || state.held) return state;
      return {
        diagram: before,
        past: state.past.slice(0, -1),
        future: [state.diagram, ...state.future],
        held: null,
        edits: state.edits + 1,
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next || state.held) return state;
      return {
        diagram: next,
        past: [...state.past, state.diagram],
        future: state.future.slice(1),
        held: null,
        edits: state.edits + 1,
      };
    }
    case 'joined': {
      const join = (mine: Diagram) => mergeDiagrams(action.base, mine, action.theirs);
      return {
        ...state,
        diagram: join(state.diagram),
        past: state.past.map(join),
        future: state.future.map(join),
        held: state.held && join(state.held),
      };
    }
  }
}
