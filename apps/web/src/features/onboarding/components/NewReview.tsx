import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { Deck, Workspace } from '@slider/shared';
import { routes } from '@/lib/routes';
import { AppHeader } from '@/shell/AppHeader';
import { LoginErrorBanner } from '@/features/auth';
import { rememberWorkspace, WorkspaceMark } from '@/features/workspaces';
import { GOOGLE_RETURN_PARAMS, useGooglePick } from '@/features/google';
import { NextcloudBrowser } from '@/features/nextcloud';
import { useAuthProviders, useMe, useNextcloudConnections, useNextcloudSettings } from '@/lib/api';
import { cn, Divider, NextcloudMark, PageHeader } from '@/ui';
import { LinkImportForm } from './LinkImportForm';
import { NoAccessCard } from './NoAccessCard';
import { OneDriveAccountChooser } from './OneDriveAccountChooser';
import { GoogleDriveButton } from './GoogleDriveButton';
import { OneDrivePicker } from './OneDrivePicker';
import { PickerPanel } from './PickerPanel';
import { UploadDropzone } from './UploadDropzone';
import { UploadProgressCard } from './UploadProgressCard';
import { useDeckUpload } from '../hooks/useDeckUpload';
import { useLinkImport } from '../hooks/useLinkImport';
import { useOneDrivePicker } from '../hooks/useOneDrivePicker';
import { connectErrorFrom, googleConnectErrorMessage } from '../lib/link-import-errors';
import { PICKER_EXPAND_MS } from '../lib/picker-motion';

/**
 * A1 "Neue Review" (BER-91, BER-92) with the A3 "no access" state, for one workspace.
 * Both paths end on the deck page, which shows the import progress (BER-97).
 */
