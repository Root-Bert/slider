import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { CloudNode, Workspace } from '@slider/shared';
import { appFor, AreaDot, FileIcon, suiteApps, useOpenApp, whereOf } from '@/features/cloud';
import { useMailHits } from '@/features/sender';
import {
  canCreateDecks,
  useActiveWorkspace,
  useSignOut,
  WorkspaceMark,
} from '@/features/workspaces';
import {
  useCloudHome,
  useCloudSearch,
  useMe,
  useOrderCloudAgent,
  usePresentCloudNode,
} from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { appHome, useCurrentApp, windowForApp } from '@/lib/apps';
import { isApplePlatform } from '@/lib/platform';
import { routes } from '@/lib/routes';
import { useThemePreference, type ThemePreference } from '@/lib/theme';
import {
  Kbd,
  PaletteBody,
  PaletteDialog,
  PaletteMark,
  PaletteMarked,
  type IconName,
  type MenuAction,
  ReturnKey,
  Spinner,
  type PaletteEntry,
  type ShowToast,
  Toast,
  useDebounced,
  useToast,
} from '@/ui';
import { pageCommands } from '../lib/registry';

/*
 * The command panel (⌘K), in every app: what the page one is on can do (its own menus' actions,
 * lent through `usePageCommands`), where one can go, another workspace, the look, signing out –
 * and, typed, the workspace's files and folders by name, its areas and mails, as Cloud's search
 * finds them.
 */

/** As many hits as fit under the commands; Cloud's search (⇧⌘F) has the rest. */
const MAX_HITS = 8;
const MAX_MAILS = 5;

/** An entry before it is filtered: `words` is what typing finds it by beside its name. */
interface Command extends Omit<PaletteEntry, 'title' | 'leading'> {
  title: string;
  leading: ReactNode;
  words?: string;
}

const THEMES: readonly { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'light', label: 'Hell', icon: 'lightMode' },
  { value: 'system', label: 'System', icon: 'desktopWindows' },
  { value: 'dark', label: 'Dunkel', icon: 'darkMode' },
];

/**
 * How well it fits what is typed, lower is better; `null`: not at all. Every word typed must
 * stand somewhere in the name, the line under it or the words it is found by; the name as typed
 * fits best, then the name starting with the first word, then a word of the name starting with it.
 */
const fit = (command: Command, query: string): number | null => {
  const words = query.toLocaleLowerCase('de').split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const title = command.title.toLocaleLowerCase('de');
  const haystack = `${title} ${command.subtitle ?? ''} ${command.words ?? ''}`.toLocaleLowerCase(
    'de',
  );
  if (!words.every((word) => haystack.includes(word))) return null;
  const first = words[0]!;
  // Named as typed: „Dateien“ before „Dateien hochladen“.
  if (title === words.join(' ')) return -1;
  if (title.startsWith(first)) return 0;
  if (title.split(/[\s&-]+/).some((part) => part.startsWith(first))) return 1;
  return title.includes(first) ? 2 : 3;
};

/**
 * The commands that fit, best first – a group as a whole, by its best one, so each heading
 * stands once; in a group too the best first, else as they come.
 */
const ranked = (commands: readonly Command[], query: string): Command[] => {
  const fitting = commands.flatMap((command) => {
    const score = fit(command, query);
    return score === null ? [] : [{ command, score }];
  });
  const best = new Map<string, number>();
  for (const { command, score } of fitting)
    best.set(command.group, Math.min(score, best.get(command.group) ?? score));
  const order = [...best.keys()];
  return fitting
    .sort(
      (a, b) =>
        best.get(a.command.group)! - best.get(b.command.group)! ||
        order.indexOf(a.command.group) - order.indexOf(b.command.group) ||
        a.score - b.score,
    )
    .map(({ command }) => command);
};

/** A leading mark as wide as `PaletteMark`, for an app's or a workspace's picture. */
const markSlot = (child: ReactNode) => (
  <span className="flex size-8 shrink-0 items-center justify-center">{child}</span>
);

/** A menu's actions as commands – label, icon and what it does as the menu has them. */
const fromActions = (group: string, actions: readonly MenuAction[], words?: string): Command[] =>
  actions
    .filter((action) => !action.disabled)
    .map((action) => ({
      key: action.key ?? action.label,
      group,
      leading:
        typeof action.icon === 'string' ? (
          <PaletteMark icon={action.icon as IconName} />
        ) : (
          markSlot(action.icon)
        ),
      title: action.label,
      words,
      run: action.onSelect,
    }));

/**
 * The dialog and what outlives its body: a toast for what was set going and is ready once the
 * panel has closed (the AI's agent), and signing out's questions, asked once it has closed.
 */
