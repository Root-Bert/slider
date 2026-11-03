import { useState } from 'react';
import {
  WORKSPACE_FONT_UPLOAD_MAX_BYTES,
  WORKSPACE_MASTER_MAX_BYTES,
  type WorkspaceFontUpload,
} from '@slider/shared';
import {
  useUploadWorkspaceFonts,
  useUploadWorkspaceMaster,
  useWorkspaceFonts,
  useWorkspaceMasters,
} from '@/lib/api';
import { pluralize } from '@/lib/format';
import type { ToastTone } from '@/ui';

/**
 * A design to upload as slide masters, by its name – everything else is a font. Only templates
 * are taken; a presentation goes there too, to hear why not.
 */
export const MASTER_FILE = /\.(otp|odp|potx|pptx)$/i;
export const MASTER_ACCEPT = '.otp,.potx';
export const FONT_ACCEPT = '.ttf,.otf,.zip,font/ttf,font/otf,application/zip';

/** What an upload added to: the library's filter to show it under. */
export type UploadedKind = 'masters' | 'workspace-fonts';

/** How uploads went: what came in, and whether all went through (nothing failed or skipped). */
interface Outcome {
  added: UploadedKind | null;
  clean: boolean;
}

/**
 * Uploads to the library: templates and fonts, told apart by their names (`sendAny`). `notify`
 * says how it went; `onAdded` hears what kind of thing came in once all files are through –
 * `clean` when nothing failed or was skipped (so what it says is not left behind).
 */
export function useMaterialUpload(
  workspaceId: string,
  {
    notify,
    onAdded,
  }: {
    notify: (message: string, tone?: ToastTone) => void;
    onAdded?: (kind: UploadedKind, clean: boolean) => void;
  },
) {
  const fonts = useWorkspaceFonts(workspaceId);
  const masters = useWorkspaceMasters(workspaceId);
  const upload = useUploadWorkspaceFonts(workspaceId);
  const uploadMaster = useUploadWorkspaceMaster(workspaceId);
  const [skipped, setSkipped] = useState<WorkspaceFontUpload['skipped']>([]);
  /** Templates still going up: one mutation's `isPending` only knows the last of several. */
  const [mastersGoing, setMastersGoing] = useState(0);

  const uploadMasters = async (files: File[]): Promise<Outcome> => {
    let clean = true;
    let added = false;
    const before = new Set(masters.data?.map((master) => master.id));
    await Promise.all(
      files.map(async (file) => {
        if (file.size > WORKSPACE_MASTER_MAX_BYTES) {
          notify(`${file.name} ist zu groß (höchstens 100 MB).`, 'danger');
          clean = false;
          return;
        }
        setMastersGoing((n) => n + 1);
        try {
          const result = await uploadMaster.mutateAsync(file);
          const master = result.find((item) => !before.has(item.id));
          if (master) before.add(master.id);
          notify(
            master
              ? `${master.name}: ${pluralize(master.layouts.length, 'Layout', 'Layouts')} übernommen`
              : 'Vorlage hochgeladen',
          );
          added = true;
        } catch (error) {
          notify(error instanceof Error ? error.message : 'Hochladen fehlgeschlagen.', 'danger');
          clean = false;
        } finally {
          setMastersGoing((n) => n - 1);
        }
      }),
    );
    return { added: added ? 'masters' : null, clean };
  };
  const uploadFonts = async (files: File[]): Promise<Outcome> => {
    if (files.length === 0) return { added: null, clean: true };
    const size = files.reduce((total, file) => total + file.size, 0);
    if (size > WORKSPACE_FONT_UPLOAD_MAX_BYTES) {
      notify('Das sind zu viele Daten auf einmal (höchstens 80 MB).', 'danger');
      return { added: null, clean: false };
    }
    const before = new Set(fonts.data?.map((font) => font.id));
    setSkipped([]);
    try {
      const result = await upload.mutateAsync(files);
      setSkipped(result.skipped);
      const added = result.fonts.filter((font) => !before.has(font.id)).length;
      if (added > 0) notify(`${pluralize(added, 'Schriftschnitt', 'Schriftschnitte')} hochgeladen`);
      return { added: added > 0 ? 'workspace-fonts' : null, clean: result.skipped.length === 0 };
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Hochladen fehlgeschlagen.', 'danger');
      return { added: null, clean: false };
    }
  };
  const report = (outcomes: Outcome[]) => {
    const added = outcomes.find((outcome) => outcome.added)?.added;
    if (added)
      onAdded?.(
        added,
        outcomes.every((outcome) => outcome.clean),
      );
  };
  const sendMasters = (files: File[]) => void uploadMasters(files).then((o) => report([o]));
  const sendFonts = (files: File[]) => void uploadFonts(files).then((o) => report([o]));
  /** Files picked or dropped: designs go to the slide masters, the rest to the fonts. */
  const sendAny = (files: File[]) =>
    void Promise.all([
      uploadMasters(files.filter((file) => MASTER_FILE.test(file.name))),
      uploadFonts(files.filter((file) => !MASTER_FILE.test(file.name))),
    ]).then(report);

  return {
    sendAny,
    sendMasters,
    sendFonts,
    skipped,
    uploading: upload.isPending || mastersGoing > 0,
    uploadingFonts: upload.isPending,
    uploadingMaster: mastersGoing > 0,
  };
}
