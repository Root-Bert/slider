import { useState } from 'react';
import type { CloudNode } from '@slider/shared';
import { cloudAccessAtLeast } from '@slider/shared';
import { useCloudHome, useCloudList, type CloudPlace } from '@/lib/api';
import { Button, Dialog, Icon, MenuItem, TextLink } from '@/ui';
import { areaTree } from '../lib/areas';
import { AreaDot } from './AreaDot';

/** A folder, an area's top, or one's own files' top. */
export interface Destination {
  parentId?: string;
  areaId?: string;
  name: string;
}

type Step =
  | { at: 'top' }
  | { at: 'own' }
  | { at: 'area'; areaId: string; name: string }
  | { at: 'folder'; folderId: string };

/**
 * „Verschieben …“, „Kopieren nach …“ and „In Cloud ablegen …“: walk to where it should go – one's own files, an area,
 * a folder in either – and say „Hierher“. Places one may only look at are not offered, and a
 * folder is never offered itself or anything inside it.
 */
export function DestinationDialog({
  workspaceId,
  nodes,
  heading,
  verb,
  pending,
  error,
  onPick,
  onClose,
}: {
  workspaceId: string;
  nodes: readonly CloudNode[];
  /** For what is no file here yet (a presentation getting its place): the title to show. */
  heading?: string;
  /** „verschieben“, „kopieren“, or „ablegen“ (something new filed there: an export). */
  verb: 'verschieben' | 'kopieren' | 'ablegen';
  pending: boolean;
  error?: string | null;
  onPick: (destination: Destination) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ at: 'top' });
  const home = useCloudHome(workspaceId);
  const place: CloudPlace =
    step.at === 'folder'
      ? { scope: 'folder', folder: step.folderId }
      : step.at === 'area'
        ? { scope: 'folder', area: step.areaId }
        : { scope: 'folder' };
  const listing = useCloudList(workspaceId, place, step.at !== 'top');
  const moving = new Set(nodes.map((node) => node.id));
  const folders = (listing.data?.nodes ?? []).filter(
    (node) => node.kind === 'folder' && !moving.has(node.id),
  );
  const areas = areaTree(
    (home.data?.areas ?? []).filter((area) => cloudAccessAtLeast(area.access, 'edit')),
  );
  const first = nodes[0];
  const title = heading
    ? heading
    : nodes.length === 1 && first
      ? `„${first.name}“ ${verb}`
      : `${nodes.length} Elemente ${verb}`;

  const here: Destination | null =
    step.at === 'top'
      ? null
      : step.at === 'own'
        ? { name: 'Meine Dateien' }
        : step.at === 'area'
          ? { areaId: step.areaId, name: step.name }
          : { parentId: step.folderId, name: listing.data?.folder?.name ?? '' };
  // Already there: moving would change nothing.
  const same =
    verb === 'verschieben' &&
    here !== null &&
    nodes.length > 0 &&
    nodes.every(
      (node) =>
        (node.parentId ?? null) === (here.parentId ?? null) &&
        (here.parentId
          ? true
          : (node.areaId ?? null) === (here.areaId ?? null) && node.parentId === null),
    );
  const mayPut = step.at !== 'top' && cloudAccessAtLeast(listing.data?.access ?? null, 'edit');

  const up = () => {
    if (step.at !== 'folder' || !listing.data) return setStep({ at: 'top' });
    const path = listing.data.path;
    const parent = path[path.length - 2];
    if (parent) return setStep({ at: 'folder', folderId: parent.id });
    const area = listing.data.area;
    setStep(area ? { at: 'area', areaId: area.id, name: area.name } : { at: 'own' });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button
            variant="primary"
            loading={pending}
            disabled={!here || !mayPut || same}
            title={same ? 'Liegt schon hier' : undefined}
            onClick={() => here && onPick(here)}
          >
            {verb === 'verschieben'
              ? 'Hierher verschieben'
              : verb === 'kopieren'
                ? 'Hierher kopieren'
                : 'Hier ablegen'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex h-7 min-w-0 items-center gap-1.5 text-body text-fg-subtle">
          {step.at === 'top' ? (
            <span>Wohin?</span>
          ) : (
            <>
              <TextLink size="body" icon="arrowBack" onClick={up}>
                Zurück
              </TextLink>
              <Icon name="chevronRight" size={16} className="shrink-0" />
              <span className="truncate font-medium text-fg">{here?.name}</span>
            </>
          )}
        </div>
        <ul
          className="-mx-1 flex h-72 flex-col gap-0.5 overflow-y-auto"
          aria-busy={step.at !== 'top' && listing.isPending}
        >
          {step.at === 'top' ? (
            <>
              <li>
                <MenuItem size="md" icon="home" onClick={() => setStep({ at: 'own' })} truncate>
                  Meine Dateien
                </MenuItem>
              </li>
              {areas.map(({ area, depth }) => (
                <li key={area.id} style={depth > 0 ? { paddingLeft: depth * 16 } : undefined}>
                  <MenuItem
                    size="md"
                    icon={
                      <span className="flex size-5 items-center justify-center">
                        <AreaDot color={area.color} />
                      </span>
                    }
                    onClick={() => setStep({ at: 'area', areaId: area.id, name: area.name })}
                    truncate
                  >
                    {area.name}
                  </MenuItem>
                </li>
              ))}
            </>
          ) : listing.isPending ? (
            [0, 1, 2].map((row) => (
              <li key={row} className="px-2 py-2.5">
                <span className="skeleton block h-4 w-40 rounded-mark" />
              </li>
            ))
          ) : listing.isError ? (
            <li className="flex h-full flex-col items-center justify-center gap-2 text-body text-fg-subtle">
              Die Ordner ließen sich nicht laden.
              <Button variant="ghost" size="sm" onClick={() => void listing.refetch()}>
                Erneut versuchen
              </Button>
            </li>
          ) : folders.length === 0 ? (
            <li className="flex h-full items-center justify-center text-body text-fg-subtle">
              Keine weiteren Ordner
            </li>
          ) : (
            folders.map((folder) => (
              <li key={folder.id}>
                <MenuItem
                  size="md"
                  icon="folder"
                  trailing={<Icon name="chevronRight" size={16} className="text-fg-faint" />}
                  onClick={() => setStep({ at: 'folder', folderId: folder.id })}
                  truncate
                >
                  {folder.name}
                </MenuItem>
              </li>
            ))
          )}
        </ul>
        {error && (
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
