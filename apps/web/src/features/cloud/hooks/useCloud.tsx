import {
  createContext,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import {
  API_PREFIX,
  cloudAccessAtLeast,
  cloudExtension,
  cloudPaths,
  type CloudArea,
  type CloudHome,
  type CloudListing,
  type CloudNode,
  type Workspace,
} from '@slider/shared';
import {
  useCloudHome,
  cloudListQuery,
  useCopyCloudNodes,
  useCreateCloudFolder,
  useDeleteCloudArea,
  useColorCloudNode,
  useEmptyCloudTrash,
  usePresentCloudNode,
  useMoveCloudNodes,
  usePurgeCloudNodes,
  useRestoreCloudNodes,
  useRenameCloudNode,
  usePinCloudNode,
  useTrashCloudNodes,
  useMailAccounts,
} from '@/lib/api';
import { windowForApp } from '@/lib/apps';
import { CLOUD_EVENT_PARAM, CLOUD_FILE_PARAM, CLOUD_TODO_PARAM, routes } from '@/lib/routes';
import { useAccount } from '@/features/auth';
import { handToNewMail, NEW_MAIL } from '@/features/sender';
import { canCreateDecks } from '@/features/workspaces';
import { ConfirmDialog, TextField, type IconName, type MenuAction } from '@/ui';
import { AreaDialog } from '../components/AreaDialog';
import { askCloudChat } from '../components/CloudChat';
import { AreaPeopleDialog } from '../components/AreaPeopleDialog';
import { CloudToast, useCloudToast, type Notify } from '../components/CloudToast';
import type { FetchState } from '../components/Fetching';
import { FolderColorDialog } from '../components/FolderColorDialog';
import { DestinationDialog, type Destination } from '../components/DestinationDialog';
import { ShareDialog } from '../components/ShareDialog';
import { UploadTray } from '../components/UploadTray';
import { flyInto } from '../lib/fly';
import { appFor } from '../lib/kinds';
import {
  cloudBridge,
  fileManagerName,
  useComputerChanged,
  useOnThisComputer,
} from '../lib/computer';
import { carriedNodes, TAB_DROP_EVENT } from '../lib/drag';
import { pickFromDisk, type PickedFile, type UploadTarget } from '../lib/upload';
import { useUploads, type Uploads } from './useUploads';

/** Where something new goes; `name` is what the place is called, for messages. */
export interface CloudTarget extends UploadTarget {
  name: string;
}

type DialogState =
  | { kind: 'place'; nodes: CloudNode[]; copy: boolean }
  | { kind: 'share'; node: CloudNode }
  | { kind: 'color'; node: CloudNode }
  | { kind: 'purge'; nodes: CloudNode[] }
  | { kind: 'emptyTrash' }
  | { kind: 'area'; area?: CloudArea; parent?: CloudArea }
  | { kind: 'areaPeople'; area: CloudArea }
  | { kind: 'deleteArea'; area: CloudArea };

/** Everything a page of Cloud does with files – one behaviour on every page. */
export interface CloudUi {
  workspace: Workspace;
  userId: string;
  home: CloudHome | undefined;
  notify: Notify;
  uploads: Uploads;
  /** Where „Neu“ puts things: the open folder or area, else one's own files. */
  place: CloudTarget;
  setPlace: (place: CloudTarget | null) => void;
  /** What is being dragged inside the page – a folder or an area it is dropped on takes it. */
  dragged: () => readonly CloudNode[];
  setDragged: (nodes: readonly CloudNode[]) => void;
  /** Where its link leads: into the folder, or to the file's details beside this page. */
  hrefOf: (node: CloudNode) => string;
  /**
   * Opened where it belongs: a folder here, a presentation in Slider, any other file in its app
   * on the computer.
   */
  open: (node: CloudNode) => void;
  /**
   * Why „Öffnen“ has nowhere to open the file: none of the apps opens it, and the browser cannot
   * hand it to the computer's own app (Cloud's app can) – it is downloaded instead. `null`: it opens.
   */
  cannotOpen: (node: CloudNode) => string | null;
  /** The files „Öffnen“ is fetching right now, and those that just arrived – drawn on the file. */
  fetching: ReadonlyMap<string, FetchState>;
  /** „Details“: the panel beside the page. `replace`: in the history's place of the one before (↑/↓). */
  openFile: (nodeId: string, replace?: boolean) => void;
  /** The menu of one file or folder, or of several picked together. */
  actionsFor: (nodes: readonly CloudNode[]) => MenuAction[];
  share: (node: CloudNode) => void;
  /** „Umbenennen“: the name turns into a field where it stands – in the list, or over the open file. */
  rename: (node: CloudNode) => void;
  /** `fresh`: a folder just made – its field starts empty, the name it got as the hint. */
  renaming: { id: string; where: 'list' | 'preview'; fresh?: boolean } | null;
  /** The field is done: with `name` the new one (shown at once, a refusal toasts), else as it was. */
  endRename: (node?: CloudNode, name?: string) => void;
  moveTo: (nodes: readonly CloudNode[]) => void;
  /** Dropped onto a folder or an area: moved there at once. */
  moveInto: (nodes: readonly Pick<CloudNode, 'id'>[], destination: Destination) => void;
  /** Dropped here out of another page of the app (`lib/drag.ts`): what that drag carried. */
  takeFrom: (carried: string, destination: Destination) => void;
  /** A drag out of this page ended on another: the lists here ask again. */
  sentAway: () => void;
  trash: (nodes: readonly CloudNode[]) => void;
  /**
   * Deleted here a moment ago, until brought back – here, or elsewhere (another tab, an agent): a
   * fresh list has it again. No details are asked for or kept for them.
   */
  gone: { has: (id: string) => boolean };
  restore: (nodes: readonly CloudNode[]) => void;
  purge: (nodes: readonly CloudNode[]) => void;
  emptyTrash: () => void;
  download: (nodes: readonly CloudNode[]) => void;
  /**
   * The way to the computer beside „Öffnen“: in Cloud's app „Im Finder zeigen“ (every file and
   * folder lies there), in the browser „Herunterladen“; `null` for several in the app.
   */
  toComputer: (nodes: readonly CloudNode[]) => (MenuAction & { icon: IconName }) | null;
  /** Made at once as „Neuer Ordner“; where this page shows it, its name is a field right away. */
  newFolder: (target: CloudTarget) => void;
  /** „Aufräumen“: the AI tidies that place, in its chat. `null` for who only looks. */
  tidy: ((target: CloudTarget) => void) | null;
  upload: (files: readonly PickedFile[], target: CloudTarget) => void;
  pickAndUpload: (target: CloudTarget, folder?: boolean) => void;
  /** A file picked from the disk becomes the next version of `node`. */
  uploadVersion: (node: CloudNode) => void;
  /** A new area – under `parent`, when given. */
  newArea: (parent?: CloudArea) => void;
  editArea: (area: CloudArea) => void;
  areaPeople: (area: CloudArea) => void;
  deleteArea: (area: CloudArea) => void;
}

/** One's own files' top – where things go when no folder or area is open. */
export const OWN_FILES: CloudTarget = { name: 'Meine Dateien' };

const CloudContext = createContext<CloudUi | null>(null);

export function useCloud(): CloudUi {
  const ui = use(CloudContext);
  if (!ui) throw new Error('useCloud must be used below <CloudProvider>');
  return ui;
}

const named = (nodes: readonly CloudNode[], one: string, many: string) => {
  const [first] = nodes;
  return nodes.length === 1 && first
    ? `„${first.name}“ ${one}`
    : `${nodes.length} Elemente ${many}`;
};

/** A list fetched this long after a delete was asked after it too – one in flight then may not be. */
const GONE_SETTLE_MS = 2000;

const without = <T,>(map: ReadonlyMap<string, T>, ids: readonly string[]) =>
  new Map([...map].filter(([id]) => !ids.includes(id)));

/** What went through, and – when the server left some out – how many it did not and why. */
const withSkipped = (done: string, skipped: readonly { reason: string }[]) => {
  const [first] = skipped;
  return first ? `${done}, ${skipped.length} nicht: ${first.reason}` : done;
};

/** Saves a file through the browser's own download – it streams, shows progress and can resume. */
function saveFrom(path: string): void {
  const link = document.createElement('a');
  link.href = `${API_PREFIX}${path}`;
  link.download = '';
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

export function CloudProvider({
  workspace,
  children,
}: {
  workspace: Workspace;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  // Whether one has a mailbox here – „Per Mail senden“ then (as Cloud's „Mail“ asks it anyway).
  const hasMailbox = (useMailAccounts(workspace.id).data?.length ?? 0) > 0;
  const [, setSearchParams] = useSearchParams();
  const { user } = useAccount();
  const home = useCloudHome(workspace.id).data;
  const { toast, notify, dismiss } = useCloudToast();
  const uploads = useUploads(workspace.id);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [place, setPlace] = useState<CloudTarget | null>(null);
  const [renaming, setRenaming] = useState<CloudUi['renaming']>(null);
  // Each with when the server had it deleted (`null` while asked): only a list fetched later than
  // that tells it is back.
  const [gone, setGone] = useState<ReadonlyMap<string, number | null>>(() => new Map());
  const rename = useCallback((node: CloudNode) => {
    // A file open over the list: its name up there is the one in view.
    const open = new URLSearchParams(window.location.search).get(CLOUD_FILE_PARAM) === node.id;
    setRenaming({ id: node.id, where: open ? 'preview' : 'list' });
  }, []);
  const draggedNodes = useRef<readonly CloudNode[]>([]);
  const dragged = useCallback(() => draggedNodes.current, []);
  const setDragged = useCallback((nodes: readonly CloudNode[]) => {
    draggedNodes.current = nodes;
  }, []);
  const [confirmName, setConfirmName] = useState('');
  const close = () => {
    setDialog(null);
    setConfirmName('');
    // What a confirm dialog said went wrong is not the next one's.
    purgeNodes.reset();
    emptyTrashNow.reset();
    deleteAreaNow.reset();
  };

  const createFolder = useCreateCloudFolder(workspace.id);
  const renameNode = useRenameCloudNode(workspace.id);
  const pinNode = usePinCloudNode(workspace.id);
  const moveNodes = useMoveCloudNodes(workspace.id);
  const copyNodes = useCopyCloudNodes(workspace.id);
  const trashNodes = useTrashCloudNodes(workspace.id);
  const restoreNodes = useRestoreCloudNodes(workspace.id);
  const purgeNodes = usePurgeCloudNodes(workspace.id);
  const emptyTrashNow = useEmptyCloudTrash(workspace.id);
  const presentNode = usePresentCloudNode();
  const colorNode = useColorCloudNode(workspace.id);
  const deleteAreaNow = useDeleteCloudArea(workspace.id);

  const failed = useCallback((error: Error) => notify(error.message, 'danger'), [notify]);
  const client = useQueryClient();
  // Brought back elsewhere: a list or search fetched (not patched here) after it was deleted has
  // it again.
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual)
          return;
        const [root, id, kind] = event.query.queryKey as readonly unknown[];
        if (root !== 'cloud' || id !== workspace.id || (kind !== 'nodes' && kind !== 'search'))
          return;
        const listing = event.query.state.data as CloudListing | undefined;
        const fetched = event.query.state.dataUpdatedAt;
        const back = (listing?.nodes ?? []).filter((node) => !node.deleted).map((node) => node.id);
        if (back.length === 0) return;
        setGone((now) => {
          const ids = back.filter((each) => {
            const at = now.get(each);
            return at !== undefined && at !== null && fetched > at + GONE_SETTLE_MS;
          });
          return ids.length === 0 ? now : without(now, ids);
        });
      }),
    [client, workspace.id],
  );
  const computerChanged = useComputerChanged(workspace.id);
  const onComputer = useOnThisComputer(workspace.id);

  const openFile = useCallback(
    (nodeId: string, replace = false) =>
      setSearchParams(
        (params) => {
          const next = new URLSearchParams(params);
          next.set(CLOUD_FILE_PARAM, nodeId);
          // One panel beside the page: a to-do's or an event's makes way.
          next.delete(CLOUD_TODO_PARAM);
          next.delete(CLOUD_EVENT_PARAM);
          return next;
        },
        { replace },
      ),
    [setSearchParams],
  );
  const hrefOf = useCallback(
    (node: CloudNode) =>
      node.kind === 'folder'
        ? routes.cloudFolder(workspace.id, node.id)
        : `?${CLOUD_FILE_PARAM}=${encodeURIComponent(node.id)}`,
    [workspace.id],
  );
  // No message for a file on its way: the file itself shows it (`Fetching`).
  const [fetching, setFetching] = useState<ReadonlyMap<string, FetchState>>(new Map());
  const markFetch = useCallback((id: string, state: FetchState | null) => {
    const set = (to: FetchState | null) =>
      setFetching((now) => {
        const next = new Map(now);
        if (to) next.set(id, to);
        else next.delete(id);
        return next;
      });
    set(state);
    // Arrived: the tick stays a moment.
    if (state === 'done') setTimeout(() => set(null), 1100);
  }, []);
  const open = useCallback(
    (node: CloudNode) => {
      if (node.kind === 'folder') {
        // Its newest files peek out of it: they slide to where they lie inside.
        const to = routes.cloudFolder(workspace.id, node.id);
        void flyInto(
          (node.peek ?? []).map((file) => file.id),
          client.prefetchQuery({
            ...cloudListQuery(workspace.id, { scope: 'folder', folder: node.id, area: undefined }),
            staleTime: 10_000,
          }),
          (flown) => void navigate(to, { viewTransition: flown }),
        );
        return;
      }
      if (fetching.has(node.id)) return;
      const app = appFor(node, canCreateDecks(workspace.role));
      if (app === 'slider') {
        // Slider's own: a presentation made of the file's current version, opened there.
        markFetch(node.id, 'loading');
        // Installed, Cloud stays Cloud: Slider gets a window of its own.
        const slider = windowForApp('slider');
        presentNode.mutate(node.id, {
          onSuccess: (deck) => {
            markFetch(node.id, 'done');
            if (slider) slider.go(routes.deck(deck.id));
            else void navigate(routes.deck(deck.id));
          },
          onError: (error) => {
            markFetch(node.id, null);
            slider?.close();
            failed(error);
          },
        });
      } else if (app === 'reader') {
        // Reader's own: the PDF opens where it is read, filled in, signed and commented on.
        const to = routes.pdf(node.id);
        const reader = windowForApp('reader');
        if (reader) reader.go(to);
        else void navigate(to);
      } else if (app === 'writer') {
        // Writer's own: the document is this file, it opens where it is written.
        const to = routes.document(node.id);
        const writer = windowForApp('writer');
        if (writer) writer.go(to);
        else void navigate(to);
      } else {
        // Everything else belongs to an app on the computer: the browser hands the file over.
        // From there on the download is the browser's (its own bar tells how far it is): the
        // file shows that it left.
        const viaBrowser = () => {
          saveFrom(cloudPaths.content(node.id, node.versionId, true));
          setTimeout(() => markFetch(node.id, 'done'), 1200);
        };
        markFetch(node.id, 'loading');
        const bridge = cloudBridge();
        if (!bridge) return viaBrowser();
        // Cloud's app: the file opens where it lies in the Finder, what is saved there comes back.
        void bridge
          .open(workspace.id, node.id)
          .catch(() => false)
          .then((opened) => {
            if (!opened) return viaBrowser();
            markFetch(node.id, 'done');
            computerChanged();
          });
      }
    },
    [
      client,
      computerChanged,
      failed,
      markFetch,
      fetching,
      navigate,
      presentNode,
      workspace.id,
      workspace.role,
    ],
  );

  const cannotOpen = useCallback(
    (node: CloudNode) => {
      if (node.kind !== 'file' || cloudBridge()) return null;
      const decks = canCreateDecks(workspace.role);
      if (appFor(node, decks)) return null;
      if (!decks && appFor(node, true))
        return 'Diese Präsentation kannst du in Slider nicht öffnen';
      const extension = cloudExtension(node.name);
      return extension
        ? `Slider kann .${extension}-Dateien nicht öffnen`
        : 'Slider kann diese Datei nicht öffnen';
    },
    [workspace.role],
  );

  const restore = useCallback(
    (nodes: readonly CloudNode[]) => {
      const ids = nodes.map((node) => node.id);
      setGone((now) => without(now, ids));
      restoreNodes.mutate(ids, {
        onSuccess: (result) => {
          const [skipped] = result.skipped;
          if (skipped && result.nodes.length === 0) return notify(skipped.reason, 'danger');
          notify(
            withSkipped(
              named(result.nodes, 'wiederhergestellt', 'wiederhergestellt'),
              result.skipped,
            ),
            skipped ? 'danger' : 'neutral',
          );
        },
        onError: failed,
      });
    },
    [failed, notify, restoreNodes],
  );

  const trash = useCallback(
    (nodes: readonly CloudNode[]) => {
      const ids = nodes.map((node) => node.id);
      // Gone at once, as from the list: their details close and are not asked for again.
      setGone((now) => new Map([...now, ...ids.map((id) => [id, null] as const)]));
      trashNodes.mutate(ids, {
        onSuccess: (result) => {
          const [skipped] = result.skipped;
          const at = Date.now();
          setGone(
            (now) =>
              new Map(
                [
                  ...without(
                    now,
                    result.skipped.map((each) => each.id),
                  ),
                ].map(([id, when]) => [id, ids.includes(id) ? at : when]),
              ),
          );
          if (skipped && result.nodes.length === 0) return notify(skipped.reason, 'danger');
          notify(
            withSkipped(named(result.nodes, 'gelöscht', 'gelöscht'), result.skipped),
            skipped ? 'danger' : 'neutral',
            { label: 'Rückgängig', run: () => restore(result.nodes) },
          );
        },
        onError: (error) => {
          setGone((now) => without(now, ids));
          failed(error);
        },
      });
    },
    [failed, notify, restore, trashNodes],
  );

  const moveInto = useCallback(
    (nodes: readonly Pick<CloudNode, 'id'>[], destination: Destination) =>
      moveNodes.mutate(
        {
          ids: nodes.map((node) => node.id),
          parentId: destination.parentId,
          areaId: destination.areaId,
        },
        {
          onSuccess: (result) => {
            const [skipped] = result.skipped;
            if (skipped && result.nodes.length === 0) notify(skipped.reason, 'danger');
            else {
              notify(
                withSkipped(
                  `${named(result.nodes, 'nach', 'nach')} „${destination.name}“ verschoben`,
                  result.skipped,
                ),
                skipped ? 'danger' : 'neutral',
              );
            }
            close();
          },
          onError: failed,
        },
      ),
    [failed, moveNodes, notify],
  );

  const takeFrom = useCallback(
    (carried: string, destination: Destination) => {
      const from = carriedNodes(carried);
      if (!from) return;
      if (from.workspaceId !== workspace.id) {
        return notify('Verschieben geht nur innerhalb eines Workspace.', 'danger');
      }
      moveInto(
        from.ids.map((id) => ({ id })),
        destination,
      );
    },
    [moveInto, notify, workspace.id],
  );
  const sentAway = useCallback(() => {
    setTimeout(() => void client.invalidateQueries({ queryKey: ['cloud', workspace.id] }), 700);
  }, [client, workspace.id]);
  // The app's tab bar: files dropped onto this page's tab go where the page is.
  const droppedOnTab = useEffectEvent((event: Event) => {
    // A page without a place of its own („Gelöscht“, a folder one may only look at, one still
    // loading) takes nothing – never silently into one's own files, out of everyone's sight.
    if (!place) return notify('Hier lässt sich nichts ablegen.', 'danger');
    takeFrom(String((event as CustomEvent<unknown>).detail), place);
  });
  useEffect(() => {
    window.addEventListener(TAB_DROP_EVENT, droppedOnTab);
    return () => window.removeEventListener(TAB_DROP_EVENT, droppedOnTab);
  }, []);
  // A file from the desktop over a place that takes none („Gelöscht“, „Geteilt“, a folder one may
  // only look at, the side bar): left to the browser it would open the file and the app is gone.
  // Whoever takes it has said so already (`preventDefault`) by the time it arrives here.
  useEffect(() => {
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files');
    const over = (event: DragEvent) => {
      if (event.defaultPrevented || !carriesFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'none';
    };
    const dropped = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', dropped);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', dropped);
    };
  }, []);

  const download = useCallback(
    (nodes: readonly CloudNode[]) => {
      const [first] = nodes;
      if (!first) return;
      if (nodes.length === 1 && first.kind === 'file') {
        saveFrom(cloudPaths.content(first.id, first.versionId, true));
      } else {
        saveFrom(
          cloudPaths.archive(
            workspace.id,
            nodes.map((node) => node.id),
          ),
        );
      }
    },
    [workspace.id],
  );

  const upload = useCallback(
    (files: readonly PickedFile[], target: CloudTarget) => {
      if (files.length === 0) return;
      const max = home?.maxFileBytes;
      const fits = max ? files.filter((each) => each.file.size <= max) : [...files];
      if (fits.length < files.length) {
        const count = files.length - fits.length;
        notify(
          count === 1
            ? 'Eine Datei ist zu groß für diesen Server.'
            : `${count} Dateien sind zu groß für diesen Server.`,
          'danger',
        );
      }
      const { name: _name, ...where } = target;
      uploads.add(fits, where);
    },
    [home?.maxFileBytes, notify, uploads],
  );
  const createFolderNow = createFolder.mutate;
  const newFolder = useCallback(
    (target: CloudTarget) =>
      createFolderNow(
        { name: 'Neuer Ordner', numbered: true, parentId: target.parentId, areaId: target.areaId },
        {
          // The lists have asked again by now: the folder stands in them.
          onSuccess: (folder) => {
            const here =
              place &&
              (place.parentId ?? '') === (target.parentId ?? '') &&
              (place.areaId ?? '') === (target.areaId ?? '');
            if (here) setRenaming({ id: folder.id, where: 'list', fresh: true });
            // Made somewhere this page does not show (an area's menu in the side bar).
            else notify(`Ordner „${folder.name}“ in „${target.name}“ angelegt`);
          },
          onError: failed,
        },
      ),
    [createFolderNow, failed, notify, place],
  );
  const tidy = useCallback((target: CloudTarget) => {
    askCloudChat({
      text: target.parentId ? `Räum den Ordner „${target.name}“ auf` : `Räum „${target.name}“ auf`,
      folderId: target.parentId ?? null,
      areaId: target.areaId ?? null,
    });
  }, []);
  const pickAndUpload = useCallback(
    (target: CloudTarget, folder = false) =>
      void pickFromDisk(folder).then((files) => upload(files, target)),
    [upload],
  );
  const uploadVersion = useCallback(
    (node: CloudNode) =>
      void pickFromDisk(false).then(([picked]) => {
        if (picked) uploads.add([picked], { nodeId: node.id });
      }),
    [uploads],
  );

  const toComputer = useCallback(
    (nodes: readonly CloudNode[]): (MenuAction & { icon: IconName }) | null => {
      const [first] = nodes;
      if (!first) return null;
      const bridge = cloudBridge();
      // Cloud's app on the Mac: everything lies in the Finder already – shown there, never
      // fetched again. Elsewhere the app has no drive (it says `false` to every reveal): the
      // download, as in the browser.
      if (bridge?.reveal && fileManagerName() === 'Finder') {
        if (nodes.length > 1) return null;
        return {
          label: `Im ${fileManagerName()} zeigen`,
          icon: 'folderOpen',
          onSelect: () =>
            void bridge.reveal?.(workspace.id, first.id).then((shown) => {
              if (!shown) notify('Auf diesem Computer nicht zu finden', 'danger');
            }),
        };
      }
      return { label: 'Herunterladen', icon: 'download', onSelect: () => download(nodes) };
    },
    [download, notify, workspace.id],
  );

  const actionsFor = useCallback(
    (nodes: readonly CloudNode[]): MenuAction[] => {
      const [first] = nodes;
      if (!first) return [];
      const many = nodes.length > 1;
      const editable = nodes.every((node) => cloudAccessAtLeast(node.access, 'edit'));
      if (first.deleted) {
        return [
          { label: 'Wiederherstellen', icon: 'history', onSelect: () => restore(nodes) },
          {
            label: 'Endgültig löschen',
            icon: 'deleteForever',
            tone: 'danger',
            onSelect: () => setDialog({ kind: 'purge', nodes: [...nodes] }),
          },
        ];
      }
      const actions: MenuAction[] = [];
      if (!many) {
        const why = cannotOpen(first);
        actions.push({
          label: 'Öffnen',
          icon: first.kind === 'folder' ? 'folderOpen' : 'openInNew',
          onSelect: () => open(first),
          ...(why && { disabled: true, title: why }),
        });
        actions.push({ label: 'Details', icon: 'info', onSelect: () => openFile(first.id) });
      }
      const way = toComputer(nodes);
      if (way) actions.push(way);
      // Files (no folder) go on a new mail – fetched with one's own access as it opens.
      if (hasMailbox && nodes.every((node) => node.kind === 'file')) {
        actions.push({
          label: 'Per Mail senden',
          icon: 'mail',
          onSelect: () => {
            handToNewMail(
              nodes.map((node) =>
                fetch(`${API_PREFIX}${cloudPaths.content(node.id, node.versionId)}`, {
                  credentials: 'include',
                })
                  .then((response) => {
                    if (!response.ok) throw new Error(`„${node.name}“ nicht angehängt`);
                    return response.blob();
                  })
                  .then((blob) => new File([blob], node.name, { type: blob.type })),
              ),
            );
            void navigate(`${routes.cloudMail(workspace.id)}/${NEW_MAIL}`);
          },
        });
      }
      // A file whose content is on this computer can leave it again: it stays in the files.
      const here =
        !many && first.kind === 'file' && onComputer.has(first.id) ? cloudBridge() : null;
      if (here) {
        if (here.free) {
          actions.push({
            label: 'Speicherplatz freigeben',
            icon: 'cloud',
            onSelect: () =>
              void here.free?.(workspace.id, first.id).then((freed) => {
                if (freed) notify(`${first.name} liegt nur noch in der Cloud`);
                else
                  notify('Die Datei wird gerade verwendet und bleibt auf dem Computer', 'danger');
                computerChanged();
              }),
          });
        }
      }
      if (!many) {
        // Only where the instance has sharing by hand: else role and area say who sees what.
        if (editable && home?.sharing) {
          actions.push({
            label: 'Teilen …',
            icon: 'share',
            onSelect: () => setDialog({ kind: 'share', node: first }),
          });
        }
        // As in Slider: „Anpinnen“ / „Lösen“ – a pinned folder is a link in the side bar.
        if (first.kind === 'folder') {
          actions.push({
            label: first.pinned ? 'Lösen' : 'Anpinnen',
            icon: 'pushPin',
            onSelect: () =>
              pinNode.mutate(
                { id: first.id, pinned: !first.pinned },
                { onError: (error) => notify(error.message, 'danger') },
              ),
          });
        }
      }
      if (editable) {
        if (!many) {
          actions.push({
            label: 'Umbenennen',
            icon: 'edit',
            onSelect: () => rename(first),
          });
          if (first.kind === 'folder') {
            if (canCreateDecks(workspace.role)) {
              actions.push({
                label: 'Aufräumen',
                icon: 'autoAwesome',
                onSelect: () =>
                  tidy({
                    name: first.name,
                    parentId: first.id,
                    ...(first.areaId ? { areaId: first.areaId } : {}),
                  }),
              });
            }
            actions.push({
              label: 'Farbe …',
              icon: 'palette',
              onSelect: () => setDialog({ kind: 'color', node: first }),
            });
          }
        }
        actions.push({
          label: 'Verschieben …',
          icon: 'folder',
          onSelect: () => setDialog({ kind: 'place', nodes: [...nodes], copy: false }),
        });
      }
      // A copy needs a place to put it: who only looks has none.
      if (home?.ownFiles !== false) {
        actions.push({
          label: 'Kopieren nach …',
          icon: 'contentCopy',
          onSelect: () => setDialog({ kind: 'place', nodes: [...nodes], copy: true }),
        });
      }
      if (editable) {
        // On this computer the file is changed where it lies: what is saved there goes up.
        if (!many && first.kind === 'file' && !here) {
          actions.push({
            label: 'Neue Fassung hochladen …',
            icon: 'upload',
            onSelect: () => uploadVersion(first),
          });
        }
        actions.push({
          label: 'Löschen',
          icon: 'delete',
          tone: 'danger',
          onSelect: () => trash(nodes),
        });
      }
      return actions;
    },
    [
      tidy,
      toComputer,
      hasMailbox,
      navigate,
      workspace.role,
      cannotOpen,
      computerChanged,
      home?.ownFiles,
      home?.sharing,
      notify,
      onComputer,
      open,
      openFile,
      pinNode,
      rename,
      restore,
      trash,
      uploadVersion,
      workspace.id,
    ],
  );

  const ui = useMemo<CloudUi>(
    () => ({
      workspace,
      userId: user.id,
      home,
      notify,
      uploads,
      place: place ?? OWN_FILES,
      setPlace,
      dragged,
      setDragged,
      hrefOf,
      open,
      cannotOpen,
      fetching,
      openFile,
      actionsFor,
      share: (node) => setDialog({ kind: 'share', node }),
      rename,
      renaming,
      endRename: (node, name) => {
        setRenaming(null);
        if (node && name) renameNode.mutate({ id: node.id, name }, { onError: failed });
      },
      moveTo: (nodes) => setDialog({ kind: 'place', nodes: [...nodes], copy: false }),
      moveInto,
      takeFrom,
      sentAway,
      trash,
      gone,
      restore,
      purge: (nodes) => setDialog({ kind: 'purge', nodes: [...nodes] }),
      emptyTrash: () => setDialog({ kind: 'emptyTrash' }),
      download,
      toComputer,
      newFolder,
      tidy: canCreateDecks(workspace.role) ? tidy : null,
      upload,
      pickAndUpload,
      uploadVersion,
      newArea: (parent) => setDialog({ kind: 'area', parent }),
      editArea: (area) => setDialog({ kind: 'area', area }),
      areaPeople: (area) => setDialog({ kind: 'areaPeople', area }),
      deleteArea: (area) => setDialog({ kind: 'deleteArea', area }),
    }),
    [
      workspace,
      user.id,
      home,
      notify,
      uploads,
      place,
      dragged,
      setDragged,
      hrefOf,
      open,
      cannotOpen,
      fetching,
      openFile,
      actionsFor,
      tidy,
      rename,
      renaming,
      renameNode,
      failed,
      moveInto,
      takeFrom,
      sentAway,
      trash,
      gone,
      restore,
      download,
      toComputer,
      newFolder,
      upload,
      pickAndUpload,
      uploadVersion,
    ],
  );

  return (
    <CloudContext value={ui}>
      {children}

      {dialog?.kind === 'place' && (
        <DestinationDialog
          workspaceId={workspace.id}
          nodes={dialog.nodes}
          verb={dialog.copy ? 'kopieren' : 'verschieben'}
          pending={dialog.copy ? copyNodes.isPending : moveNodes.isPending}
          onClose={close}
          onPick={(destination) => {
            if (!dialog.copy) return moveInto(dialog.nodes, destination);
            copyNodes.mutate(
              {
                ids: dialog.nodes.map((node) => node.id),
                parentId: destination.parentId,
                areaId: destination.areaId,
              },
              {
                onSuccess: (result) => {
                  const [skipped] = result.skipped;
                  const left = new Set(result.skipped.map((each) => each.id));
                  const copied = dialog.nodes.filter((node) => !left.has(node.id));
                  if (skipped && copied.length === 0) notify(skipped.reason, 'danger');
                  else {
                    notify(
                      withSkipped(
                        `${named(copied, 'nach', 'nach')} „${destination.name}“ kopiert`,
                        result.skipped,
                      ),
                      skipped ? 'danger' : 'neutral',
                    );
                  }
                  close();
                },
                onError: failed,
              },
            );
          }}
        />
      )}
      {dialog?.kind === 'share' && (
        <ShareDialog
          workspaceId={workspace.id}
          node={dialog.node}
          userId={user.id}
          onClose={close}
          notify={notify}
        />
      )}
      {dialog?.kind === 'purge' && (
        <ConfirmDialog
          onClose={close}
          title={`${named(dialog.nodes, 'endgültig', 'endgültig')} löschen?`}
          description="Das lässt sich nicht rückgängig machen, auch alle Fassungen gehen."
          confirmLabel="Endgültig löschen"
          confirmIcon="deleteForever"
          pending={purgeNodes.isPending}
          error={purgeNodes.error?.message}
          onConfirm={() =>
            purgeNodes.mutate(
              dialog.nodes.map((node) => node.id),
              {
                onSuccess: (result) => {
                  const [skipped] = result.skipped;
                  if (skipped) notify(skipped.reason, 'danger');
                  else notify(named(dialog.nodes, 'endgültig gelöscht', 'endgültig gelöscht'));
                  close();
                },
              },
            )
          }
        />
      )}
      {dialog?.kind === 'emptyTrash' && (
        <ConfirmDialog
          onClose={close}
          title="Alles endgültig löschen?"
          description="Alle Dateien und Ordner unter „Gelöscht“, die du endgültig löschen darfst, gehen für immer, mit allen Fassungen. Gelöschte Präsentationen bleiben."
          confirmLabel="Endgültig löschen"
          confirmIcon="deleteForever"
          pending={emptyTrashNow.isPending}
          error={emptyTrashNow.error?.message}
          onConfirm={() =>
            emptyTrashNow.mutate(undefined, {
              onSuccess: ({ purged, skipped }) => {
                const [first] = skipped;
                if (first && purged === 0) notify(first.reason, 'danger');
                else
                  notify(
                    purged === 0
                      ? 'Nichts zu löschen'
                      : withSkipped('Alles endgültig gelöscht', skipped),
                    first ? 'danger' : 'neutral',
                  );
                close();
              },
            })
          }
        />
      )}
      {dialog?.kind === 'color' && (
        <FolderColorDialog
          node={dialog.node}
          onClose={close}
          onPick={(color) => {
            close();
            colorNode.mutate({ id: dialog.node.id, color }, { onError: failed });
          }}
        />
      )}
      {dialog?.kind === 'area' && (
        <AreaDialog
          workspaceId={workspace.id}
          area={dialog.area}
          parent={dialog.parent}
          takenColors={(home?.areas ?? []).map((area) => area.color)}
          onClose={close}
          onSaved={(area, created) => {
            close();
            notify(
              created ? `Bereich „${area.name}“ angelegt` : `Bereich „${area.name}“ gesichert`,
            );
            if (created) void navigate(routes.cloudArea(workspace.id, area.id));
          }}
        />
      )}
      {dialog?.kind === 'areaPeople' && (
        <AreaPeopleDialog
          workspaceId={workspace.id}
          area={dialog.area}
          onClose={close}
          onSaved={(area) => {
            close();
            notify(`Personen in „${area.name}“ gesichert`);
          }}
        />
      )}
      {dialog?.kind === 'deleteArea' && (
        <ConfirmDialog
          onClose={close}
          title={`Bereich „${dialog.area.name}“ löschen?`}
          description={
            dialog.area.fileCount > 0
              ? `Mit dem Bereich ${dialog.area.fileCount === 1 ? 'geht die eine Datei' : `gehen alle ${dialog.area.fileCount} Dateien`} darin endgültig. Gib zum Bestätigen seinen Namen ein.`
              : (home?.areas ?? []).some((area) => area.parentId === dialog.area.id)
                ? 'Unter dem Bereich liegen noch Bereiche.'
                : 'In diesem Bereich liegt nichts.'
          }
          confirmLabel="Löschen"
          confirmIcon="delete"
          pending={deleteAreaNow.isPending}
          error={
            (home?.areas ?? []).some((area) => area.parentId === dialog.area.id)
              ? 'Lösche zuerst die Unterbereiche dieses Bereichs.'
              : deleteAreaNow.error?.message
          }
          confirmDisabled={
            (home?.areas ?? []).some((area) => area.parentId === dialog.area.id) ||
            (dialog.area.fileCount > 0 && confirmName.trim() !== dialog.area.name)
          }
          onConfirm={() =>
            deleteAreaNow.mutate(dialog.area.id, {
              onSuccess: () => {
                notify(`Bereich „${dialog.area.name}“ gelöscht`);
                close();
                // Only when it was the page: to the area above it, else to the start.
                if (window.location.pathname === routes.cloudArea(workspace.id, dialog.area.id)) {
                  void navigate(
                    dialog.area.parentId
                      ? routes.cloudArea(workspace.id, dialog.area.parentId)
                      : routes.cloud(workspace.id),
                  );
                }
              },
            })
          }
        >
          {dialog.area.fileCount > 0 && (
            <TextField
              aria-label="Name des Bereichs"
              placeholder={dialog.area.name}
              autoFocus
              autoComplete="off"
              value={confirmName}
              onChange={(event) => setConfirmName(event.target.value)}
            />
          )}
        </ConfirmDialog>
      )}

      <UploadTray uploads={uploads} onOpen={openFile} />
      <CloudToast toast={toast} onDismiss={dismiss} />
    </CloudContext>
  );
}
