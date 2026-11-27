import { useNavigate } from 'react-router';
import { NEW_MAIL, useSenderOrNull } from '@/features/sender';
import { canCreateDecks } from '@/features/workspaces';
import { useCreateDiagram, useCreateDocument } from '@/lib/api';
import { routes } from '@/lib/routes';
import type { MenuAction } from '@/ui';
import { useShownEvent } from '../components/calendar/EventPanel';
import { isWorkspaceOwn } from '../lib/areas';
import { useCloud } from './useCloud';

/**
 * „Neu“: what can be made or brought here – into the open folder or area. One list for the side
 * bar's menu, the search palette's commands and the command panel (⌘K). A `divider` starts the
 * next group: what lands in the place, what is made, what is to be done and when, a conversation.
 */
export function useCloudNewActions(): MenuAction[] {
  const ui = useCloud();
  const sender = useSenderOrNull();
  const navigate = useNavigate();
  const createDocument = useCreateDocument(ui.workspace.id);
  const createDiagram = useCreateDiagram(ui.workspace.id);
  const event = useShownEvent();
  const { workspace, place } = ui;
  const makes = canCreateDecks(workspace.role);
  // An area open (not a folder in it): its own Aufgaben and Agenten; else the overviews.
  const area = place.areaId ? ui.home?.areas.find((each) => each.id === place.areaId) : undefined;
  const newDocument = () =>
    createDocument.mutate(
      { template: 'plain', parentId: place.parentId, areaId: place.areaId },
      {
        onSuccess: (document) => void navigate(routes.document(document.id)),
        onError: (error) => ui.notify(error.message, 'danger'),
      },
    );
  const newDiagram = () =>
    createDiagram.mutate(
      { parentId: place.parentId, areaId: place.areaId },
      {
        onSuccess: (diagram) => void navigate(routes.diagram(diagram.id)),
        onError: (error) => ui.notify(error.message, 'danger'),
      },
    );
  const made: MenuAction[] = [
    ...(makes
      ? [
          {
            label: 'Neue Präsentation',
            icon: 'slideshow',
            onSelect: () => void navigate(routes.newReview(workspace.id, place)),
          },
          { label: 'Neues Dokument', icon: 'article', onSelect: newDocument },
          { label: 'Neues Diagramm', icon: 'accountTree', onSelect: newDiagram },
        ]
      : []),
    ...(ui.home?.canCreateAreas
      ? [{ label: 'Neuer Bereich', icon: 'workspaces', onSelect: () => ui.newArea() }]
      : []),
  ];
  const done: MenuAction[] = [
    {
      label: 'Neue Aufgabe',
      icon: 'checklist',
      onSelect: () =>
        void navigate(
          area ? routes.cloudAreaTodos(workspace.id, area.id) : routes.cloudTodos(workspace.id),
        ),
    },
    {
      label: 'Neuer Termin',
      icon: 'event',
      onSelect: () => event.create({ day: new Date().toLocaleDateString('sv-SE') }),
    },
    {
      label: 'Neues Meeting',
      icon: 'videocam',
      onSelect: () => event.create({ day: new Date().toLocaleDateString('sv-SE'), meeting: true }),
    },
    ...(makes
      ? [
          {
            label: 'Neuer Agent',
            icon: 'autoAwesome',
            onSelect: () =>
              void navigate(
                area && !isWorkspaceOwn(area)
                  ? routes.cloudAreaAgents(workspace.id, area.id)
                  : routes.cloudAgents(workspace.id),
              ),
          },
        ]
      : []),
  ];
  const talk: MenuAction[] = sender
    ? [
        {
          label: 'Neue Gruppe',
          icon: 'groups',
          onSelect: () => void navigate(sender.newPath('gruppe')),
        },
        {
          label: 'Neue Mail',
          icon: 'mail',
          onSelect: () => void navigate(sender.mailThreadPath(NEW_MAIL)),
        },
      ]
    : [];
  const startsGroup = (group: MenuAction[]) =>
    group.map((action, index) => (index === 0 ? { ...action, divider: true } : action));
  return [
    { label: 'Dateien hochladen', icon: 'uploadFile', onSelect: () => ui.pickAndUpload(place) },
    {
      label: 'Ordner hochladen',
      icon: 'driveFolderUpload',
      onSelect: () => ui.pickAndUpload(place, true),
    },
    { label: 'Neuer Ordner', icon: 'createNewFolder', onSelect: () => ui.newFolder(place) },
    ...startsGroup(made),
    ...startsGroup(done),
    ...startsGroup(talk),
  ];
}
