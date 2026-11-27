import { isOpenTodo, type CloudNode } from '@slider/shared';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  useCalendarEvents,
  useCloudList,
  useCreateDiagram,
  useTodos,
  type CloudPlace,
} from '@/lib/api';
import { formatDay } from '@/lib/format';
import { routes } from '@/lib/routes';
import type { LiveKind, PageHost, PageLinkKind } from '@/features/pages';
import { Avatar, Icon } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { namedHref } from '../lib/named';
import { HOME_PAGE_NAME, isPageName, NEW_PAGE_PARAM, pageTitle, useCreatePage } from '../lib/pages';
import { FileIcon } from './FileIcon';

/*
 * What a page shows of the place it lies in, as it is now (`{{dateien}}`, …): its pages under it,
 * its files, the area's open to-dos, its people, the next appointments. Read here, changed where
 * they live – a row leads there.
 */

/** Where a page lies: an area's top or a folder in it, one's own files or a folder there. */
export interface PagePlace {
  workspaceId: string;
  areaId: string | null;
  parentId: string | null;
  /** The page itself, left out of its place's pages. */
  selfId: string | null;
}

const listPlace = (place: PagePlace): CloudPlace =>
  place.parentId
    ? { scope: 'folder', folder: place.parentId }
    : place.areaId
      ? { scope: 'folder', area: place.areaId }
      : { scope: 'folder' };

const SHOWN = 8;

function Rows({ children, empty }: { children: ReactNode[]; empty: string }) {
  return children.length > 0 ? (
    <ul className="page-live-rows">{children}</ul>
  ) : (
    <p className="page-live-empty">{empty}</p>
  );
}

function Row({
  to,
  icon,
  label,
  meta,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  meta?: string;
}) {
  return (
    <li>
      <Link to={to} className="page-live-row">
        {icon}
        <span className="page-live-label">{label}</span>
        {meta && <span className="page-live-meta">{meta}</span>}
      </Link>
    </li>
  );
}

const More = ({ to, label }: { to: string; label: string }) => (
  <Link to={to} className="page-live-more">
    {label}
  </Link>
);

function Pages({ place }: { place: PagePlace }) {
  const list = useCloudList(place.workspaceId, listPlace(place));
  const pages = (list.data?.nodes ?? []).filter(
    (node) =>
      node.kind === 'file' &&
      isPageName(node.name) &&
      node.id !== place.selfId &&
      // The place's Startseite is where one comes from, not one of its pages.
      node.name.toLowerCase() !== HOME_PAGE_NAME.toLowerCase(),
  );
  if (!list.data) return null;
  return (
    <Rows empty="Noch keine Seiten hier.">
      {pages.map((page) => (
        <Row
          key={page.id}
          to={routes.cloudPage(place.workspaceId, page.id)}
          icon={<Icon name="article" size={18} />}
          label={pageTitle(page.name)}
        />
      ))}
    </Rows>
  );
}

function Files({ place }: { place: PagePlace }) {
  const list = useCloudList(place.workspaceId, listPlace(place));
  if (!list.data) return null;
  const nodes = list.data.nodes.filter((node) => !(node.kind === 'file' && isPageName(node.name)));
  const all = place.parentId
    ? routes.cloudFolder(place.workspaceId, place.parentId)
    : place.areaId
      ? routes.cloudAreaFiles(place.workspaceId, place.areaId)
      : routes.cloudOwn(place.workspaceId);
  const hrefOf = (node: CloudNode) =>
    node.kind === 'folder'
      ? routes.cloudFolder(place.workspaceId, node.id)
      : namedHref(place.workspaceId, { kind: 'file', id: node.id, name: node.name });
  return (
    <>
      <Rows empty="Noch keine Dateien hier.">
        {nodes.slice(0, SHOWN).map((node) => (
          <Row
            key={node.id}
            to={hrefOf(node)}
            icon={<FileIcon kind={node.kind} type={node.fileType} size={20} />}
            label={node.name}
            meta={formatDay(node.updatedAt)}
          />
        ))}
      </Rows>
      {nodes.length > SHOWN && <More to={all} label={`Alle ${nodes.length} ansehen`} />}
    </>
  );
}

