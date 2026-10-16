import { useEffect, useRef, useState } from 'react';
import type { Deck } from '@slider/shared';
import { pluralize } from '@/lib/format';
import {
  useDeckStatuses,
  useInvalidateDecks,
  useRerenderDecks,
  useUpdateDecks,
  type BulkResult,
} from '@/lib/api';
import type { MenuAction, ShowToast } from '@/ui';
import { DeleteDeckDialog } from '../components/DeleteDeckDialog';
import { MoveDecksDialog } from '../components/MoveDecksDialog';
import { movedMessage } from './useMoveDecks';
import { MAX_PINNED, pinDeck, unpinDeck, usePinnedDecks } from '../lib/pinned-decks';

const NO_IDS: readonly string[] = [];

const reviews = (count: number) => pluralize(count, 'Review', 'Reviews');

/** "Archivieren (2)" when the action only applies to some of the selected decks. */
const withCount = (label: string, count: number, selected: number) =>
  count < selected ? `${label} (${count})` : label;

const NOT_MANAGED = 'Gilt nur für Reviews, die du verwaltest.';

/** The failed part of a bulk request as a toast, or null when everything went through. */
function failureMessage(result: BulkResult<unknown>, verb: string) {
  const first = result.failed[0];
  if (!first) return null;
  return `${pluralize(result.failed.length, 'Review konnte', 'Reviews konnten')} nicht ${verb} werden: ${first.message}`;
}

/**
 * "Neu rendern" for several decks (BER-94): starts each, then follows their status until none
 * is rendering anymore. Lives on the page, so it keeps following after the selection changed.
 */
function useBulkRerender(onNotify: ShowToast) {
  const rerender = useRerenderDecks();
  const invalidateDecks = useInvalidateDecks();
  const [following, setFollowing] = useState<{ ids: readonly string[]; startedAt: number }>();
  const statuses = useDeckStatuses(following?.ids ?? NO_IDS);
  // Only a status fetched after the start counts – the cache may still hold an older one.
  const done = following
    ? statuses.filter(
        (status) => status.dataUpdatedAt >= following.startedAt && !status.data?.rendering,
      ).length
    : 0;
  const finished = following !== undefined && done === following.ids.length;

  const announced = useRef<typeof following>(undefined);
  useEffect(() => {
    if (!finished || !following || announced.current === following) return;
    announced.current = following;
    void invalidateDecks();
    onNotify(`${reviews(following.ids.length)} neu gerendert`);
  }, [finished, following, invalidateDecks, onNotify]);

  const busy = rerender.isPending || (following !== undefined && !finished);
  const start = (decks: readonly Deck[]) => {
    if (busy || decks.length === 0) return;
    const startedAt = Date.now();
    rerender.mutate(
      decks.map((deck) => deck.id),
      {
        onSuccess: (result) => {
          const rendering = result.done.filter((entry) => entry.result.status !== 'newVersion');
          const newVersions = result.done.length - rendering.length;
          if (rendering.length > 0) {
            setFollowing({ ids: rendering.map((entry) => entry.deckId), startedAt });
          }
          onNotify(
            failureMessage(result, 'neu gerendert') ??
              (newVersions > 0
                ? `${reviews(rendering.length)} werden neu gerendert, ${pluralize(newVersions, 'neue Version wird', 'neue Versionen werden')} importiert.`
                : `${reviews(rendering.length)} werden neu gerendert …`),
            result.failed.length > 0 ? 'danger' : undefined,
          );
        },
        onError: (error) => onNotify(error.message, 'danger'),
      },
    );
  };
  const label = !busy
    ? 'Neu rendern'
    : following
      ? `Wird gerendert … ${done}/${following.ids.length}`
      : 'Wird gerendert …';
  return { busy, label, start };
}

/**
 * Actions for the decks selected in "Reviews" – pin for every deck; re-render, archive/restore
 * and delete for the ones the viewer manages. `onDone` clears the selection after an action.
 */
