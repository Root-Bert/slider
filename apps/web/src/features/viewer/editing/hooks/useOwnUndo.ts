import type { EditableElement, SlideOperation } from '@slider/shared';
import { useRef, useState } from 'react';
import { useMe, useRevertEdit } from '@/lib/api';
import { OFFLINE_HINT } from '@/lib/offline';
import { useViewerToast } from '../../state/viewer-toast';
import { editOutbox } from '../edit-outbox-app';
import { newEditId } from '../new-id';
import { sendOutcome } from '../outbox';
import {
  changedSince,
  freshIds,
  renamed,
  renamedSnapshot,
  without,
  type Inverse,
  type Snapshot,
} from '../undo-ops';

/** Edits still on their way are waited for before the server takes a step back, at most this long. */
const WAIT_FOR_EDITS_MS = 10_000;

const REVERT_TAKEN_OVER =
  'Das lässt sich nicht mehr rückgängig machen – jemand anderes hat es inzwischen geändert.';

/** How many slides a take-back left as they are: someone else changed the same there. */
const revertPartlyMessage = (count: number) =>
  count === 1
    ? 'Eine Folie bleibt, wie sie ist – jemand anderes hat dort inzwischen dasselbe geändert.'
    : `${count} Folien bleiben, wie sie sind – jemand anderes hat dort inzwischen dasselbe geändert.`;

/** How many elements a take-back left as they are: someone else changed them since. */
const keptMessage = (count: number) =>
  count === 1
    ? 'Ein Element bleibt, wie es ist – jemand anderes hat es inzwischen geändert.'
    : `${count} Elemente bleiben, wie sie sind – jemand anderes hat sie inzwischen geändert.`;

type Direction = 'undo' | 'redo';

/**
 * One own edit to take back or do again. In the browser (`back`): its operations and their way
 * back, with the touched elements as they were before and after – sent like any edit, so at once
 * and offline too. Else by the server (`step`, the step it made – or, for a step taken back by
 * the server, the step that did): `revertChange`, online only.
 */
interface Entry {
  /** The outbox edit that made it (merged edits keep adding to it). */
  editId: string | null;
  step: number | null;
  forward: SlideOperation[];
  back: Inverse | null;
  before: Snapshot;
  after: Snapshot;
  /** Someone else's steps seen when it was made or last moved (`UndoHost.othersMark`). */
  mark: number;
}

interface Stacks {
  undo: readonly Entry[];
  redo: readonly Entry[];
}
const EMPTY: Stacks = { undo: [], redo: [] };

/** What undo needs of the editor: the elements as shown, and sending an edit like any other. */
export interface UndoHost {
  element: (elementId: string) => EditableElement | null | undefined;
  /** Shows and sends operations (bringing back deleted ones from `sources`); their outbox id. */
  send: (
    operations: SlideOperation[],
    sources: ReadonlyMap<string, EditableElement>,
  ) => string | null;
  /** How many of someone else's steps were seen so far – a mark for {@link touchedByOthers}. */
  othersMark?: () => number;
  /** Whether someone else's step changed the element after `mark` (exact, no rounding). */
  touchedByOthers?: (elementId: string, mark: number) => boolean;
}

export interface OwnUndo {
  canUndo: boolean;
  canRedo: boolean;
  /** A take-back by the server is on its way. */
  busy: boolean;
  undo: () => void;
  redo: () => void;
  /**
   * An own edit was shown and handed to the outbox (`editId`): the next to take back – with its
   * way back the browser worked out, `null` when only the server can. Nothing is to be done again.
   */
  edited: (
    editId: string,
    forward: SlideOperation[],
    back: Inverse | null,
    before: Snapshot,
    after: Snapshot,
  ) => void;
  /** The server took an edit: its step. One the editor did not record (left from before) is one. */
  taken: (editId: string, step: number) => void;
  /** The server refused an edit for good: nothing to take back of it. */
  refused: (editId: string) => void;
}

