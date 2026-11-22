import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { DEFAULT_DECK_KIND, type Deck, type Workspace } from '@slider/shared';
import { routes } from '@/lib/routes';
import { AppHeader } from '@/shell/AppHeader';
import { rememberWorkspace, WorkspaceMark } from '@/features/workspaces';
import { NextcloudBrowser } from '@/features/nextcloud';
import { clearCreationDraft, loadCreationDraft, saveCreationDraft } from '@/features/viewer';
import {
  useCreateDeckWithAi,
  useImportNextcloudItem,
  useNextcloudConnections,
  useNextcloudSettings,
  usePlaceDecks,
  useSliderTemplates,
  useWorkspaceMasters,
} from '@/lib/api';
import { cn, NextcloudMark, PageHeader } from '@/ui';
import { MasterChoice } from './BlankDeckCard';
import { CreateDeckCard } from './CreateDeckCard';
import { pagesOf } from '../lib/deck-pages';
import { PickerPanel } from './PickerPanel';

/**
 * „Neue Präsentation“ for one workspace: what the AI should build (or blank), on the template
 * picked below – the workspace's own, then the ones Slider brings along; with Nextcloud
 * connected, a file from there. A file from the computer is dropped on the presentations (or
 * „Öffnen …“ there). Every way ends on the deck.
 */
