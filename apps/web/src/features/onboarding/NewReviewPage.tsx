import { useRef } from 'react';
import { useNavigate } from 'react-router';
import type { Deck } from '@slider/shared';
import { AppHeader } from '@/app/AppHeader';
import { routes } from '@/app/routes';
import { LinkImportForm } from './components/LinkImportForm';
import { NoAccessCard } from './components/NoAccessCard';
import { RecentDecks } from './components/RecentDecks';
import { UploadDropzone } from './components/UploadDropzone';
import { UploadProgressCard } from './components/UploadProgressCard';
import { useDeckUpload } from './hooks/useDeckUpload';
import { useLinkImport } from './hooks/useLinkImport';
import { PPTX_ACCEPT } from './lib/upload-validation';

/**
 * A1 "Neuer Review" (BER-91, BER-92) with the A3 "no access" state.
 * Both paths end on the deck page, which shows the import progress (BER-97).
 */
export function Component() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const openDeck = (deck: Deck) => void navigate(routes.deck(deck.id));

  const link = useLinkImport(openDeck);
  const upload = useDeckUpload(openDeck);

  const pickFile = () => fileInputRef.current?.click();
  const uploadFile = (file: File) => {
    link.reset();
    upload.start(file);
  };

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>Neuer Review · Slider</title>
      <AppHeader />

      <main className="flex flex-1 justify-center px-4 pt-[clamp(8px,6vh,64px)] pb-16">
        <div className="flex w-full max-w-[456px] flex-col gap-6">
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

              <RecentDecks />
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