function Todos({ place }: { place: PagePlace }) {
  const todos = useTodos(place.workspaceId, place.areaId);
  if (!todos.data) return null;
  const open = todos.data.filter((todo) => isOpenTodo(todo.status));
  const all = place.areaId
    ? routes.cloudAreaTodos(place.workspaceId, place.areaId)
    : routes.cloudTodos(place.workspaceId);
  return (
    <>
      <Rows empty="Keine offenen Aufgaben.">
        {open.slice(0, SHOWN).map((todo) => (
          <Row
            key={todo.id}
            to={all}
            icon={<Icon name="radioButtonUnchecked" size={18} />}
            label={todo.title}
            meta={todo.dueOn ? `fällig ${formatDay(todo.dueOn)}` : undefined}
          />
        ))}
      </Rows>
      {open.length > SHOWN && <More to={all} label={`Alle ${open.length} ansehen`} />}
    </>
  );
}

function People({ place }: { place: PagePlace }) {
  const ui = useCloud();
  const area = ui.home?.areas.find((each) => each.id === place.areaId) ?? null;
  if (!area) return <p className="page-live-empty">Nur auf der Seite eines Bereichs.</p>;
  return (
    <ul className="page-live-people">
      {area.members.map((member) => (
        <li key={member.id} className="page-live-person">
          <Avatar author={member} size={32} />
          <span className="min-w-0">
            <span className="page-live-label block">{member.name}</span>
            {member.title && <span className="page-live-meta block">{member.title}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const DAY_MS = 86_400_000;
const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

function Events({ place }: { place: PagePlace }) {
  const range = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    return { from: from.toISOString(), to: new Date(from.getTime() + 14 * DAY_MS).toISOString() };
  }, []);
  const events = useCalendarEvents(place.workspaceId, range.from, range.to);
  if (!events.data) return null;
  const next = [...events.data].sort((a, b) => a.start.localeCompare(b.start)).slice(0, SHOWN);
  return (
    <Rows empty="Keine Termine in den nächsten zwei Wochen.">
      {next.map((event) => {
        const day = event.start.slice(0, 10);
        return (
          <Row
            key={event.id}
            to={routes.cloudCalendar(place.workspaceId, day)}
            icon={<Icon name="event" size={18} />}
            label={event.title || 'Ohne Titel'}
            meta={
              event.allDay
                ? formatDay(day)
                : `${formatDay(event.start)} | ${time.format(new Date(event.start))}`
            }
          />
        );
      })}
    </Rows>
  );
}

const LIVE: Record<LiveKind, (place: PagePlace) => ReactNode> = {
  unterseiten: (place) => <Pages place={place} />,
  dateien: (place) => <Files place={place} />,
  aufgaben: (place) => <Todos place={place} />,
  personen: (place) => <People place={place} />,
  termine: (place) => <Events place={place} />,
};

/** The page's host in Cloud: its links lead where Cloud opens them, its live blocks show the place. */
export function useCloudPageHost(place: PagePlace): PageHost {
  const ui = useCloud();
  const { notify } = ui;
  const { workspaceId, areaId, parentId, selfId } = place;
  const createPage = useCreatePage(workspaceId);
  const { mutateAsync: createDiagram } = useCreateDiagram(workspaceId);
  // What lies beside the page (the list its „Seiten“ block reads): a linked page's name as it is now.
  const beside = useCloudList(workspaceId, listPlace(place)).data?.nodes;
  return useMemo<PageHost>(
    () => ({
      linkTo: (kind: PageLinkKind, id: string, name: string) =>
        namedHref(workspaceId, { kind, id, name }),
      live: (kind) => LIVE[kind]({ workspaceId, areaId, parentId, selfId }),
      notify: (text, tone) => notify(text, tone ?? 'neutral'),
      createPage: async (title) => {
        try {
          const node = await createPage({
            title,
            parentId,
            areaId: parentId ? null : areaId,
          });
          // The file's whole name: the link opens it as a page by its ending.
          const href = namedHref(workspaceId, { kind: 'file', id: node.id, name: node.name });
          return { id: node.id, name: node.name, href: `${href}?${NEW_PAGE_PARAM}` };
        } catch (error) {
          notify(error instanceof Error ? error.message : 'Seite nicht angelegt', 'danger');
          return null;
        }
      },
      createDiagram: async (title, diagram) => {
        try {
          const file = await createDiagram({
            title,
            ...(diagram && { diagram }),
            ...(parentId ? { parentId } : areaId ? { areaId } : {}),
          });
          return { id: file.id, name: file.fileName };
        } catch (error) {
          notify(error instanceof Error ? error.message : 'Diagramm nicht angelegt', 'danger');
          return null;
        }
      },
      nameOf: (id) => beside?.find((node) => node.id === id)?.name ?? null,
    }),
    [workspaceId, areaId, parentId, selfId, notify, createPage, createDiagram, beside],
  );
}