export function NewReview({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate();
  // Made from a folder or an area in Cloud, it lies there – else in one's own files.
  const [params] = useSearchParams();
  const folderId = params.get('ordner');
  const areaId = params.get('bereich');
  const place = folderId ? { parentId: folderId } : areaId ? { areaId } : undefined;
  const placeDecks = usePlaceDecks();
  /** `placed`: the server put it there already (a new one) – one from Nextcloud is moved. */
  const openDeck = (deck: Deck, placed = false) => {
    if (!placed && (folderId || areaId)) {
      placeDecks.mutate({
        deckIds: [deck.id],
        target: folderId ? { parentId: folderId } : { areaId },
      });
    }
    void navigate(routes.deck(deck.id));
  };

  // What the AI should build, kept in this browser per workspace until a deck is made of it.
  const draftKey = `new.${workspace.id}`;
  const [draft, setDraft] = useState(() => loadCreationDraft(draftKey));
  useEffect(() => saveCreationDraft(draftKey, draft), [draftKey, draft]);
  const kind = draft.kind ?? DEFAULT_DECK_KIND;
  // „Automatisch“ unless a number is set.
  const byAi = typeof draft.pages !== 'number';
  const pages = typeof draft.pages === 'number' ? draft.pages : pagesOf(kind);
  const create = useCreateDeckWithAi(workspace.id);
  const [pending, setPending] = useState<'ai' | 'blank' | null>(null);
  // The deck on one of the workspace's slide masters – only an ODP design can be built on.
  const masters = useWorkspaceMasters(workspace.id).data?.filter((m) => m.format === 'odp') ?? [];
  const chosenMaster = draft.templateId ?? '';
  const setChosenMaster = (id: string) => setDraft((now) => ({ ...now, templateId: id }));
  // Slider's own, of the usual page shape (what a deck without a template has).
  const sliderTemplates = (useSliderTemplates().data ?? []).filter(
    (template) => Math.abs(template.aspectRatio - 16 / 9) < 0.01,
  );
  // A design removed meanwhile falls back to none.
  const masterId =
    masters.some((m) => m.id === chosenMaster) ||
    sliderTemplates.some((template) => template.id === chosenMaster)
      ? chosenMaster
      : '';
  // Nextcloud (BER-135): once an account is connected, or the organisation set its own.
  const nextcloudConnections = useNextcloudConnections();
  const nextcloudSettings = useNextcloudSettings();
  const nextcloudAvailable =
    (nextcloudConnections.data?.length ?? 0) > 0 || Boolean(nextcloudSettings.data?.server);
  const [browsingNextcloud, setBrowsingNextcloud] = useState(false);
  const importNextcloud = useImportNextcloudItem(workspace.id);

  // While the picker is open it is the page: the other ways in step aside. As soon as it starts
  // to close they come back, rising in one after the other with the shrinking panel (not on the
  // first load). `nextcloudShown` keeps the panel's place until it has shrunk back.
  const picking = browsingNextcloud;
  const [nextcloudShown, setNextcloudShown] = useState(false);
  const showNextcloud = nextcloudAvailable || browsingNextcloud || nextcloudShown;
  const [hasPicked, setHasPicked] = useState(false);
  if (picking && !hasPicked) setHasPicked(true);
  const riseIn = (step: number): { className?: string; style?: CSSProperties } =>
    hasPicked
      ? { className: 'animate-rise-in', style: { animationDelay: `${60 + step * 70}ms` } }
      : {};

  // The last workspace, for the next visit to /neu.
  useEffect(() => rememberWorkspace(workspace.id), [workspace.id]);

  // The deck opens either way – refused (no AI, too many runs), its prompt on Folie 1 shows
  // what was typed here, to try again or start blank.
  const start = (withAi: boolean) => {
    if (pending) return;
    const templateId = masterId || null;
    setPending(withAi ? 'ai' : 'blank');
    const run = withAi
      ? { description: draft.description.trim(), kind, pages: byAi ? null : pages, templateId }
      : null;
    create.mutate(
      { templateId, run, place },
      {
        onSuccess: ({ deck, refused }) => {
          if (refused && run) saveCreationDraft(deck.id, { ...draft, templateId });
          clearCreationDraft(draftKey);
          openDeck(deck, true);
        },
        onSettled: () => setPending(null),
      },
    );
  };

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>Neue Präsentation | Slider</title>
      <AppHeader />

      <main className="flex flex-1 justify-center px-4 pt-2 pb-16 sm:px-8 lg:px-12">
        <div className="flex w-full flex-col gap-8">
          {/* Like the settings pages: mark and title over the column, no subtitle. The workspace's
              mark, as on its settings: the deck goes there. */}
          <PageHeader
            title="Neue Präsentation"
            leading={<WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={32} />}
            back={{ to: routes.workspace(workspace.id) }}
          />
          <div className="flex flex-col gap-3">
            {/* Start new, the featured way in, on the template picked under it. Steps aside while
                the Nextcloud picker is open. */}
            {!picking && (
              <div {...riseIn(0)} className={cn(riseIn(0).className, 'flex flex-col gap-8 pb-2')}>
                <CreateDeckCard
                  description={draft.description}
                  kind={kind}
                  pages={pages}
                  byAi={byAi}
                  onDescription={(description) => setDraft((now) => ({ ...now, description }))}
                  onKind={(next) => setDraft((now) => ({ ...now, kind: next }))}
                  onPages={(next) => setDraft((now) => ({ ...now, pages: next }))}
                  onByAi={(on) => setDraft((now) => ({ ...now, pages: on ? null : pagesOf(kind) }))}
                  onCreate={() => start(true)}
                  onBlank={() => start(false)}
                  pending={pending}
                  error={create.error?.message ?? null}
                />
                {masters.length + sliderTemplates.length > 0 && (
                  <MasterChoice
                    masters={masters}
                    sliderTemplates={sliderTemplates}
                    masterId={masterId}
                    onChange={setChosenMaster}
                  />
                )}
              </div>
            )}
            {/* Opens up in place (the rest steps aside). */}
            {showNextcloud && (
              <div className="flex w-full flex-col">
                <PickerPanel
                  open={browsingNextcloud}
                  onOpen={() => setBrowsingNextcloud(true)}
                  onClose={() => setBrowsingNextcloud(false)}
                  label="Aus Nextcloud wählen"
                  mark={<NextcloudMark size={18} />}
                  onShownChange={setNextcloudShown}
                >
                  {() => (
                    <NextcloudBrowser
                      onPick={async (entry, connectionId) => {
                        const deck = await importNextcloud.mutateAsync({
                          connectionId,
                          fileId: entry.fileId,
                        });
                        setBrowsingNextcloud(false);
                        openDeck(deck);
                      }}
                    />
                  )}
                </PickerPanel>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
