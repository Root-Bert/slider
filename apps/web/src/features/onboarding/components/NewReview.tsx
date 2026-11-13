import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import type { Deck, Workspace } from '@slider/shared';
import { OPEN_ON_BOARD, routes } from '@/lib/routes';
import { AppHeader } from '@/shell/AppHeader';
import { rememberWorkspace, WorkspaceMark } from '@/features/workspaces';
import { NextcloudBrowser } from '@/features/nextcloud';
import {
  useCreateBlankDeck,
  useImportNextcloudItem,
  useNextcloudConnections,
  useNextcloudSettings,
  useWorkspaceMasters,
} from '@/lib/api';
import { cn, NextcloudMark, PageHeader } from '@/ui';
import { BlankDeckCard } from './BlankDeckCard';
import { LinkImportForm } from './LinkImportForm';
import { NoAccessCard } from './NoAccessCard';
import { PickerPanel } from './PickerPanel';
import { UploadDropzone } from './UploadDropzone';
import { UploadProgressCard } from './UploadProgressCard';
import { useDeckUpload } from '../hooks/useDeckUpload';
import { useLinkImport } from '../hooks/useLinkImport';

/**
 * A1 "Neue Review" (BER-91, BER-92) with the A3 "no access" state, for one workspace.
 * Both paths end on the deck page, which shows the import progress (BER-97).
 */
export function NewReview({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The page cross-fades into the deck page, where the import stage builds up (index.css).
  const openDeck = (deck: Deck) => void navigate(routes.deck(deck.id), { viewTransition: true });
  // A new deck opens on its material page, where its material goes before Folie 1's prompt builds it.
  const openNewDeck = (deck: Deck) =>
    void navigate(routes.deck(deck.id), { viewTransition: true, state: OPEN_ON_BOARD });

  const link = useLinkImport(workspace.id, openDeck);
  const upload = useDeckUpload(workspace.id, openDeck);
  // Start from scratch: an empty presentation, straight into the editor.
  const blank = useCreateBlankDeck(workspace.id);
  // …or on one of the workspace's slide masters – only an ODP design can be built on.
  const masters = useWorkspaceMasters(workspace.id).data?.filter((m) => m.format === 'odp') ?? [];
  const [chosenMaster, setChosenMaster] = useState('');
  // A design removed meanwhile falls back to none.
  const masterId = masters.some((m) => m.id === chosenMaster) ? chosenMaster : '';
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

  const pickFile = () => fileInputRef.current?.click();
  const uploadFile = (file: File) => {
    link.reset();
    upload.start(file);
  };

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>Neue Präsentation | Slider</title>
      <AppHeader />

      <main
        className={cn(
          'flex flex-1 justify-center px-4 pb-16',
          // A3 drops the heading; the field moves down to where the card reads centred (Figma 92:2472).
          link.noAccess ? 'pt-[clamp(8px,19vh,190px)]' : 'pt-2',
        )}
      >
        <div
          className={cn(
            'flex w-full flex-col gap-8',
            // A3 keeps its card width.
            link.noAccess ? 'max-w-[560px]' : 'max-w-[680px]',
          )}
        >
          {!link.noAccess && (
            // Like the settings pages: mark and title over the column, no subtitle. The workspace's
            // mark, as on its settings: the review goes there.
            <PageHeader
              title="Neue Präsentation"
              leading={
                <WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={32} />
              }
              back={{ to: routes.workspace(workspace.id) }}
            />
          )}
          <div className="flex flex-col gap-3">
            {/* Start from scratch, the featured way in; then the ways to bring a deck along. Both
                step aside while a picker is open. */}
            {!link.noAccess && !picking && (
              <div {...riseIn(0)} className={cn(riseIn(0).className, 'flex flex-col gap-8 pb-2')}>
                <BlankDeckCard
                  onCreate={() => blank.mutate(masterId || undefined, { onSuccess: openNewDeck })}
                  pending={blank.isPending}
                  error={blank.error?.message ?? null}
                  masters={masters}
                  masterId={masterId}
                  onMasterChange={setChosenMaster}
                />
                <h2 className="text-base font-medium text-fg">Präsentation importieren</h2>
              </div>
            )}
            {/* Opens up right under the heading (the rest steps aside). */}
            {!link.noAccess && showNextcloud && (
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

            {!picking && (
              <div {...riseIn(1)}>
                <LinkImportForm
                  url={link.url}
                  onChange={link.change}
                  onBlur={link.blur}
                  onSubmit={link.submit}
                  error={link.error}
                  pending={link.pending}
                  emphasis={link.noAccess ? 'secondary' : 'primary'}
                />
              </div>
            )}
          </div>

          {picking ? null : link.noAccess ? (
            <NoAccessCard
              info={link.noAccess}
              onNextcloudConnected={link.retry}
              onUploadInstead={pickFile}
            />
          ) : upload.state.status === 'uploading' ? (
            <UploadProgressCard
              file={upload.state.file}
              progress={upload.state.progress}
              onCancel={upload.cancel}
            />
          ) : (
            <div {...riseIn(2)}>
              <UploadDropzone
                onFile={uploadFile}
                onBrowse={pickFile}
                error={upload.state.status === 'error' ? upload.state.message : null}
              />
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            hidden
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Reset so picking the same file again still fires `change`.
              event.target.value = '';
              if (file) uploadFile(file);
            }}
          />
        </div>
      </main>
    </div>
  );
}
