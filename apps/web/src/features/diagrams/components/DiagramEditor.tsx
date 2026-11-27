import '@xyflow/react/dist/base.css';
import './diagram.css';
import {
  applyDiagramChanges,
  cloudPaths,
  layoutDiagram,
  sizeFor,
  type Author,
  type Diagram,
  type DiagramOpened,
  type DiagramSide,
} from '@slider/shared';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
  ViewportPortal,
  type EdgeTypes,
  type NodeTypes,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { askDiagram, diagramKeys, useRenameCloudNode } from '@/lib/api';
import { apiDownload } from '@/lib/api-client';
import { isTextTarget } from '@/lib/dom';
import { isModKey } from '@/lib/keyboard';
import { isApplePlatform } from '@/lib/platform';
import { routes } from '@/lib/routes';
import {
  AvatarStack,
  Button,
  ContextMenu,
  GlassPanel,
  Icon,
  IconButton,
  Toast,
  Toolbar,
  ToolbarDivider,
  useToast,
  type MenuAction,
} from '@/ui';
import {
  addBox,
  addConnected,
  boxById,
  connect,
  copyOf,
  defaultRect,
  descendants,
  dropInFrames,
  frameAround,
  frameAt,
  pasteClip,
  readClip,
  rectIn,
  removeIds,
  updateArrows,
  updateBoxes,
  fitToText,
} from '../lib/edit';
import {
  edgesOf,
  facingSide,
  nodesOf,
  sidePoint,
  type ArrowEdge,
  type BoxNode,
  type Rect,
} from '../lib/flow';
import { historyReducer, startHistory } from '../lib/history';
import { snapRect, type Guide } from '../lib/snap';
import { DiagramSync, type DiagramSyncState } from '../lib/sync';
import { ArrowView } from './ArrowView';
import { BoxView } from './BoxView';
import { DiagramUiContext, type DiagramUi } from './context';
import { FormatBar } from './FormatBar';
import { TOOL_KEYS, type Tool } from '../lib/labels';
import { AskBar, Tools, ZoomControls } from './Tools';

const NODE_TYPES: NodeTypes = { box: BoxView, frame: BoxView };
const EDGE_TYPES: EdgeTypes = { arrow: ArrowView };
const FIT = { padding: 0.2, maxZoom: 1 } as const;

const SYNC_LABEL: Record<DiagramSyncState, string | null> = {
  saved: null,
  saving: null,
  offline: 'Offline',
  signedOut: 'Abgemeldet',
};

interface Connecting {
  from: string;
  side: DiagramSide;
  start: { x: number; y: number };
  at: { x: number; y: number };
  near: string | null;
  moved: boolean;
}

/** `/diagramm/:id` – the diagram, open: a canvas to draw on, saved as one draws. */
export function DiagramEditor({ opened, me }: { opened: DiagramOpened; me: Author }) {
  return (
    <ReactFlowProvider>
      <Editor opened={opened} me={me} />
    </ReactFlowProvider>
  );
}