/**
 * Undo and redo of one's own edits (⌘Z / ⇧⌘Z). Taken back in the browser where it knows the way
 * back (most edits: boxes, looks, text, corners, crops, locks, adding and deleting elements, a
 * slide's notes, background, order …): at once, sent like any edit – offline too, queued. What
 * someone else changed since stays theirs: such an element is left out, told by a toast. Edits
 * without a way back in the browser go to the server (`revertChange`), as before: there, what
 * others changed since stays too, slide by slide. The stacks live in a ref (mirrored to state for
 * `canUndo`/`canRedo`), so two quick presses never take back the same step twice.
 */
export function useOwnUndo(deckId: string, offline: boolean, host: UndoHost): OwnUndo {
  const toast = useViewerToast();
  const revert = useRevertEdit(deckId);
  // Named with each take-back: refused once another account is signed in (`account_changed`).
  const userId = useMe().data?.user?.id;
  const stacksRef = useRef<Stacks>(EMPTY);
  // The id each server take-back went out under (by direction and step), until it was answered.
  const attemptsRef = useRef(new Map<string, string>());
  // Edits undo and redo sent themselves: the server's steps for them are no new own steps.
  const ownMovesRef = useRef(new Set<string>());
  const [stacks, setStacksState] = useState<Stacks>(EMPTY);
  // One server take-back at a time, from the press until its answer.
  const movingRef = useRef(false);
  const setStacks = (change: (current: Stacks) => Stacks) => {
    stacksRef.current = change(stacksRef.current);
    setStacksState(stacksRef.current);
  };
  /** Every entry left with the ids a restored element got. */
  const rename = (renames: ReadonlyMap<string, string>) => {
    if (renames.size === 0) return;
    const each = (entry: Entry): Entry => ({
      ...entry,
      forward: renamed(entry.forward, renames),
      back: entry.back && {
        operations: renamed(entry.back.operations, renames),
        sources: new Map(
          [...entry.back.sources].map(([id, element]) => {
            const to = renames.get(id);
            return [to ?? id, to ? { ...element, id: to } : element];
          }),
        ),
      },
      before: renamedSnapshot(entry.before, renames),
      after: renamedSnapshot(entry.after, renames),
    });
    setStacks(({ undo, redo }) => ({ undo: undo.map(each), redo: redo.map(each) }));
  };

  /** Taken back or done again in the browser: at once, sent through the outbox. */
  const moveHere = (direction: Direction, entry: Entry) => {
    const other: Direction = direction === 'undo' ? 'redo' : 'undo';
    const expected = direction === 'undo' ? entry.after : entry.before;
    const skipped = changedSince(expected, host.element);
    // Changed by someone else since, however little: left out too.
    for (const id of expected.keys()) if (host.touchedByOthers?.(id, entry.mark)) skipped.add(id);
    const planned = direction === 'undo' ? entry.back!.operations : entry.forward;
    const left = without(planned, skipped);
    setStacks((current) => ({
      ...current,
      [direction]: current[direction].filter((item) => item !== entry),
    }));
    if (left.length === 0 || skipped.size === expected.size) {
      toast(REVERT_TAKEN_OVER, 'danger');
      return;
    }
    const { operations, renames } = freshIds(left, newEditId);
    const sent = host.send(operations, entry.back!.sources);
    if (sent) ownMovesRef.current.add(sent);
    const moved = { ...entry, mark: host.othersMark?.() ?? 0 };
    setStacks((current) => ({ ...current, [other]: [...current[other], moved] }));
    rename(renames);
    if (skipped.size > 0) toast(keptMessage(skipped.size), 'danger');
  };

  /** Taken back by the server – edits still on their way first, so the last one is what goes. */
  const moveThere = async (direction: Direction, entry: Entry) => {
    if (offline) {
      toast(`Das lässt sich offline nicht rückgängig machen. ${OFFLINE_HINT}`, 'danger');
      return;
    }
    movingRef.current = true;
    let letEditsGo: (() => void) | null = null;
    try {
      letEditsGo = await editOutbox.holdWhenSettled(deckId, WAIT_FOR_EDITS_MS);
      if (!letEditsGo) {
        toast('Erst wenn alle Änderungen gespeichert sind.', 'neutral');
        return;
      }
      // Read again: waited for, it has its step now.
      const seq = stacksRef.current[direction].find((item) => item === entry)?.step;
      if (seq === null || seq === undefined) return;
      const other: Direction = direction === 'undo' ? 'redo' : 'undo';
      const taken = (step: number | null) =>
        setStacks((current) => ({
          ...current,
          [direction]: current[direction].filter((item) => item !== entry),
          ...(step !== null && {
            [other]: [
              ...current[other],
              { editId: null, step, forward: [], back: null, before: new Map(), after: new Map() },
            ],
          }),
        }));
      // Asked again after the answer got lost: under the same id, the server answers with the step
      // the first one made rather than finding nothing left to take back.
      const attempt = `${direction}:${seq}`;
      const clientEditId = attemptsRef.current.get(attempt) ?? crypto.randomUUID();
      attemptsRef.current.set(attempt, clientEditId);
      try {
        const answer = await revert.mutateAsync({ seq, clientEditId, userId });
        attemptsRef.current.delete(attempt);
        taken(answer.step);
        if (answer.step === null) toast(REVERT_TAKEN_OVER, 'danger');
        else if (answer.dropped > 0) toast(revertPartlyMessage(answer.dropped), 'danger');
      } catch (error) {
        // Refused for good (gone, not one's own): off the list; out of reach: tried again later.
        if (sendOutcome(error) === 'refused') {
          attemptsRef.current.delete(attempt);
          taken(null);
        }
        toast(error instanceof Error ? error.message : 'Das ging nicht.', 'danger');
      }
    } finally {
      // Its answer is in the query cache by now (`useEditAnswer`): the edits waiting go out on it.
      letEditsGo?.();
      movingRef.current = false;
    }
  };

  const move = (direction: Direction) => {
    if (movingRef.current) return;
    const entry = stacksRef.current[direction].at(-1);
    if (!entry) return;
    if (entry.back) moveHere(direction, entry);
    else void moveThere(direction, entry);
  };

  return {
    canUndo: stacks.undo.length > 0,
    canRedo: stacks.redo.length > 0,
    busy: revert.isPending,
    undo: () => move('undo'),
    redo: () => move('redo'),
    edited: (editId, forward, back, before, after) =>
      setStacks(({ undo }) => {
        const last = undo.at(-1);
        // Merged into the edit before (`coalesce`): one step still, from where that one began.
        if (last && last.editId === editId) {
          return {
            undo: [
              ...undo.slice(0, -1),
              { ...last, forward, after, mark: host.othersMark?.() ?? 0 },
            ],
            redo: [],
          };
        }
        const mark = host.othersMark?.() ?? 0;
        return {
          undo: [...undo, { editId, step: null, forward, back, before, after, mark }],
          redo: [],
        };
      }),
    taken: (editId, step) => {
      if (ownMovesRef.current.delete(editId)) return;
      const known = stacksRef.current.undo.some((entry) => entry.editId === editId);
      if (known) {
        setStacks((current) => ({
          ...current,
          undo: current.undo.map((entry) => (entry.editId === editId ? { ...entry, step } : entry)),
        }));
        return;
      }
      setStacks(({ undo }) => ({
        undo: [
          ...undo,
          { editId, step, forward: [], back: null, before: new Map(), after: new Map(), mark: 0 },
        ],
        redo: [],
      }));
    },
    refused: (editId) => {
      if (ownMovesRef.current.delete(editId)) return;
      setStacks(({ undo, redo }) => ({
        undo: undo.filter((entry) => entry.editId !== editId),
        redo,
      }));
    },
  };
}
