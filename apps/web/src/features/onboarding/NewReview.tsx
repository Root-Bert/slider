import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
import { OneDrivePicker } from './components/OneDrivePicker';
import { UploadDropzone } from './components/UploadDropzone';
import { UploadProgressCard } from './components/UploadProgressCard';
import { useDeckUpload } from './hooks/useDeckUpload';
import { useLinkImport } from './hooks/useLinkImport';
import { useOneDrivePicker } from './hooks/useOneDrivePicker';
import { PPTX_ACCEPT } from './lib/upload-validation';

/**
 * A1 "Neue Review" (BER-91, BER-92) with the A3 "no access" state, for one workspace.
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

  // While the picker is open it is the page: the other ways in step aside. As soon as it starts
  // to close they rise back in, one after the other, and ride up with the shrinking panel (not
  // on the first load). `pickerShown` keeps the panel's place until it has shrunk back.
  const picking = picker.dialog.open;
  const [pickerShown, setPickerShown] = useState(false);
  const [hasPicked, setHasPicked] = useState(false);
  if (picking && !hasPicked) setHasPicked(true);
  const riseIn = (step: number): { className?: string; style?: CSSProperties } =>
    hasPicked
      ? { className: 'animate-rise-in', style: { animationDelay: `${60 + step * 70}ms` } }
      : {};

  // Back from the Microsoft login only `?link=` survives – the last workspace stands in.
  useEffect(() => rememberWorkspace(workspace.id), [workspace.id]);

  const pickFile = () => fileInputRef.current?.click();
  const uploadFile = (file: File) => {
    link.reset();
    upload.start(file);
  };

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>Neue Review · Slider</title>
      <AppHeader />

      {!link.noAccess && (
        // Same place and type as "Meine Reviews".
        <hgroup className="flex flex-col gap-1 px-4 pt-2 md:px-14">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight text-fg">
            Neue Review
          </h1>
          <p className="text-[13px] text-fg-subtle">
            Präsentation aus OneDrive oder SharePoint öffnen und Feedback direkt auf den Folien
            sammeln.
          </p>
        </hgroup>
      )}

      <main
        className={cn(
          'flex flex-1 justify-center px-4 pb-16',
          // A3 drops the heading; the field moves down to where the card reads centred (Figma 92:2472).
          link.noAccess ? 'pt-[clamp(8px,19vh,190px)]' : 'pt-[clamp(24px,7vh,72px)]',
        )}
      >
        <div className="flex w-full max-w-[560px] flex-col gap-8">
          <div className="flex flex-col gap-3">
            {/* First, so it opens up right under the heading. Also while `me` still loads: back
                from the Microsoft consent it opens right away. */}
            {!link.noAccess && (oneDriveAvailable || picking || pickerShown) && (
              <>
                <OneDrivePicker
                  {...picker.dialog}
                  onOpen={picker.open}
                  onClose={picker.close}
                  pending={picker.pending}
                  error={picker.error}
                  onShownChange={setPickerShown}
                />
                {!picking && (
                  <p
                    {...riseIn(0)}
                    className={cn(
                      'flex items-center gap-3 text-xs text-fg-subtle',
                      riseIn(0).className,
                    )}
                  >
                    oder
                    <span aria-hidden className="h-px flex-1 bg-hairline" />
                  </p>
                )}
              </>
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
                  label={link.noAccess ? undefined : 'Link einfügen'}
                />
              </div>
            )}
          </div>

          {picking ? null : link.noAccess ? (
            <NoAccessCard info={link.noAccess} onUploadInstead={pickFile} />
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
