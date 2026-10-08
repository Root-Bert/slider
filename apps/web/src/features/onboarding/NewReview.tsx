import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import type { Deck, Workspace } from '@slider/shared';
import { AppHeader } from '@/app/AppHeader';
import { routes } from '@/app/routes';
import { rememberWorkspace } from '@/features/workspaces/lib/last-workspace';
import { useMe } from '@/lib/queries';
import { useAuthProviders } from '@/lib/workspace-queries';
import { cn } from '@/ui';
import { LinkImportForm } from './components/LinkImportForm';
import { NoAccessCard } from './components/NoAccessCard';
import { OneDrivePickerButton } from './components/OneDrivePickerButton';
import { OneDrivePickerDialog } from './components/OneDrivePickerDialog';
import { RecentDecks } from './components/RecentDecks';
import { UploadDropzone } from './components/UploadDropzone';
import { UploadProgressCard } from './components/UploadProgressCard';
import { useDeckUpload } from './hooks/useDeckUpload';
import { useLinkImport } from './hooks/useLinkImport';
import { useOneDrivePicker } from './hooks/useOneDrivePicker';
import { PPTX_ACCEPT } from './lib/upload-validation';

/**
 * A1 "Neuer Review" (BER-91, BER-92) with the A3 "no access" state, for one workspace.
 * Both paths end on the deck page, which shows the import progress (BER-97).
 */
export function NewReview({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openDeck = (deck: Deck) => void navigate(routes.deck(deck.id));

  const link = useLinkImport(workspace.id, openDeck);
  const upload = useDeckUpload(workspace.id, openDeck);
  const picker = useOneDrivePicker(workspace.id, openDeck);
  const { data: me } = useMe();
  const providers = useAuthProviders();
  // The picker needs this server's Microsoft app (the same one the login uses).
  const oneDriveAvailable =
    Boolean(me?.user?.microsoftConnected) ||
    Boolean(providers.data?.providers.some((p) => p.id === 'microsoft'));

  // Back from the Microsoft login only `?link=` survives – the last workspace stands in.
  useEffect(() => rememberWorkspace(workspace.id), [workspace.id]);

  const pickFile = () => fileInputRef.current?.click();
  const uploadFile = (file: File) => {
    link.reset();
    upload.start(file);
  };

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>Neuer Review · Slider</title>
      <AppHeader />

      <main
        className={cn(
          'flex flex-1 justify-center px-4 pb-16',
          // A3 drops the heading; the field moves down to where the card reads centred (Figma 92:2472).
          link.noAccess ? 'pt-[clamp(8px,19vh,190px)]' : 'pt-[clamp(8px,6vh,64px)]',
        )}
      >
        <div
          className={cn(
            'flex w-full flex-col gap-6',
            link.noAccess ? 'max-w-[560px]' : 'max-w-[456px]',
          )}
        >
          {!link.noAccess && (
            <hgroup className="flex flex-col items-center gap-2 text-center">
              <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-fg">
                Slider
              </h1>
              <p className="text-sm text-fg-subtle">
                Folien teilen. Feedback direkt auf der Folie sammeln.
              </p>
            </hgroup>
          )}

          <LinkImportForm
            url={link.url}
            onChange={link.change}
            onBlur={link.blur}
            onSubmit={link.submit}
            error={link.error}
            pending={link.pending}
            emphasis={link.noAccess ? 'secondary' : 'primary'}
            showSources={!link.noAccess}
          />

          {!link.noAccess && oneDriveAvailable && (
            <>
              <OneDrivePickerButton
                onOpen={picker.open}
                pending={picker.pending}
                error={picker.error}
              />
              <OneDrivePickerDialog {...picker.dialog} onClose={picker.close} />
            </>
          )}

          {link.noAccess ? (
            <NoAccessCard info={link.noAccess} onUploadInstead={pickFile} />
          ) : (
            <>
              <p className="flex items-center gap-3 text-xs text-fg-subtle">
                <span aria-hidden className="h-px flex-1 bg-hairline" />
                oder PPTX hochladen
                <span aria-hidden className="h-px flex-1 bg-hairline" />
              </p>

              {upload.state.status === 'uploading' ? (
                <UploadProgressCard
                  file={upload.state.file}
                  progress={upload.state.progress}
                  onCancel={upload.cancel}
                />
              ) : (
                <UploadDropzone
                  onFile={uploadFile}
                  onBrowse={pickFile}
                  error={upload.state.status === 'error' ? upload.state.message : null}
                />
              )}

              <RecentDecks workspaceId={workspace.id} />
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept={PPTX_ACCEPT}
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