export function CommandPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [toast, notify] = useToast();
  const signOut = useSignOut();
  // As the account menu says it under its row – here, where no question stands to say it.
  const failed = signOut.failed;
  useEffect(() => {
    if (failed) notify(failed, 'danger');
  }, [failed, notify]);
  return (
    <>
      <PaletteDialog open={open} onClose={onClose} label="Befehle">
        {open && <CommandBody close={onClose} notify={notify} account={signOut.actions} />}
      </PaletteDialog>
      {signOut.dialog}
      <Toast toast={toast} />
    </>
  );
}

/** Whether the body is still there – it goes with the panel, the requests it started stay. */
function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

function CommandBody({
  close,
  notify,
  account,
}: {
  close: () => void;
  notify: ShowToast;
  /** The account menu's sign-out rows (`useSignOut`). */
  account: readonly MenuAction[];
}) {
  const mounted = useMounted();
  const [query, setQuery] = useState('');
  const [refused, setRefused] = useState<string | null>(null);
  const navigate = useNavigate();
  const openApp = useOpenApp();
  const app = useCurrentApp();
  const { data: me } = useMe();
  const active = useActiveWorkspace();
  const [theme, setTheme] = useThemePreference();
  // Read once as the panel opens: what the page lends stays as it is while one types.
  const [lent] = useState(pageCommands);
  const workspaces = me?.workspaces ?? [];
  // A presentation, document or PDF open: its workspace, which the address does not say.
  const pageWorkspaceId = lent.find((each) => each.workspaceId)?.workspaceId;
  const workspace: Workspace | null =
    workspaces.find((each) => each.id === pageWorkspaceId) ?? active;

  const go = (to: string) => () => void navigate(to);

  // Typed: the workspace's files and folders by name – as Cloud's search, wherever one is.
  const settled = useDebounced(query.trim(), 150);
  const search = useCloudSearch(workspace?.id ?? '', workspace ? settled : '');
  // The areas and the mails too, as Cloud's search finds them (⇧⌘F).
  const areas = useCloudHome(workspace?.id ?? '').data?.areas ?? [];
  const mails = useMailHits(workspace?.id ?? '', workspace ? settled : '', { max: MAX_MAILS });
  const decks = workspace ? canCreateDecks(workspace.role) : false;
  // A presentation Slider opens becomes one (as Cloud's „Öffnen“ makes it) and opens there – the
  // row turns while it is made, the panel stays open meanwhile.
  const present = usePresentCloudNode();
  const openDeck = (node: CloudNode) => {
    if (present.isPending) return;
    setRefused(null);
    // Installed, Slider gets a window of its own – opened now, while the key still counts.
    const slider = windowForApp('slider');
    present.mutateAsync(node.id).then(
      (deck) => {
        const to = routes.deck(deck.id);
        if (slider) {
          slider.go(to);
          if (mounted.current) close();
        } else if (mounted.current) {
          close();
          void navigate(to);
        } else
          // Closed meanwhile: the page stays, as for the AI's agent.
          notify(`„${deck.title}“ ist bereit.`, 'neutral', {
            label: 'Öffnen',
            run: () => void navigate(to),
          });
      },
      (error: Error) => {
        slider?.close();
        if (mounted.current) setRefused(error.message);
        else notify(error.message, 'danger');
      },
    );
  };
  // A folder opens in Cloud, a presentation in Slider, a document in Writer, a PDF in Reader;
  // anything else shows its details in Cloud – as a double click in Cloud's lists opens them.
  const hitApp = (node: CloudNode) => (node.kind === 'folder' ? null : appFor(node, decks));
  const openHit = (node: CloudNode, workspaceId: string) => {
    if (node.kind === 'folder') return go(routes.cloudFolder(workspaceId, node.id))();
    const app = hitApp(node);
    if (app === 'slider') openDeck(node);
    else if (app === 'writer') openApp({ id: 'writer', to: routes.document(node.id) });
    else if (app === 'page') openApp({ id: 'cloud', to: routes.cloudPage(workspaceId, node.id) });
    else if (app === 'diagram') openApp({ id: 'cloud', to: routes.diagram(node.id) });
    else if (app === 'reader') openApp({ id: 'reader', to: routes.pdf(node.id) });
    else openApp({ id: 'cloud', to: routes.cloudFile(workspaceId, node.id) });
  };
  const hits: PaletteEntry[] =
    workspace && query.trim() && search.data
      ? search.data.nodes.slice(0, MAX_HITS).map((node) => ({
          key: node.id,
          group: 'Dateien',
          leading:
            present.isPending && present.variables === node.id ? (
              <span className="flex size-8 shrink-0 items-center justify-center text-fg-muted">
                <Spinner size={18} />
              </span>
            ) : (
              <FileIcon kind={node.kind} type={node.fileType} />
            ),
          title: <PaletteMarked text={node.name} query={query} />,
          subtitle: [whereOf(node), node.updatedBy.name, formatRelativeTime(node.updatedAt)]
            .filter(Boolean)
            .join(' | '),
          run: () => openHit(node, workspace.id),
          stays: hitApp(node) === 'slider',
        }))
      : [];
  const typed = query.trim().toLocaleLowerCase('de');
  const areaHits: PaletteEntry[] =
    workspace && typed
      ? areas
          .filter((area) => area.name.toLocaleLowerCase('de').includes(typed))
          .map((area) => ({
            key: area.id,
            group: 'Bereiche',
            leading: markSlot(<AreaDot color={area.color} size="lg" />),
            title: <PaletteMarked text={area.name} query={query} />,
            subtitle: area.description || undefined,
            run: go(routes.cloudArea(workspace.id, area.id)),
          }))
      : [];
  // Subject, names, addresses – every mailbox and folder; one opens in Post.
  const mailHits: PaletteEntry[] =
    workspace && typed
      ? mails.threads.map((thread) => ({
          key: thread.id,
          group: 'Mails',
          leading: <PaletteMark icon="mail" />,
          title: (
            <PaletteMarked
              text={thread.subject || thread.person.name.trim() || thread.person.address}
              query={query}
            />
          ),
          subtitle: [
            thread.person.name.trim() || thread.person.address,
            formatRelativeTime(thread.updatedAt),
          ]
            .filter(Boolean)
            .join(' | '),
          run: go(routes.cloudMailThread(workspace.id, thread.id)),
        }))
      : [];
  const found = [...hits, ...areaHits, ...mailHits];
  const page = (
    key: string,
    title: string,
    icon: IconName,
    to: string,
    words?: string,
  ): Command => ({
    key,
    group: 'Gehe zu',
    leading: <PaletteMark icon={icon} />,
    title,
    subtitle: 'Cloud',
    words,
    run: go(to),
  });

  const commands: Command[] = [
    ...lent.flatMap(({ group, actions }) => fromActions(group, actions)),
    ...(workspace
      ? [
          ...suiteApps(workspace.id).map((entry): Command => ({
            key: entry.id,
            group: 'Gehe zu',
            leading: markSlot(entry.mark),
            title: entry.name,
            subtitle: entry.note,
            words: 'app',
            run: () => openApp(entry),
          })),
          page('recent', 'Zuletzt', 'history', routes.cloud(workspace.id), 'start übersicht'),
          page('files', 'Dateien', 'folder', routes.cloudFiles(workspace.id), 'meine ordner'),
          page('agents', 'Agenten', 'autoAwesome', routes.cloudAgents(workspace.id), 'ki'),
          page('todos', 'Aufgaben', 'checklist', routes.cloudTodos(workspace.id), 'todo'),
          page('calendar', 'Kalender', 'event', routes.cloudCalendar(workspace.id), 'termine'),
          page('mail', 'Post', 'mail', routes.cloudMail(workspace.id), 'mails e-mail'),
          page('shared', 'Geteilt', 'folderShared', routes.cloudShared(workspace.id)),
          page('drafts', 'Entwürfe', 'edit', routes.cloudDrafts(workspace.id)),
          page('connections', 'Verbindungen', 'link', routes.cloudConnections(workspace.id)),
          page('trash', 'Gelöscht', 'delete', routes.cloudTrash(workspace.id), 'papierkorb'),
          {
            key: 'workspace-settings',
            group: 'Gehe zu',
            leading: <PaletteMark icon="tune" />,
            title: 'Workspace-Einstellungen',
            subtitle: workspace.name,
            words: 'personen mitglieder einladen',
            run: go(routes.workspaceSettings(workspace.id)),
          },
        ]
      : []),
    {
      key: 'account',
      group: 'Gehe zu',
      leading: <PaletteMark icon="person" />,
      title: 'Konto & Anmeldung',
      words: 'profil passwort',
      run: go(routes.account()),
    },
    {
      key: 'preferences',
      group: 'Gehe zu',
      leading: <PaletteMark icon="settings" />,
      title: 'Einstellungen',
      run: go(routes.preferences()),
    },
    {
      key: 'usage',
      group: 'Gehe zu',
      leading: <PaletteMark icon="storage" />,
      title: 'Nutzung',
      words: 'speicher plan',
      run: go(routes.usage(workspace?.id)),
    },
    // Another workspace opens in the app one is in, as the switcher's does.
    ...workspaces
      .filter((each) => each.id !== workspace?.id)
      .map((each): Command => ({
        key: each.id,
        group: 'Workspace wechseln',
        leading: markSlot(<WorkspaceMark name={each.name} logoUrl={each.logoUrl} />),
        title: each.name,
        words: 'workspace',
        run: go(appHome(app, each.id).to),
      })),
    ...THEMES.map((each): Command => ({
      key: each.value,
      group: 'Darstellung',
      leading: <PaletteMark icon={each.icon} />,
      title: each.label,
      subtitle: each.value === theme ? 'Gewählt' : undefined,
      words: 'darstellung theme modus farbe',
      run: () => setTheme(each.value),
    })),
    // Last, as in the account menu: „Abmelden“ – asked, if at all, once the panel has closed.
    ...fromActions('Konto', account, 'abmelden ausloggen logout konto'),
  ];

  const fitting: PaletteEntry[] = ranked(commands, query).map(
    ({ words: _words, title, ...command }) => ({
      ...command,
      title: <PaletteMarked text={title} query={query} />,
    }),
  );
  // A command named as typed first; else the files, areas and mails – „Angebot“ is a file, not
  // „Verbindungen“.
  const named = commands.some((command) => (fit(command, query) ?? 2) <= 1);
  const searching =
    Boolean(query.trim()) && (settled !== query.trim() || search.isFetching || mails.settling);

  // What is typed, given to the AI: an agent of one's own does it, opened at once – as the field
  // „Was soll erledigt werden?“ on „Zuletzt“. For members and admins, as the server says.
  const order = useOrderCloudAgent(workspace?.id ?? '');
  const mayOrder = Boolean(workspace && !workspace.blocked && canCreateDecks(workspace.role));
  const ask = () => {
    const text = query.trim();
    if (!workspace || !mayOrder || !text || order.isPending) return;
    setRefused(null);
    const to = (agent: { id: string }) => routes.cloudAgent(workspace.id, agent.id);
    order.mutateAsync(text).then(
      (agent) => {
        if (mounted.current) {
          close();
          void navigate(to(agent));
          return;
        }
        // Closed before the agent was there (Esc, a click beside): no page jumps away under one –
        // said where one is, with the way to it, as Sender's triage says it.
        notify('Der Agent arbeitet daran.', 'neutral', {
          label: 'Öffnen',
          run: () => void navigate(to(agent)),
        });
      },
      (error: Error) => {
        if (mounted.current) setRefused(error.message);
        else notify(error.message || 'Der Agent wurde nicht beauftragt.', 'danger');
      },
    );
  };
  const asking: PaletteEntry[] =
    mayOrder && query.trim()
      ? [
          {
            key: 'ai',
            group: 'KI',
            leading: order.isPending ? (
              <span className="flex size-8 shrink-0 items-center justify-center text-fg-muted">
                <Spinner size={18} />
              </span>
            ) : (
              <PaletteMark icon="autoAwesome" />
            ),
            title: 'An die KI geben',
            subtitle: query.trim(),
            run: ask,
            stays: true,
          },
        ]
      : [];
  const entries = [...(named ? [...fitting, ...found] : [...found, ...fitting]), ...asking];

  return (
    <PaletteBody
      label={
        mayOrder ? 'Suchen oder der KI etwas auftragen' : 'Befehle, Seiten und Apps durchsuchen'
      }
      query={query}
      onQuery={(next) => {
        setQuery(next);
        setRefused(null);
      }}
      entries={entries}
      icon="search"
      pick="ausführen"
      onModEnter={mayOrder ? ask : undefined}
      // The line at the bottom is always in sight, the AI's row not always: what ⌘↵ set going and
      // a refusal stand there.
      hints={
        mayOrder && order.isPending ? (
          <span className="flex items-center gap-1.5 text-fg-muted">
            <Spinner size={14} /> Die KI legt los …
          </span>
        ) : refused ? (
          // Also a presentation that could not be made of its file.
          <span className="min-w-0 leading-snug text-danger">{refused}</span>
        ) : (
          mayOrder && (
            <span className="flex items-center gap-1.5">
              <Kbd>
                {isApplePlatform() ? '⌘' : 'Strg'} <ReturnKey />
              </Kbd>{' '}
              an die KI
            </span>
          )
        )
      }
    >
      {entries.length === 0 && !searching && (
        <p className="px-2.5 py-6 text-center text-sm text-fg-subtle">
          Nichts gefunden für „{query.trim()}“.
        </p>
      )}
    </PaletteBody>
  );
}