function Editor({ opened }: { opened: DiagramOpened; me: Author }) {
  const { file } = opened;
  const id = file.id;
  const canEdit = file.canEdit;
  const navigate = useNavigate();
  const flow = useReactFlow<BoxNode, ArrowEdge>();
  const [toast, notify] = useToast();

  // ── What is drawn ─────────────────────────────────────────────────────────
  const [history, dispatch] = useReducer(historyReducer, opened.diagram, startHistory);
  const diagram = history.diagram;
  const latest = useRef(diagram);
  useLayoutEffect(() => {
    latest.current = diagram;
  }, [diagram]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const picked = useRef(selected);
  const select = useCallback((ids: Iterable<string>) => {
    const next = new Set(ids);
    picked.current = next;
    setSelected(next);
  }, []);
  /** A step done; `live`: one of many while dragging, a step once it ends. */
  const apply = useCallback((next: Diagram, live = false) => {
    if (next === latest.current) return;
    latest.current = next;
    dispatch({ type: live ? 'live' : 'commit', diagram: next });
  }, []);
  const end = useCallback(() => dispatch({ type: 'end' }), []);

  const [editing, setEditing] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [guides, setGuides] = useState<Guide[]>([]);
  const [dropFrame, setDropFrame] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<Connecting | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [asking, setAsking] = useState(false);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; actions: MenuAction[] } | null>(null);
  const [named, setNamed] = useState<string | null>(null);
  const busy = history.held !== null || connecting !== null || draft !== null;

  // ── Kept in step with the file ────────────────────────────────────────────
  const [sync, setSync] = useState<DiagramSyncState>('saved');
  const [people, setPeople] = useState<Author[]>([]);
  const syncer = useRef<DiagramSync | null>(null);
  const queryClient = useQueryClient();
  // The file as opened: the start, whatever the query holds later (each save is written there).
  const [start] = useState(opened);
  useEffect(() => {
    const keeper = new DiagramSync({
      diagramId: id,
      versionId: start.file.versionId,
      diagram: start.diagram,
      current: () => latest.current,
      onJoined: (base, theirs) => dispatch({ type: 'joined', base, theirs }),
      onState: setSync,
      onRefused: (message) => notify(message, 'danger'),
      onPeople: setPeople,
      onSaved: (versionId, saved) =>
        queryClient.setQueryData<DiagramOpened>(diagramKeys.diagram(id), (old) =>
          old ? { ...old, file: { ...old.file, versionId }, diagram: saved } : old,
        ),
    });
    syncer.current = keeper;
    keeper.listen();
    const leave = () => keeper.flush();
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      keeper.stop();
      syncer.current = null;
    };
  }, [id, start, notify, queryClient]);
  useEffect(() => {
    if (history.edits > 0 && canEdit) syncer.current?.changed();
  }, [history.edits, canEdit]);

  // ── The canvas's nodes and edges, drawn from the diagram ─────────────────
  const [nodeCache] = useState(() => new WeakMap());
  const [edgeCache] = useState(() => new WeakMap());
  const nodes = useMemo(() => nodesOf(diagram, selected, nodeCache), [diagram, selected, nodeCache]);
  const edges = useMemo(() => edgesOf(diagram, selected, edgeCache), [diagram, selected, edgeCache]);

  const onNodesChange = useCallback<OnNodesChange<BoxNode>>(
    (changeset) => {
      const changes = changeset.toArray();
      let next = latest.current;
      let sel: Set<string> | null = null;
      let ended = false;
      const dropped: string[] = [];
      // Helper lines: the box taken by the pointer snaps, the others move with it.
      let offset = { x: 0, y: 0 };
      const moves = changes.filter(
        (change) => change.type === 'position' && change.position && change.dragging,
      );
      const first = moves[0];
      if (first?.type === 'position' && first.position) {
        const box = boxById(next, first.id);
        if (box) {
          const frame = box.parent ? boxById(next, box.parent) : undefined;
          const origin = frame ? rectIn(next, frame) : { x: 0, y: 0 };
          const moving = {
            x: origin.x + first.position.x,
            y: origin.y + first.position.y,
            width: box.width,
            height: box.height,
          };
          const skip = new Set(moves.map((move) => move.type === 'position' ? move.id : ''));
          for (const each of [...skip]) for (const inner of descendants(next, each)) skip.add(inner);
          const others = next.nodes
            .filter((each) => !skip.has(each.id))
            .map((each) => rectIn(next, each));
          const snap = snapRect(moving, others, flow.getZoom());
          offset = { x: snap.dx, y: snap.dy };
          setGuides(snap.guides);
          // The frame it would land in, lit.
          const middle = {
            x: moving.x + offset.x + box.width / 2,
            y: moving.y + offset.y + box.height / 2,
          };
          const target = box.shape === 'frame' ? undefined : frameAt(next, middle, skip);
          setDropFrame(target && target.id !== box.parent ? target.id : null);
        }
      }
      for (const change of changes) {
        if (change.type === 'select') {
          sel ??= new Set(picked.current);
          if (change.selected) sel.add(change.id);
          else sel.delete(change.id);
        } else if (change.type === 'position') {
          const position = change.position;
          if (position) {
            const by = change.dragging ? offset : { x: 0, y: 0 };
            next = updateBoxes(next, new Set([change.id]), (box) => {
              const x = Math.round(position.x + by.x);
              const y = Math.round(position.y + by.y);
              return x === box.x && y === box.y ? box : { ...box, x, y };
            });
          }
          if (change.dragging === false) {
            ended = true;
            dropped.push(change.id);
          }
        } else if (change.type === 'dimensions' && change.resizing !== undefined && change.dimensions) {
          const { width, height } = change.dimensions;
          next = updateBoxes(next, new Set([change.id]), (box) => ({
            ...box,
            width: Math.round(width),
            height: Math.round(height),
          }));
          if (change.resizing === false) ended = true;
        }
      }
      if (dropped.length > 0) {
        next = dropInFrames(next, dropped);
        setGuides([]);
        setDropFrame(null);
      }
      apply(next, true);
      if (ended) end();
      if (sel) select(sel);
    },
    [apply, end, flow, select],
  );

  const onEdgesChange = useCallback<OnEdgesChange<ArrowEdge>>(
    (changeset) => {
      let sel: Set<string> | null = null;
      for (const change of changeset) {
        if (change.type !== 'select') continue;
        sel ??= new Set(picked.current);
        if (change.selected) sel.add(change.id);
        else sel.delete(change.id);
      }
      if (sel) select(sel);
    },
    [select],
  );

  // ── Words ─────────────────────────────────────────────────────────────────
  const commitText = useCallback(
    (target: string, text: string) => {
      setEditing((now) => (now === target ? null : now));
      const now = latest.current;
      const box = boxById(now, target);
      if (box) {
        // A text box left empty is gone, as in Figma.
        if (box.shape === 'text' && !text.trim()) {
          apply(removeIds(now, new Set([target])));
          select([]);
          return;
        }
        if (box.text !== text) {
          apply(updateBoxes(now, new Set([target]), (each) => fitToText({ ...each, text })));
        }
        return;
      }
      apply(
        updateArrows(now, new Set([target]), (arrow) => {
          if ((arrow.label ?? '') === text) return arrow;
          const { label: _label, ...rest } = arrow;
          return text.trim() ? { ...rest, label: text } : rest;
        }),
      );
    },
    [apply, select],
  );

  // ── Arrows drawn out of a box's port ──────────────────────────────────────
  const finishConnect = useCallback(
    (state: Connecting) => {
      const now = latest.current;
      if (!state.moved) {
        const added = addConnected(now, state.from, state.side);
        if (!added) return;
        apply(added.diagram);
        select([added.id]);
        setEditing(added.id);
        return;
      }
      if (state.near) {
        const joined = connect(now, state.from, state.near);
        apply(joined.diagram);
        if (joined.id) select([joined.id]);
        return;
      }
      // Let go on the empty canvas: a box like the first one there, joined to it.
      const from = boxById(now, state.from);
      if (!from) return;
      const shape = from.shape === 'text' ? 'rounded' : from.shape;
      const size = from.shape === 'text' ? sizeFor('rounded', '') : from;
      const added = addBox(
        now,
        shape,
        { x: state.at.x - size.width / 2, y: state.at.y - size.height / 2, width: size.width, height: size.height },
        { ...(from.color && { color: from.color }) },
      );
      const joined = connect(added.diagram, state.from, added.id);
      apply(joined.diagram);
      select([added.id]);
      setEditing(added.id);
    },
    [apply, select],
  );

  const startConnect = useCallback(
    (from: string, side: DiagramSide, event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const box = boxById(latest.current, from);
      if (!box) return;
      const begin = { x: event.clientX, y: event.clientY };
      const start = sidePoint(rectIn(latest.current, box), side);
      let state: Connecting = { from, side, start, at: start, near: null, moved: false };
      setConnecting(state);
      const targetAt = (x: number, y: number) => {
        for (const element of document.elementsFromPoint(x, y)) {
          const node = element.closest<HTMLElement>('.react-flow__node');
          const target = node?.dataset.id;
          if (!target || target === from) continue;
          const found = boxById(latest.current, target);
          if (found && found.shape !== 'frame') return target;
        }
        return null;
      };
      const move = (moved: PointerEvent) => {
        const far = state.moved || Math.hypot(moved.clientX - begin.x, moved.clientY - begin.y) > 4;
        state = {
          ...state,
          moved: far,
          at: flow.screenToFlowPosition({ x: moved.clientX, y: moved.clientY }),
          near: far ? targetAt(moved.clientX, moved.clientY) : null,
        };
        setConnecting(state);
      };
      const stop = (done: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
        setConnecting(null);
        if (done.type === 'pointerup') finishConnect(state);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
      window.addEventListener('pointercancel', stop);
    },
    [finishConnect, flow],
  );

  // ── Drawing a shape with its tool ─────────────────────────────────────────
  const onDrawStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || tool === 'select' || tool === 'hand') return;
    event.preventDefault();
    const shape = tool;
    const begin = { x: event.clientX, y: event.clientY };
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const rectFrom = (x: number, y: number): Rect => ({
      x: Math.min(begin.x, x),
      y: Math.min(begin.y, y),
      width: Math.abs(x - begin.x),
      height: Math.abs(y - begin.y),
    });
    const move = (moved: PointerEvent) => setDraft(rectFrom(moved.clientX, moved.clientY));
    const up = (done: PointerEvent) => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      setDraft(null);
      const drawn = rectFrom(done.clientX, done.clientY);
      const now = latest.current;
      let rect: Rect;
      if (drawn.width < 6 && drawn.height < 6) {
        rect = defaultRect(shape, flow.screenToFlowPosition(begin));
      } else {
        const a = flow.screenToFlowPosition({ x: drawn.x, y: drawn.y });
        const b = flow.screenToFlowPosition({ x: drawn.x + drawn.width, y: drawn.y + drawn.height });
        rect = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
      }
      const added = addBox(now, shape, rect);
      apply(added.diagram);
      select([added.id]);
      setTool('select');
      setEditing(added.id);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  // ── Doings ────────────────────────────────────────────────────────────────
  const remove = useCallback(() => {
    if (picked.current.size === 0) return;
    apply(removeIds(latest.current, picked.current));
    select([]);
  }, [apply, select]);
  const duplicate = useCallback(() => {
    const clip = copyOf(latest.current, picked.current);
    if (!clip) return;
    const pasted = pasteClip(latest.current, clip, { offset: { x: 24, y: 24 } });
    apply(pasted.diagram);
    select(pasted.ids);
  }, [apply, select]);
  const frameSelection = useCallback(() => {
    const framed = frameAround(latest.current, picked.current);
    if (!framed) return;
    apply(framed.diagram);
    select([framed.id]);
    setEditing(framed.id);
  }, [apply, select]);
  const fit = useCallback(() => void flow.fitView({ ...FIT, duration: 250 }), [flow]);
  const tidy = useCallback(() => {
    apply(layoutDiagram(latest.current));
    requestAnimationFrame(fit);
  }, [apply, fit]);

  const ask = useCallback(
    async (prompt: string) => {
      const before = latest.current;
      const answer = await askDiagram(id, {
        prompt,
        diagram: before,
        picked: [...picked.current],
      });
      const now = latest.current;
      const result = applyDiagramChanges(now, answer.changes, {
        tidy: answer.tidy,
        ...(answer.direction && { direction: answer.direction }),
      });
      if (answer.changes.length > 0) {
        apply(result.diagram);
        const touched = answer.changes
          .map((change) => (change as { id?: string }).id)
          .filter((each): each is string => Boolean(each && boxById(result.diagram, each)));
        select(touched);
        if (answer.tidy || now.nodes.length === 0) requestAnimationFrame(fit);
      }
      return answer.note;
    },
    [apply, fit, id, select],
  );

  // ── Keys ──────────────────────────────────────────────────────────────────
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isTextTarget(event.target)) return;
    if (event.target instanceof Element && event.target.closest('dialog, [data-popover-panel]')) return;
    const mod = isModKey(event);
    const key = event.key.toLowerCase();
    // A focused button or link takes its own Enter and space.
    if ((key === 'enter' || key === ' ') && event.target instanceof Element && event.target.closest('button, a, select')) return;
    const sel = picked.current;
    // Looking: always.
    if (event.shiftKey && !mod && event.code === 'Digit1') {
      event.preventDefault();
      fit();
      return;
    }
    if ((event.shiftKey && !mod && event.code === 'Digit0') || (mod && key === '0')) {
      event.preventDefault();
      void flow.zoomTo(1, { duration: 150 });
      return;
    }
    if (mod && (key === '=' || key === '+')) {
      event.preventDefault();
      void flow.zoomIn({ duration: 150 });
      return;
    }
    if (mod && key === '-') {
      event.preventDefault();
      void flow.zoomOut({ duration: 150 });
      return;
    }
    if (mod && key === 'a') {
      event.preventDefault();
      select([...latest.current.nodes.map((box) => box.id), ...latest.current.edges.map((arrow) => arrow.id)]);
      return;
    }
    if (key === 'escape') {
      if (menu) return;
      if (tool !== 'select') setTool('select');
      else select([]);
      return;
    }
    if (!canEdit) return;
    if (mod && key === 'z') {
      event.preventDefault();
      setEditing(null);
      dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      return;
    }
    if (mod && key === 'y') {
      event.preventDefault();
      dispatch({ type: 'redo' });
      return;
    }
    if (mod && key === 'd') {
      event.preventDefault();
      duplicate();
      return;
    }
    if (mod && event.altKey && event.code === 'KeyG') {
      event.preventDefault();
      frameSelection();
      return;
    }
    if (key === 'backspace' || key === 'delete') {
      event.preventDefault();
      remove();
      return;
    }
    if (key === 'enter' && sel.size === 1) {
      event.preventDefault();
      setEditing([...sel][0]!);
      return;
    }
    const nudge = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[key];
    if (nudge && sel.size > 0) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const now = latest.current;
      const moving = new Set(
        now.nodes.filter((box) => sel.has(box.id) && !(box.parent && sel.has(box.parent))).map((box) => box.id),
      );
      apply(updateBoxes(now, moving, (box) => ({ ...box, x: box.x + nudge[0]! * step, y: box.y + nudge[1]! * step })));
      return;
    }
    if (!mod && !event.altKey && TOOL_KEYS[key]) {
      event.preventDefault();
      setTool(TOOL_KEYS[key]);
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // Copy, cut and paste: through the clipboard, so a diagram takes what another one gave.
  const lastPaste = useRef({ text: '', times: 0 });
  const onClipboard = useEffectEvent((event: ClipboardEvent) => {
    if (isTextTarget(event.target) || isTextTarget(document.activeElement)) return;
    const now = latest.current;
    if (event.type === 'paste') {
      if (!canEdit) return;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      const clip = readClip(text);
      if (!clip && !text.trim()) return;
      event.preventDefault();
      if (clip) {
        const times = lastPaste.current.text === text ? lastPaste.current.times + 1 : 1;
        lastPaste.current = { text, times };
        const pasted = pasteClip(now, clip, { offset: { x: 24 * times, y: 24 * times } });
        apply(pasted.diagram);
        select(pasted.ids);
        return;
      }
      // Words from elsewhere: a box with them, in the middle of the view.
      const words = text.trim().slice(0, 4_000);
      const middle = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      const size = sizeFor('rounded', words);
      const added = addBox(now, 'rounded', { x: middle.x - size.width / 2, y: middle.y - size.height / 2, ...size }, { text: words });
      apply(added.diagram);
      select([added.id]);
      return;
    }
    const clip = copyOf(now, picked.current);
    if (!clip) return;
    event.preventDefault();
    const text = JSON.stringify(clip);
    event.clipboardData?.setData('text/plain', text);
    lastPaste.current = { text, times: 0 };
    if (event.type === 'cut' && canEdit) remove();
  });
  useEffect(() => {
    const listener = (event: ClipboardEvent) => onClipboard(event);
    document.addEventListener('copy', listener);
    document.addEventListener('cut', listener);
    document.addEventListener('paste', listener);
    return () => {
      document.removeEventListener('copy', listener);
      document.removeEventListener('cut', listener);
      document.removeEventListener('paste', listener);
    };
  }, []);

  // ── Right click ───────────────────────────────────────────────────────────
  const mod = isApplePlatform() ? '⌘' : 'Strg ';
  const openMenu = (event: ReactMouseEvent | MouseEvent, target?: string) => {
    event.preventDefault();
    if (!canEdit) return;
    if (target && !picked.current.has(target)) select([target]);
    const any = target !== undefined || picked.current.size > 0;
    const actions: MenuAction[] = any
      ? [
          ...(target && boxById(latest.current, target)
            ? [{ label: 'Text bearbeiten', icon: 'edit' as const, onSelect: () => setEditing(target) }]
            : []),
          { label: 'Duplizieren', icon: 'contentCopy', onSelect: duplicate },
          { label: 'In Rahmen setzen', icon: 'group', onSelect: frameSelection },
          { label: 'Löschen', icon: 'delete', tone: 'danger', divider: true, onSelect: remove },
        ]
      : [
          { label: 'Aufräumen', icon: 'autoFixHigh', onSelect: tidy },
          { label: 'Alles zeigen', icon: 'fitSize', onSelect: fit },
        ];
    setMenu({ at: { x: event.clientX, y: event.clientY }, actions });
  };

  // ── The others ────────────────────────────────────────────────────────────
  const rename = useRenameCloudNode(file.workspaceId);
  const title = named ?? file.title;
  const commitName = (next: string) => {
    const clean = next.trim();
    if (!clean || clean === title) return;
    setNamed(clean);
    rename.mutate(
      { id, name: `${clean}.diagram` },
      {
        onError: (error) => {
          setNamed(null);
          notify(error.message, 'danger');
        },
      },
    );
  };
  const download = () =>
    void apiDownload(cloudPaths.content(id, null, true), `${title}.diagram`).catch((error: unknown) =>
      notify(error instanceof Error ? error.message : 'Download fehlgeschlagen', 'danger'),
    );
  const close = () => {
    syncer.current?.flush();
    if (window.history.length > 1) void navigate(-1);
    else void navigate(routes.cloud(file.workspaceId));
  };

  const ui = useMemo<DiagramUi>(
    () => ({
      canEdit,
      editing,
      edit: setEditing,
      commitText,
      startConnect,
      dropFrame,
      near: connecting?.near ?? null,
      single: selected.size === 1 ? [...selected][0]! : null,
      busy,
    }),
    [busy, canEdit, commitText, connecting?.near, dropFrame, editing, selected, startConnect],
  );

  // Where a drawn arrow ends: at the facing side of the box it would join, else the pointer.
  const preview = (() => {
    if (!connecting?.moved) return null;
    const target = connecting.near ? boxById(diagram, connecting.near) : undefined;
    const from = boxById(diagram, connecting.from);
    if (!from) return null;
    const fromRect = rectIn(diagram, from);
    if (target) {
      const toRect = rectIn(diagram, target);
      const start = sidePoint(fromRect, facingSide(fromRect, toRect));
      const stop = sidePoint(toRect, facingSide(toRect, fromRect));
      return { start, stop };
    }
    return { start: connecting.start, stop: connecting.at };
  })();

  const label = SYNC_LABEL[sync];
  const drawing = tool !== 'select' && tool !== 'hand';

  return (
    <DiagramUiContext.Provider value={ui}>
      <div className="fixed inset-0 bg-canvas">
        <ReactFlow<BoxNode, ArrowEdge>
          className="dg-flow"
          data-tool={tool}
          data-busy={busy || undefined}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          zIndexMode="manual"
          elevateNodesOnSelect={false}
          elevateEdgesOnSelect={false}
          nodesDraggable={canEdit && tool === 'select' && !editing}
          nodesConnectable={false}
          elementsSelectable={tool !== 'hand'}
          selectionOnDrag={tool === 'select'}
          selectionMode={SelectionMode.Partial}
          panOnDrag={tool === 'hand' ? true : [1, 2]}
          multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
          deleteKeyCode={null}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          zoomActivationKeyCode={['Meta', 'Control']}
          zoomOnDoubleClick={false}
          nodeDragThreshold={2}
          minZoom={0.1}
          maxZoom={4}
          fitView
          fitViewOptions={FIT}
          proOptions={{ hideAttribution: true }}
          onNodeDoubleClick={(_, node) => canEdit && setEditing(node.id)}
          onEdgeDoubleClick={(_, edge) => canEdit && setEditing(edge.id)}
          onNodeContextMenu={(event, node) => openMenu(event, node.id)}
          onEdgeContextMenu={(event, edge) => openMenu(event, edge.id)}
          onSelectionContextMenu={(event) => openMenu(event)}
          onPaneContextMenu={(event) => {
            select([]);
            openMenu(event);
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} />
          <ViewportPortal>
            {(guides.length > 0 || preview) && (
              <svg className="dg-guides" width={1} height={1}>
                {guides.map((guide, index) =>
                  guide.axis === 'x' ? (
                    <line key={index} x1={guide.at} x2={guide.at} y1={guide.from - 8} y2={guide.to + 8} />
                  ) : (
                    <line key={index} y1={guide.at} y2={guide.at} x1={guide.from - 8} x2={guide.to + 8} />
                  ),
                )}
                {preview && (
                  <line
                    className="dg-arrow-preview"
                    x1={preview.start.x}
                    y1={preview.start.y}
                    x2={preview.stop.x}
                    y2={preview.stop.y}
                  />
                )}
              </svg>
            )}
          </ViewportPortal>
          {drawing && canEdit && <div className="dg-draw" onPointerDown={onDrawStart} />}
        </ReactFlow>

        {draft && (
          <div
            className="dg-draft fixed"
            style={{ left: draft.x, top: draft.y, width: draft.width, height: draft.height }}
          />
        )}

        {diagram.nodes.length === 0 && canEdit && !drawing && (
          <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
            <p className="max-w-80 text-center text-body text-fg-subtle">
              Wähle unten eine Form und zieh sie auf – oder sag der KI, was entstehen soll.
            </p>
          </div>
        )}

        {canEdit && !busy && !editing && selected.size > 0 && (
          <FormatBar
            diagram={diagram}
            selected={selected}
            onChange={apply}
            onEnd={end}
            onDelete={remove}
            onFrame={frameSelection}
          />
        )}

        {/* The file: its name, typed into where it stands. */}
        <div className="fixed top-3 left-3 z-(--z-chrome)">
          <GlassPanel className="flex h-10 items-center gap-2 pr-3 pl-2.5">
            <Icon name="accountTree" size={18} className="text-accent-blue" />
            {canEdit ? (
              <input
                key={title}
                defaultValue={title}
                aria-label="Name des Diagramms"
                placeholder="Ohne Titel"
                className="field-sizing-content max-w-[50vw] min-w-24 bg-transparent text-body text-fg outline-none placeholder:text-fg-faint"
                onBlur={(event) => commitName(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'Escape') {
                    event.preventDefault();
                    if (event.key === 'Escape') event.currentTarget.value = title;
                    event.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <span className="text-body text-fg">{title}</span>
            )}
          </GlassPanel>
        </div>

        <div className="fixed top-3 right-3 z-(--z-chrome) flex items-center gap-2">
          {people.length > 0 && <AvatarStack authors={people} size={24} interactive />}
          {(!canEdit || label) && (
            <span role="status" className="px-1 text-caption text-fg-subtle">
              {canEdit ? label : 'Nur ansehen'}
            </span>
          )}
          {sync === 'signedOut' && (
            <Button size="sm" onClick={() => void navigate(routes.login(window.location.pathname))}>
              Anmelden
            </Button>
          )}
          <Toolbar role={false}>
            {canEdit && (
              <>
                <IconButton
                  icon="undo"
                  label="Rückgängig"
                  title={`Rückgängig (${mod}Z)`}
                  size="sm"
                  disabled={history.past.length === 0}
                  onClick={() => dispatch({ type: 'undo' })}
                />
                <IconButton
                  icon="redo"
                  label="Wiederholen"
                  title={`Wiederholen (⇧${mod}Z)`}
                  size="sm"
                  disabled={history.future.length === 0}
                  onClick={() => dispatch({ type: 'redo' })}
                />
                <ToolbarDivider />
              </>
            )}
            <IconButton icon="download" label="Herunterladen" size="sm" onClick={download} />
            <ToolbarDivider />
            <IconButton icon="close" label="Diagramm schließen" size="sm" onClick={close} />
          </Toolbar>
        </div>

        {canEdit && (
          <div className="fixed bottom-4 left-1/2 z-(--z-chrome) flex -translate-x-1/2 flex-col items-center gap-2">
            {asking && <AskBar picked={selected.size} onAsk={ask} onClose={() => setAsking(false)} />}
            <Tools tool={tool} onTool={setTool} asking={asking} onAsk={() => setAsking((on) => !on)} onTidy={tidy} />
          </div>
        )}
        <div className="fixed right-3 bottom-4 z-(--z-chrome) max-sm:hidden">
          <ZoomControls />
        </div>

        {menu && (
          <ContextMenu label="Diagramm" actions={menu.actions} at={menu.at} onClose={() => setMenu(null)} />
        )}
        <Toast toast={toast} />
      </div>
    </DiagramUiContext.Provider>
  );
}
