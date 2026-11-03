import { useEffect, useRef } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useCreateTemplateDraft } from '@/lib/api';
import { routes } from '@/lib/routes';
import {
  atLeast,
  FONT_ACCEPT,
  MASTER_ACCEPT,
  useMaterialUpload,
  useWorkspace,
  WorkspaceMark,
} from '@/features/workspaces';
import { Notice, PageHeader, Toast, useToast } from '@/ui';
import { BlankDeckCard } from './components/BlankDeckCard';
import { UploadDropzone } from './components/UploadDropzone';

const FILTERS = { masters: 'vorlagen', 'workspace-fonts': 'workspace-schriften' } as const;

/**
 * `/w/:workspaceId/material/neu` – „Neues Asset“ for the library, laid out like „Neue Review“: a
 * template designed from scratch in the editor (the featured way in – its slides become the
 * layouts, with placeholders, shapes, pictures and guides), or files to upload, templates and
 * fonts alike, told apart by their names. An upload goes back to the library, on its filter.
 */
export function Component() {
  const workspace = useWorkspace();
  const navigate = useNavigate();
  const [toast, showToast] = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const draft = useCreateTemplateDraft(workspace.id);
  // An upload may take a while: someone gone elsewhere meanwhile is not taken back.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const upload = useMaterialUpload(workspace.id, {
    notify: showToast,
    // Back to the library once all went through; else what went wrong stays in sight here.
    onAdded: (kind, clean) =>
      clean &&
      mounted.current &&
      void navigate(routes.workspaceMaterial(workspace.id, FILTERS[kind])),
  });
  // Viewers only look: back to the library.
  if (!atLeast(workspace.role, 'member')) {
    return <Navigate to={routes.workspaceMaterial(workspace.id)} replace />;
  }

  return (
    <div className="dot-grid flex min-h-full flex-col">
      <title>{`Neues Asset | ${workspace.name} | Slider`}</title>
      <main className="flex flex-1 justify-center px-4 pt-2 pb-16">
        <div className="flex w-full max-w-[680px] flex-col gap-8">
          <PageHeader
            title="Neues Asset"
            leading={<WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={32} />}
            back={{ to: routes.workspaceMaterial(workspace.id), label: 'Zurück zur Bibliothek' }}
          />
          <div className="flex flex-col gap-8">
            <BlankDeckCard
              title="Neue Vorlage"
              description="Lege Layouts mit Platzhaltern, Formen, Bildflächen und Hilfslinien im Editor fest."
              onCreate={() =>
                draft.mutate(undefined, {
                  onSuccess: (deck) =>
                    void navigate(routes.deck(deck.id), { viewTransition: true }),
                })
              }
              pending={draft.isPending}
              error={draft.error?.message ?? null}
            />
            <div className="flex flex-col gap-3">
              <h2 className="text-base font-medium text-fg">Hochladen</h2>
              <UploadDropzone
                onFiles={upload.sendAny}
                onBrowse={() => inputRef.current?.click()}
                hint={
                  upload.uploading
                    ? 'Wird hochgeladen …'
                    : 'Vorlagen (.otp, .potx) oder Schriften (.ttf, .otf, .zip) – Slider erkennt, was es ist.'
                }
                error={null}
              />
              {upload.skipped.length > 0 && (
                <Notice tone="warning" variant="plain" size="sm" title="Nicht übernommen">
                  <ul className="flex flex-col gap-0.5">
                    {upload.skipped.map((item, i) => (
                      <li key={`${item.name}-${i}`}>
                        {item.name}: {item.reason}
                      </li>
                    ))}
                  </ul>
                </Notice>
              )}
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={`${MASTER_ACCEPT},${FONT_ACCEPT}`}
            hidden
            tabIndex={-1}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              // Picking the same files again must fire `change` again.
              event.target.value = '';
              upload.sendAny(files);
            }}
          />
        </div>
      </main>
      <Toast toast={toast} />
    </div>
  );
}
