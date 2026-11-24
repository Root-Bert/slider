import { eq } from 'drizzle-orm';
import { CHAT_FILES_FOLDER, isCloudReference, type Attachment } from '@slider/shared';
import { attachments } from '../db/schema';
import type { AppDeps } from '../deps';
import { storeUpload } from './cloud/files';

/*
 * Files sent to an agent or to Cloud's AI lie in Cloud too, so none is lost in a chat (the user,
 * 2026-11-23: „datein nicht in chats verloren gehen sollen sonder immer auch irgendwo in der
 * cloud liegen“): an area's agent puts them into the area's „Chat-Dateien“, as the area's chat
 * does (`sender-files.ts`); one's own agent and Cloud's AI into one's own „Chat-Dateien“ – and
 * there too where the area takes none from this person. A conversation's files go their own
 * way (`sender-files.ts`); Slider's, Writer's and Reader's chats keep theirs on the message.
 */

/** A sent file's bytes as an upload into Cloud; `null` once gone. */
async function uploadOf(deps: AppDeps, file: Attachment) {
  const [found] = await deps.db
    .select({ key: attachments.key })
    .from(attachments)
    .where(eq(attachments.id, file.id));
  const bytes = found ? await deps.storage.get(found.key) : null;
  if (!bytes) return null;
  return {
    data: (async function* () {
      yield bytes;
    })(),
    size: bytes.byteLength,
    mimeType: file.type,
  };
}

/**
 * Puts the files sent in a chat into „Chat-Dateien“ – the area's (`areaId`) or one's own –
 * as the person who sent them, next to any of the same name (nothing is overwritten). Cloud
 * files and folders the message points to lie in Cloud already: not copied. Called
 * once the message is kept, outside any transaction. Never fails: a file that cannot go into
 * Cloud (full, gone) stays on its message alone.
 */
export async function fileChatFiles(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  areaId: string | null,
  files: readonly Attachment[],
): Promise<void> {
  for (const file of files) {
    if (isCloudReference(file)) continue;
    const places = areaId ? [areaId, undefined] : [undefined];
    for (const place of places) {
      try {
        const upload = await uploadOf(deps, file);
        if (!upload) break;
        await storeUpload(
          deps,
          userId,
          workspaceId,
          { name: file.name, areaId: place, path: CHAT_FILES_FOLDER, keepBoth: true },
          upload,
        );
        break;
      } catch (error) {
        deps.log.info(
          `Chat file ${file.id} not put into ${place ? `area ${place}` : 'own files'}: ${String(error)}`,
        );
      }
    }
  }
}