export function NewReview({ workspace }: { workspace: Workspace }) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The page cross-fades into the deck page, where the import stage builds up (index.css).
  const openDeck = (deck: Deck) => void navigate(routes.deck(deck.id), { viewTransition: true });

  const link = useLinkImport(workspace.id, openDeck);
  const upload = useDeckUpload(workspace.id, openDeck);
  const picker = useOneDrivePicker(workspace.id, openDeck);
  const { data: me } = useMe();
  const providers = useAuthProviders();
  // The picker needs this server's Microsoft app (the same one the login uses).
  const oneDriveAvailable =
    Boolean(me?.user?.microsoftConnected) ||
    Boolean(providers.data?.providers.some((p) => p.id === 'microsoft'));
  // Nextcloud (BER-135): once an account is connected, or the organisation set its own.
  const nextcloudConnections = useNextcloudConnections();
  const nextcloudSettings = useNextcloudSettings();
  const nextcloudAvailable =
    (nextcloudConnections.data?.length ?? 0) > 0 || Boolean(nextcloudSettings.data?.server);
  const [browsingNextcloud, setBrowsingNextcloud] = useState(false);
  // Google Drive (BER-119): Google's own picker page – the browser leaves for it (BER-158).
  const google = useGooglePick(workspace.id, openDeck);
  const googleAvailable = Boolean(providers.data?.googleDrive);

  // While a picker is open it is the page: the other ways in step aside – the other source button
  // folds away beside it. As soon as it starts to close they come back, the rest rising in one
  // after the other and riding up with the shrinking panel (not on the first load). `…Shown`
  // keeps a panel's place until it has shrunk back.
  const pickingOneDrive = picker.dialog.open;
  const picking = pickingOneDrive || browsingNextcloud;
  const [pickerShown, setPickerShown] = useState(false);
  const [nextcloudShown, setNextcloudShown] = useState(false);
  const showPicker = oneDriveAvailable || pickingOneDrive || pickerShown;
  const showNextcloud = nextcloudAvailable || browsingNextcloud || nextcloudShown;
  const showGoogle = googleAvailable;
  const shownSources = [showPicker, showNextcloud, showGoogle].filter(Boolean).length;
  // Three side by side only fit with short labels.
  const compact = shownSources === 3;
  const [hasPicked, setHasPicked] = useState(false);
  if (picking && !hasPicked) setHasPicked(true);
  const riseIn = (step: number): { className?: string; style?: CSSProperties } =>
    hasPicked
      ? { className: 'animate-rise-in', style: { animationDelay: `${60 + step * 70}ms` } }
      : {};
  // Side by side, half and half; the one aside folds to nothing while the other widens with its
  // growing panel, on the same curve – widths, not flex-grow, so the panel's centre moves in step
  // with its size and no edge overshoots. The one aside fades out at once, before its label gets
  // squeezed, and back in only once it has nearly its room again. Stacked on narrow screens,
  // where it just goes.
  // The gaps are split between the buttons, so all come out the same width.
  const slotGaps =
    shownSources === 3 ? ['sm:pr-2', 'sm:px-1', 'sm:pl-2'] : ['sm:pr-1.5', 'sm:pl-1.5'];
  // `position`: the slot's place among the shown sources, left to right.
  const sourceSlot = (aside: boolean, wide: boolean, position: number) => {
    const gap = !picking && slotGaps[position];
    return shownSources > 1
      ? {
          inert: aside,
          className: cn(
            'flex w-full min-w-0 flex-col sm:shrink-0',
            aside
              ? 'pointer-events-none overflow-hidden opacity-0 max-sm:hidden sm:w-0'
              : wide
                ? 'sm:w-full'
                : shownSources === 3
                  ? 'sm:w-1/3'
                  : 'sm:w-1/2',
            gap,
          ),
          style: {
            transition: [
              `width ${PICKER_EXPAND_MS}ms var(--ease-sheet)`,
              `padding ${PICKER_EXPAND_MS}ms var(--ease-sheet)`,
              aside ? 'opacity 120ms ease-out' : `opacity 180ms ease-out 200ms`,
            ].join(', '),
          },
        }
      : { className: 'flex w-full flex-col' };
  };

  // Back from the Microsoft login only `?link=` survives – the last workspace stands in.
  useEffect(() => rememberWorkspace(workspace.id), [workspace.id]);

  // A Microsoft connect started on this page that failed (the account menu, the picker): the
  // API lands it here; started elsewhere it goes to /konto?linkError=. (With `?link=`, the link
  // form explains it.) Read once, then off the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const [connectError] = useState(() => connectErrorFrom(searchParams));
  useEffect(() => {
    if (!connectError) return;
    setSearchParams(
      (params) => {
        params.delete('msError');
        return params;
      },
      { replace: true },
    );
  }, [connectError, setSearchParams]);

  // Back from Google: `?googlePicked=&googleConnection=` is the file picked on Google's picker
  // page, to import; after connecting Google Drive, `?google=pick` goes on to the picker (on the
  // file of a pasted link, `&googleFile=`); `&googleError=` says what went wrong. Read once.
  const [googleReturn] = useState(() => ({
    picked: searchParams.get('googlePicked'),
    connection: searchParams.get('googleConnection'),
    pick: searchParams.get('google') === 'pick' && !searchParams.get('googleError'),
    fileId: searchParams.get('googleFile'),
    error: googleConnectErrorMessage(searchParams.get('googleError')),
  }));
  const { open: openGoogle, importPicked } = google;
  const googleReturned = useRef(false);
  useEffect(() => {
    const { picked, connection } = googleReturn;
    if (googleReturned.current || (!picked && !googleReturn.pick && !googleReturn.error)) return;
    googleReturned.current = true;
    setSearchParams(
      (params) => {
        for (const key of GOOGLE_RETURN_PARAMS) params.delete(key);
        return params;
      },
      { replace: true },
    );
    if (picked && connection) importPicked(connection, picked);
    else if (googleReturn.pick) openGoogle(googleReturn.fileId);
  }, [googleReturn, openGoogle, importPicked, setSearchParams]);

  const pickFile = () => fileInputRef.current?.click();
  const uploadFile = (file: File) => {
    link.reset();
    upload.start(file);
  };

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>Neue Review | Slider</title>
      <AppHeader />

      {connectError && (
        <div className="px-4 pt-4 md:px-14">
          <div className="max-w-[640px]">
            <LoginErrorBanner code={connectError} />
          </div>
        </div>
      )}

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
            // Wide enough for both source buttons side by side; A3 keeps its card width.
            link.noAccess ? 'max-w-[560px]' : 'max-w-[680px]',
          )}
        >
          {!link.noAccess && (
            // Like the settings pages: mark and title over the column, no subtitle. The workspace's
            // mark, as on its settings: the review goes there.
            <PageHeader
              title="Neue Review"
              leading={
                <WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={32} />
              }
              back={{ to: routes.workspace(workspace.id) }}
            />
          )}
          <div className="flex flex-col gap-3">
            {/* First, so it opens up right under the heading. Also while `me` still loads: back
                from the Microsoft consent it opens right away. */}
            {!link.noAccess && shownSources > 0 && (
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:gap-0">
                {showPicker && (
                  <div {...sourceSlot(picking && !pickingOneDrive, pickingOneDrive, 0)}>
                    <OneDrivePicker
                      {...picker.dialog}
                      onOpen={picker.open}
                      onClose={picker.close}
                      pending={picker.pending}
                      error={picker.error}
                      onShownChange={setPickerShown}
                      label={compact ? 'OneDrive / SharePoint' : undefined}
                    />
                  </div>
                )}
                {showNextcloud && (
                  <div
                    {...sourceSlot(
                      picking && !browsingNextcloud,
                      browsingNextcloud,
                      Number(showPicker),
                    )}
                  >
                    <PickerPanel
                      open={browsingNextcloud}
                      onOpen={() => setBrowsingNextcloud(true)}
                      onClose={() => setBrowsingNextcloud(false)}
                      label={compact ? 'Nextcloud' : 'Aus Nextcloud wählen'}
                      mark={<NextcloudMark size={18} />}
                      onShownChange={setNextcloudShown}
                    >
                      {() => (
                        <NextcloudBrowser
                          workspaceId={workspace.id}
                          onImported={(deck) => {
                            setBrowsingNextcloud(false);
                            openDeck(deck);
                          }}
                        />
                      )}
                    </PickerPanel>
                  </div>
                )}
                {showGoogle && (
                  <div {...sourceSlot(picking, false, Number(showPicker) + Number(showNextcloud))}>
                    <GoogleDriveButton
                      onOpen={() => google.open()}
                      pending={google.pending}
                      error={google.error ?? googleReturn.error}
                      label={compact ? 'Google Drive' : undefined}
                    />
                  </div>
                )}
              </div>
            )}
            {!link.noAccess && shownSources > 0 && !picking && (
              <Divider label="oder" labelPosition="start" {...riseIn(0)} />
            )}
            <OneDriveAccountChooser {...picker.chooser} />

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
            <NoAccessCard
              info={link.noAccess}
              connected={Boolean(me?.user?.microsoftConnected)}
              onSignIn={link.signIn}
              onNextcloudConnected={link.retry}
              onPickGoogle={(fileId) => google.open(fileId)}
              googlePending={google.pending}
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