export function useBulkDeckActions(
  decks: readonly Deck[],
  { onNotify, onDone }: { onNotify: ShowToast; onDone: () => void },
) {
  const [deleting, setDeleting] = useState<readonly Deck[] | null>(null);
  const [moving, setMoving] = useState<readonly Deck[] | null>(null);
  const update = useUpdateDecks();
  const rerender = useBulkRerender(onNotify);
  const pins = usePinnedDecks();

  const count = decks.length;
  const managed = decks.filter((deck) => deck.permissions.canManage);
  const isArchived = (deck: Deck) => deck.archivedAt !== null;
  const restore = managed.length > 0 && managed.every(isArchived);
  const toArchive = restore ? managed : managed.filter((deck) => !isArchived(deck));
  const renderable = managed.filter((deck) => deck.import.status === 'ready');
  const allPinned = count > 0 && decks.every((deck) => pins.isPinned(deck.id));

  const togglePinned = () => {
    if (allPinned) {
      decks.forEach((deck) => unpinDeck(deck.id));
    } else {
      const unpinned = decks.filter((deck) => !pins.isPinned(deck.id));
      const left = unpinned.filter((deck) => !pinDeck(deck.id)).length;
      if (left > 0) {
        onNotify(`Höchstens ${MAX_PINNED} Reviews angepinnt – ${reviews(left)} nicht angepinnt.`);
      }
    }
    onDone();
  };

  const toggleArchived = () =>
    update.mutate(
      { deckIds: toArchive.map((deck) => deck.id), input: { archived: !restore } },
      {
        onSuccess: (result) => {
          const ids = result.done.map((entry) => entry.deckId);
          const failure = failureMessage(result, restore ? 'wiederhergestellt' : 'archiviert');
          onNotify(
            failure ?? `${reviews(ids.length)} ${restore ? 'wiederhergestellt' : 'archiviert'}`,
            failure ? 'danger' : undefined,
          );
          onDone();
        },
        onError: (error) => onNotify(error.message, 'danger'),
      },
    );

  const someUnmanaged = (applies: number) => (applies < count ? NOT_MANAGED : undefined);

  const actions: MenuAction[] = [
    {
      label: allPinned ? 'Lösen' : 'Anpinnen',
      icon: 'pushPin',
      onSelect: togglePinned,
      disabled: !allPinned && pins.full,
      title:
        !allPinned && pins.full
          ? `Höchstens ${MAX_PINNED} Reviews angepinnt – löse zuerst einen.`
          : undefined,
    },
    {
      label: rerender.busy ? rerender.label : withCount('Neu rendern', renderable.length, count),
      icon: 'image',
      onSelect: () => rerender.start(renderable),
      disabled: rerender.busy || renderable.length === 0,
      title: someUnmanaged(renderable.length),
    },
    {
      label: withCount(restore ? 'Wiederherstellen' : 'Archivieren', toArchive.length, count),
      icon: restore ? 'history' : 'archive',
      onSelect: toggleArchived,
      disabled: update.isPending || toArchive.length === 0,
      title: someUnmanaged(toArchive.length),
    },
    {
      label: withCount('Verschieben …', managed.length, count),
      icon: 'folder',
      onSelect: () => setMoving(managed),
      disabled: managed.length === 0,
      title: someUnmanaged(managed.length),
    },
    {
      label: withCount('Löschen', managed.length, count),
      icon: 'delete',
      tone: 'danger',
      onSelect: () => setDeleting(managed),
      disabled: managed.length === 0,
      title: someUnmanaged(managed.length),
    },
  ];

  const dialog = deleting && (
    <DeleteDeckDialog
      decks={deleting}
      onClose={() => setDeleting(null)}
      onDeleted={(result) => {
        result.done.forEach((entry) => unpinDeck(entry.deckId));
        setDeleting(null);
        const failure = failureMessage(result, 'gelöscht');
        onNotify(
          failure ??
            (deleting.length === 1
              ? `„${deleting[0]!.title}“ gelöscht`
              : `${reviews(result.done.length)} gelöscht`),
          failure ? 'danger' : undefined,
        );
        onDone();
      }}
    />
  );

  const moveDialog = moving && moving.length > 0 && (
    <MoveDecksDialog
      decks={moving}
      workspaceId={moving[0]!.workspaceId}
      onClose={() => setMoving(null)}
      onMoved={(result, folderName) => {
        setMoving(null);
        const message = movedMessage(result, folderName);
        onNotify(message.text, message.tone);
        onDone();
      }}
    />
  );

  return {
    actions,
    dialog: (
      <>
        {dialog}
        {moveDialog}
      </>
    ),
  };
}
